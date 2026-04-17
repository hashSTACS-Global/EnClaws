import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getTenantAgent } from "../db/models/tenant-agent.js";
import { getTenantModel } from "../db/models/tenant-model.js";
import { agentChannelBindingExists } from "../db/models/tenant-channel-app.js";
import { createInteractionTrace, getMaxTurnIndex } from "../db/models/interaction-trace.js";
import { getUserByUnionId } from "../db/models/user.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { sendJson, sendMethodNotAllowed } from "./http-common.js";
import { getHeader } from "./http-utils.js";
import { readJsonBody } from "./hooks.js";

const log = createSubsystemLogger("agent-chat-api");

const MAX_BODY_BYTES = 1024 * 1024; // 1MB

type ChatMessage = {
  role: string;
  content: string;
};

export type ParsedSessionKey = {
  agentId?: string;
  channel?: string;
  group?: string;
  unionId?: string;
  openId?: string;
  name?: string;
};

/**
 * Parse sessionKey in format:
 *   agent:{agentId}|channel:{feishu/wecom/dingtalk}|group:{single/oc_xxx}|union:{on_xxx}|open:{ou_xxx}|name:{张三}
 */
export function parseSessionKey(sessionKey: string): ParsedSessionKey {
  const result: ParsedSessionKey = {};
  for (const part of sessionKey.split("|")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!value) continue;
    switch (key) {
      case "agent": result.agentId = value; break;
      case "channel": result.channel = value; break;
      case "group": result.group = value; break;
      case "union": result.unionId = value; break;
      case "open": result.openId = value; break;
      case "name": result.name = value; break;
    }
  }
  return result;
}

function sendError(res: ServerResponse, status: number, message: string, type = "invalid_request_error") {
  sendJson(res, status, { error: { message, type } });
}

/**
 * POST /v1/agent/chat/completions — lightweight LLM proxy for tenant agents.
 * No auth required. Reads model config from tenant_agents + tenant_models,
 * calls LLM directly via fetch, records to llm_interaction_traces.
 *
 * Caller passes `sessionKey` header with format:
 *   agent:{agentId}|channel:{feishu/wecom/dingtalk}|group:{single/oc_xxx}|union:{on_xxx}|open:{ou_xxx}|name:{张三}
 * agentId, channel, unionId are parsed out; tenantId is resolved from the
 * `users` table via unionId; turnId remains a separate header.
 *
 * Returns true if the request was handled (even on error), false if path doesn't match.
 */
