/**
 * LLM Interaction Trace CRUD - records every LLM API call per tenant.
 */

import { query, getDbType, DB_SQLITE } from "../index.js";
import * as sqliteTrace from "../sqlite/models/interaction-trace.js";
import type { LlmInteractionTrace } from "../types.js";

/** Sanitize a value for PostgreSQL JSONB — strip \u0000 null bytes which PG rejects. */
function sanitizeJson(val: unknown): string | null {
  if (val == null) return null;
  return JSON.stringify(val).replace(/\\u0000/g, "");
}

function rowToTrace(row: Record<string, unknown>): LlmInteractionTrace {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    userId: (row.user_id as string) ?? null,
    sessionKey: (row.session_key as string) ?? null,
    agentId: (row.agent_id as string) ?? null,
    channel: (row.channel as string) ?? null,
    turnId: row.turn_id as string,
    turnIndex: row.turn_index as number,
    userInput: (row.user_input as string) ?? null,
    provider: (row.provider as string) ?? null,
    model: (row.model as string) ?? null,
    systemPrompt: (row.system_prompt as string) ?? null,
    messages: (row.messages ?? []) as unknown[],
    tools: (row.tools as unknown[]) ?? null,
    requestParams: (row.request_params as Record<string, unknown>) ?? null,
    response: row.response ?? null,
    stopReason: (row.stop_reason as string) ?? null,
    errorMessage: (row.error_message as string) ?? null,
    inputTokens: parseInt(String(row.input_tokens ?? 0), 10),
    outputTokens: parseInt(String(row.output_tokens ?? 0), 10),
    cacheReadTokens: parseInt(String(row.cache_read_tokens ?? 0), 10),
    cacheWriteTokens: parseInt(String(row.cache_write_tokens ?? 0), 10),
    durationMs: (row.duration_ms as number) ?? null,
    createdAt: row.created_at as Date,
  };
}

