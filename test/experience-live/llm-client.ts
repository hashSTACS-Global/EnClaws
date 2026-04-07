import type { ModelConfig } from "./types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Lightweight LLM completion call.
 * Supports openai-completions and anthropic-messages protocols.
 */
export async function chatComplete(
  config: ModelConfig,
  messages: ChatMessage[],
  timeoutMs = 120_000,
): Promise<string> {
  if (config.apiProtocol === "anthropic-messages") {
    return callAnthropic(config, messages, timeoutMs);
  }
  return callOpenAI(config, messages, timeoutMs);
}

async function callOpenAI(
  config: ModelConfig,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<string> {
  const baseUrl = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  // base_url may already include /v1 (e.g. "https://xxx/v1"), so only append /chat/completions
  const url = baseUrl.endsWith("/v1")
    ? `${baseUrl}/chat/completions`
    : `${baseUrl}/v1/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: 512,
      messages,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const choices = data.choices as Array<{ message?: { content?: string } }>;
  return choices?.[0]?.message?.content ?? "";
}

async function callAnthropic(
  config: ModelConfig,
  messages: ChatMessage[],
  timeoutMs: number,
): Promise<string> {
  const baseUrl = (config.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
  const url = baseUrl.endsWith("/v1")
    ? `${baseUrl}/messages`
    : `${baseUrl}/v1/messages`;

  const systemMsg = messages.find((m) => m.role === "system");
  const conversationMsgs = messages.filter((m) => m.role !== "system");

  const body: Record<string, unknown> = {
    model: config.modelId,
    max_tokens: 512,
    messages: conversationMsgs.map((m) => ({ role: m.role, content: m.content })),
  };
  if (systemMsg) {
    body.system = systemMsg.content;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = (await res.json()) as Record<string, unknown>;
  const content = data.content as Array<{ type: string; text?: string }>;
  return content?.find((c) => c.type === "text")?.text ?? "";
}