export async function handleAgentChatHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  if (pathname !== "/v1/agent/chat/completions") {
    return false;
  }

  if (req.method !== "POST") {
    sendMethodNotAllowed(res);
    return true;
  }

  // --- 1. Parse headers ---
  const sessionKey = getHeader(req, "sessionkey")?.trim();
  const turnIdHeader = getHeader(req, "turnid")?.trim();

  if (!sessionKey) {
    sendError(res, 400, "Missing required header: sessionKey");
    return true;
  }

  const parsed = parseSessionKey(sessionKey);
  const agentId = parsed.agentId;
  const channel = parsed.channel;
  const unionId = parsed.unionId;

  if (!agentId) {
    sendError(res, 400, "sessionKey missing agent:{agentId} segment");
    return true;
  }
  if (!channel) {
    sendError(res, 400, "sessionKey missing channel:{channel} segment");
    return true;
  }
  if (!unionId) {
    sendError(res, 400, "sessionKey missing union:{unionId} segment");
    return true;
  }

  // --- Resolve tenantId from users table via union_id ---
  let tenantId: string;
  try {
    const user = await getUserByUnionId(unionId);
    if (!user) {
      sendError(res, 404, `No active user found for unionId=${unionId}`, "not_found");
      return true;
    }
    tenantId = user.tenantId;
  } catch (err) {
    log.error(`Failed to resolve tenantId from unionId=${unionId}: ${String(err)}`);
    sendError(res, 500, "Internal error resolving tenant", "api_error");
    return true;
  }

  // --- 2. Parse body ---
  const bodyResult = await readJsonBody(req, MAX_BODY_BYTES);
  if (!bodyResult.ok) {
    sendError(res, 400, `Invalid request body: ${bodyResult.error}`);
    return true;
  }
  const body = bodyResult.value as Record<string, unknown>;
  const messages = body.messages as ChatMessage[] | undefined;
  if (!Array.isArray(messages) || messages.length === 0) {
    sendError(res, 400, "Missing or empty `messages` array");
    return true;
  }

  // --- 3. Query tenant_agents ---
  let agent;
  try {
    agent = await getTenantAgent(tenantId, agentId);
  } catch (err) {
    log.error(`Failed to query tenant_agents: ${String(err)}`);
    sendError(res, 500, "Internal error querying agent config", "api_error");
    return true;
  }
  if (!agent) {
    sendError(res, 404, `Agent not found: tenantId=${tenantId} agentId=${agentId}`, "not_found");
    return true;
  }

  // --- Verify agent is bound to the given channel type ---
  try {
    const bound = await agentChannelBindingExists(tenantId, agentId, channel);
    if (!bound) {
      sendError(res, 404, `Agent ${agentId} is not bound to channel ${channel}`, "not_found");
      return true;
    }
  } catch (err) {
    log.error(`Failed to verify agent/channel binding: ${String(err)}`);
    sendError(res, 500, "Internal error verifying agent/channel binding", "api_error");
    return true;
  }

  // --- 4. Resolve default model from model_config ---
  const defaultModelEntry = agent.modelConfig?.find((m) => m.isDefault);
  if (!defaultModelEntry) {
    sendError(res, 404, "No default model configured for this agent", "not_found");
    return true;
  }

  // --- 5. Query tenant_models ---
  let tenantModel;
  try {
    tenantModel = await getTenantModel(tenantId, defaultModelEntry.providerId);
  } catch (err) {
    log.error(`Failed to query tenant_models: ${String(err)}`);
    sendError(res, 500, "Internal error querying model config", "api_error");
    return true;
  }
  if (!tenantModel) {
    sendError(res, 404, `Model provider not found: providerId=${defaultModelEntry.providerId}`, "not_found");
    return true;
  }

  const baseUrl = tenantModel.baseUrl?.replace(/\/+$/, "") ?? "";
  const apiKey = tenantModel.apiKeyEncrypted ?? "";
  const modelId = defaultModelEntry.modelId;

  if (!baseUrl) {
    sendError(res, 404, "Model provider has no baseUrl configured", "not_found");
    return true;
  }

  // --- 6. Resolve turnId / turnIndex ---
  const turnId = turnIdHeader || randomUUID();
  let turnIndex = 0;
  if (turnIdHeader) {
    try {
      const maxIndex = await getMaxTurnIndex(turnId);
      turnIndex = maxIndex + 1;
    } catch (err) {
      log.warn(`Failed to query max turn_index for turnId=${turnId}: ${String(err)}`);
    }
  }

  // --- 7. Call LLM ---
  const runId = `agentchat_${randomUUID()}`;
  const startedAt = Date.now();
  let llmResponse: Record<string, unknown>;

  try {
    const llmUrl = `${baseUrl}/chat/completions`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`;
    }
    if (tenantModel.extraHeaders) {
      Object.assign(headers, tenantModel.extraHeaders);
    }

    const fetchResponse = await fetch(llmUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelId,
        messages,
        stream: false,
      }),
    });

    if (!fetchResponse.ok) {
      const errorText = await fetchResponse.text().catch(() => "unknown error");
      log.error(`LLM request failed: status=${fetchResponse.status} body=${errorText}`);
      sendError(res, 502, `LLM request failed: ${fetchResponse.status}`, "api_error");

      const durationMs = Date.now() - startedAt;
      void createInteractionTrace({
        tenantId,
        userId: unionId,
        sessionKey,
        agentId,
        channel: channel ?? "agent-chat-api",
        turnId,
        turnIndex,
        userInput: messages.find((m) => m.role === "user")?.content,
        provider: tenantModel.providerType,
        model: modelId,
        messages,
        errorMessage: `${fetchResponse.status}: ${errorText.slice(0, 500)}`,
        durationMs,
      }).catch((traceErr) => log.warn(`Failed to record error trace: ${String(traceErr)}`));

      return true;
    }

    llmResponse = (await fetchResponse.json()) as Record<string, unknown>;
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    log.error(`LLM request error: ${String(err)}`);
    sendError(res, 502, `LLM request failed: ${String(err)}`, "api_error");

    void createInteractionTrace({
      tenantId,
      userId: unionId,
      sessionKey,
      agentId,
      channel: channel ?? "agent-chat-api",
      turnId,
      turnIndex,
      userInput: messages.find((m) => m.role === "user")?.content,
      provider: tenantModel.providerType,
      model: modelId,
      messages,
      errorMessage: String(err).slice(0, 500),
      durationMs,
    }).catch((traceErr) => log.warn(`Failed to record error trace: ${String(traceErr)}`));

    return true;
  }

  const durationMs = Date.now() - startedAt;

  // --- 8. Extract usage and record trace ---
  const usage = llmResponse.usage as Record<string, number> | undefined;
  const choices = llmResponse.choices as Array<Record<string, unknown>> | undefined;
  const assistantContent =
    (choices?.[0]?.message as Record<string, unknown>)?.content as string | undefined;
  const stopReason =
    (choices?.[0]?.finish_reason as string) ?? undefined;

  void createInteractionTrace({
    tenantId,
    userId: unionId,
    sessionKey,
    agentId,
    channel: channel ?? "agent-chat-api",
    turnId,
    turnIndex,
    userInput: messages.find((m) => m.role === "user")?.content,
    provider: tenantModel.providerType,
    model: modelId,
    messages,
    response: llmResponse,
    stopReason,
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    durationMs,
  }).catch((traceErr) => log.warn(`Failed to record trace: ${String(traceErr)}`));

  // --- 9. Return response ---
  sendJson(res, 200, {
    id: runId,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: assistantContent ?? "" },
        finish_reason: stopReason ?? "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.prompt_tokens ?? 0,
      completion_tokens: usage?.completion_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
    },
  });

  return true;
}