export async function createInteractionTrace(params: {
  tenantId: string;
  userId?: string;
  sessionKey?: string;
  agentId?: string;
  channel?: string;
  turnId: string;
  turnIndex: number;
  userInput?: string;
  provider?: string;
  model?: string;
  systemPrompt?: string;
  messages: unknown[];
  tools?: unknown[];
  requestParams?: Record<string, unknown>;
  response?: unknown;
  stopReason?: string;
  errorMessage?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  durationMs?: number;
}): Promise<void> {
  if (getDbType() === DB_SQLITE) return sqliteTrace.createInteractionTrace(params);
  try {
    await query(
      `INSERT INTO llm_interaction_traces
       (tenant_id, user_id, session_key, agent_id, channel, turn_id, turn_index,
        user_input, provider, model, system_prompt, messages, tools,
        request_params, response, stop_reason, error_message,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
      [
        params.tenantId,
        params.userId ?? null,
        params.sessionKey ?? null,
        params.agentId ?? null,
        params.channel ?? null,
        params.turnId,
        params.turnIndex,
        params.userInput ?? null,
        params.provider ?? null,
        params.model ?? null,
        params.systemPrompt ?? null,
        sanitizeJson(params.messages),
        sanitizeJson(params.tools),
        sanitizeJson(params.requestParams),
        sanitizeJson(params.response),
        params.stopReason ?? null,
        params.errorMessage ?? null,
        params.inputTokens ?? 0,
        params.outputTokens ?? 0,
        params.cacheReadTokens ?? 0,
        params.cacheWriteTokens ?? 0,
        params.durationMs ?? null,
      ],
    );
  } catch (err) {
    console.error("[interaction-trace] Failed to record trace:", err);
  }
}

export async function listInteractionTraces(
  tenantId: string,
  opts?: {
    sessionKey?: string;
    agentId?: string;
    userId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  },
): Promise<{ traces: LlmInteractionTrace[]; total: number }> {
  if (getDbType() === DB_SQLITE) return sqliteTrace.listInteractionTraces(tenantId, opts);
  const conditions = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];
  let idx = 2;

  if (opts?.sessionKey) {
    conditions.push(`session_key = $${idx++}`);
    values.push(opts.sessionKey);
  }
  if (opts?.agentId) {
    conditions.push(`agent_id = $${idx++}`);
    values.push(opts.agentId);
  }
  if (opts?.userId) {
    conditions.push(`user_id = $${idx++}`);
    values.push(opts.userId);
  }
  if (opts?.since) {
    conditions.push(`created_at >= $${idx++}`);
    values.push(opts.since);
  }
  if (opts?.until) {
    conditions.push(`created_at < $${idx++}`);
    values.push(opts.until);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await query(
    `SELECT COUNT(*) as total FROM llm_interaction_traces ${where}`,
    values,
  );
  const total = parseInt(String(countResult.rows[0].total), 10);

  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;
  values.push(limit, offset);

  const result = await query(
    `SELECT * FROM llm_interaction_traces ${where}
     ORDER BY created_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    values,
  );

  return { traces: result.rows.map(rowToTrace), total };
}

export async function getInteractionsByTurn(turnId: string): Promise<LlmInteractionTrace[]> {
  if (getDbType() === DB_SQLITE) return sqliteTrace.getInteractionsByTurn(turnId);
  const result = await query(
    "SELECT * FROM llm_interaction_traces WHERE turn_id = $1 ORDER BY turn_index ASC",
    [turnId],
  );
  return result.rows.map(rowToTrace);
}

export async function getInteractionTrace(id: string): Promise<LlmInteractionTrace | null> {
  if (getDbType() === DB_SQLITE) return sqliteTrace.getInteractionTrace(id);
  const result = await query(
    "SELECT * FROM llm_interaction_traces WHERE id = $1",
    [id],
  );
  return result.rows.length > 0 ? rowToTrace(result.rows[0]) : null;
}

/**
 * List turns (grouped) for a tenant - returns one row per turn with aggregated info.
 */
export async function listInteractionTurns(
  tenantId: string,
  opts?: {
    sessionKey?: string;
    agentId?: string;
    userId?: string;
    since?: Date;
    until?: Date;
    limit?: number;
    offset?: number;
  },
): Promise<{
  turns: Array<{
    turnId: string;
    userInput: string | null;
    agentId: string | null;
    channel: string | null;
    userId: string | null;
    sessionKey: string | null;
    provider: string | null;
    model: string | null;
    interactionCount: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalDurationMs: number;
    createdAt: Date;
  }>;
  total: number;
}> {
  if (getDbType() === DB_SQLITE) return sqliteTrace.listInteractionTurns(tenantId, opts);
  const conditions = ["tenant_id = $1"];
  const values: unknown[] = [tenantId];
  let idx = 2;

  if (opts?.sessionKey) {
    conditions.push(`session_key = $${idx++}`);
    values.push(opts.sessionKey);
  }
  if (opts?.agentId) {
    conditions.push(`agent_id = $${idx++}`);
    values.push(opts.agentId);
  }
  if (opts?.userId) {
    conditions.push(`user_id = $${idx++}`);
    values.push(opts.userId);
  }
  if (opts?.since) {
    conditions.push(`created_at >= $${idx++}`);
    values.push(opts.since);
  }
  if (opts?.until) {
    conditions.push(`created_at < $${idx++}`);
    values.push(opts.until);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await query(
    `SELECT COUNT(DISTINCT turn_id) as total FROM llm_interaction_traces ${where}`,
    values,
  );
  const total = parseInt(String(countResult.rows[0].total), 10);

  const limit = Math.min(opts?.limit ?? 50, 200);
  const offset = opts?.offset ?? 0;
  values.push(limit, offset);

  const result = await query(
    `SELECT
       turn_id,
       MAX(CASE WHEN turn_index = 0 THEN user_input END) as user_input,
       MAX(agent_id::text) as agent_id,
       MAX(channel::text) as channel,
       MAX(user_id::text) as user_id,
       MAX(session_key::text) as session_key,
       MAX(provider::text) as provider,
       MAX(model::text) as model,
       COUNT(*) as interaction_count,
       COALESCE(SUM(input_tokens), 0) as total_input_tokens,
       COALESCE(SUM(output_tokens), 0) as total_output_tokens,
       COALESCE(SUM(duration_ms), 0) as total_duration_ms,
       MIN(created_at) as created_at
     FROM llm_interaction_traces ${where}
     GROUP BY turn_id
     ORDER BY MIN(created_at) DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    values,
  );

  return {
    turns: result.rows.map((row) => ({
      turnId: row.turn_id as string,
      userInput: (row.user_input as string) ?? null,
      agentId: (row.agent_id as string) ?? null,
      channel: (row.channel as string) ?? null,
      userId: (row.user_id as string) ?? null,
      sessionKey: (row.session_key as string) ?? null,
      provider: (row.provider as string) ?? null,
      model: (row.model as string) ?? null,
      interactionCount: parseInt(String(row.interaction_count), 10),
      totalInputTokens: parseInt(String(row.total_input_tokens), 10),
      totalOutputTokens: parseInt(String(row.total_output_tokens), 10),
      totalDurationMs: parseInt(String(row.total_duration_ms), 10),
      createdAt: row.created_at as Date,
    })),
    total,
  };
}
