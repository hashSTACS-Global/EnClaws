/**
 * Customer Service Message CRUD — dual PostgreSQL / SQLite support.
 *
 * 客服消息 CRUD，支持 PostgreSQL 和 SQLite 双后端。
 */

import { query, getDbType, DB_SQLITE } from "../index.js";
import { sqliteQuery } from "../sqlite/index.js";
import type { CSMessage, CSMessageRole } from "../../customer-service/types.js";
import type { ConfidenceResult } from "../../customer-service/confidence.js";

// -- Row mapper --

function rowToMessage(row: Record<string, unknown>): CSMessage {
  const parseJson = (val: unknown) => {
    if (typeof val === "string") {
      try { return JSON.parse(val); } catch { return null; }
    }
    return val ?? null;
  };

  return {
    id: row.id as string,
    sessionId: row.session_id as string,
    tenantId: row.tenant_id as string,
    role: row.role as CSMessageRole,
    content: row.content as string,
    confidence: parseJson(row.confidence) as ConfidenceResult | null,
    feedbackType: (row.feedback_type as string) ?? null,
    sourceChunks: parseJson(row.source_chunks) as unknown[] | null,
    createdAt: row.created_at as Date,
  };
}

// -- Create --

export async function createCSMessage(params: {
  sessionId: string;
  tenantId: string;
  role: CSMessageRole;
  content: string;
  confidence?: ConfidenceResult | null;
  sourceChunks?: unknown[] | null;
}): Promise<CSMessage> {
  if (getDbType() === DB_SQLITE) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    sqliteQuery(
      `INSERT INTO cs_messages (id, session_id, tenant_id, role, content, confidence, source_chunks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        params.sessionId,
        params.tenantId,
        params.role,
        params.content,
        params.confidence ? JSON.stringify(params.confidence) : null,
        params.sourceChunks ? JSON.stringify(params.sourceChunks) : null,
        now,
      ],
    );
    return getCSMessage(id) as Promise<CSMessage>;
  }

  const result = await query(
    `INSERT INTO cs_messages (session_id, tenant_id, role, content, confidence, source_chunks)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      params.sessionId,
      params.tenantId,
      params.role,
      params.content,
      params.confidence ? JSON.stringify(params.confidence) : null,
      params.sourceChunks ? JSON.stringify(params.sourceChunks) : null,
    ],
  );
  return rowToMessage(result.rows[0]);
}

// -- Get by ID --

export async function getCSMessage(id: string): Promise<CSMessage | null> {
  if (getDbType() === DB_SQLITE) {
    const result = sqliteQuery("SELECT * FROM cs_messages WHERE id = ?", [id]);
    return result.rows.length > 0 ? rowToMessage(result.rows[0] as Record<string, unknown>) : null;
  }
  const result = await query("SELECT * FROM cs_messages WHERE id = $1", [id]);
  return result.rows.length > 0 ? rowToMessage(result.rows[0]) : null;
}

// -- Get last message for a session (used in session list view) --
// 获取会话最后一条消息，用于后台会话列表展示"最后发言方"。

export async function getLastCSMessageForSession(sessionId: string): Promise<CSMessage | null> {
  if (getDbType() === DB_SQLITE) {
    const result = sqliteQuery(
      "SELECT * FROM cs_messages WHERE session_id = ? ORDER BY created_at DESC LIMIT 1",
      [sessionId],
    );
    return result.rows.length > 0 ? rowToMessage(result.rows[0] as Record<string, unknown>) : null;
  }
  const result = await query(
    "SELECT * FROM cs_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 1",
    [sessionId],
  );
  return result.rows.length > 0 ? rowToMessage(result.rows[0]) : null;
}

// -- List by session (paginated, chronological) --

export async function listCSMessages(
  sessionId: string,
  opts?: { limit?: number; beforeId?: string },
): Promise<CSMessage[]> {
  const limit = opts?.limit ?? 50;

  if (getDbType() === DB_SQLITE) {
    if (opts?.beforeId) {
      const result = sqliteQuery(
        `SELECT * FROM cs_messages
         WHERE session_id = ? AND created_at < (SELECT created_at FROM cs_messages WHERE id = ?)
         ORDER BY created_at DESC LIMIT ?`,
        [sessionId, opts.beforeId, limit],
      );
      return result.rows.map(rowToMessage).reverse();
    }
    const result = sqliteQuery(
      "SELECT * FROM cs_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?",
      [sessionId, limit],
    );
    return result.rows.map(rowToMessage);
  }

  if (opts?.beforeId) {
    const result = await query(
      `SELECT * FROM cs_messages
       WHERE session_id = $1 AND created_at < (SELECT created_at FROM cs_messages WHERE id = $2)
       ORDER BY created_at DESC LIMIT $3`,
      [sessionId, opts.beforeId, limit],
    );
    return result.rows.map(rowToMessage).reverse();
  }

  const result = await query(
    "SELECT * FROM cs_messages WHERE session_id = $1 ORDER BY created_at ASC LIMIT $2",
    [sessionId, limit],
  );
  return result.rows.map(rowToMessage);
}

// -- List low-confidence AI messages (Badcase queue) --
// 列出低置信度的 AI 回复（运营 Badcase 候选队列）。
//
// Filters cs_messages where role='ai' and confidence.verdict != 'ok'. Paired with
// preceding customer message for context. Used by the CS admin UI to surface
// questions the AI hallucinated or escalated.
//
// 过滤 role='ai' 且 confidence.verdict 不为 'ok' 的消息，并关联上一条客户提问，
// 供运营端排查 AI 兜底/涉敏/转人工的问题。

export interface LowConfidenceEntry {
  aiMessage: CSMessage;
  /** Preceding customer question in the same session (may be null if AI spoke first). */
  customerMessage: CSMessage | null;
  /** Visitor display name from cs_sessions. */
  visitorName: string | null;
}

export async function listLowConfidenceMessages(
  tenantId: string,
  opts?: { limit?: number; verdicts?: Array<"knowledge_gap" | "suspect_badcase"> },
): Promise<LowConfidenceEntry[]> {
  const limit = opts?.limit ?? 50;
  const verdicts = opts?.verdicts ?? ["knowledge_gap", "suspect_badcase"];

  // Confidence is stored as JSON. For portability we fetch candidates with role='ai'
  // and non-null confidence, then filter in memory. Dataset is small (per-tenant
  // low-confidence replies), so no perf concern.
  // confidence 以 JSON 存储；为跨 SQLite/PG 通用，先拉 role='ai' 且 confidence 非空，内存过滤。

  let aiRows: CSMessage[];
  if (getDbType() === DB_SQLITE) {
    const result = sqliteQuery(
      `SELECT * FROM cs_messages
       WHERE tenant_id = ? AND role = 'ai' AND confidence IS NOT NULL
       ORDER BY created_at DESC LIMIT ?`,
      [tenantId, limit * 3], // oversample then filter
    );
    aiRows = result.rows.map((r) => rowToMessage(r as Record<string, unknown>));
  } else {
    const result = await query(
      `SELECT * FROM cs_messages
       WHERE tenant_id = $1 AND role = 'ai' AND confidence IS NOT NULL
       ORDER BY created_at DESC LIMIT $2`,
      [tenantId, limit * 3],
    );
    aiRows = result.rows.map(rowToMessage);
  }

  const filtered = aiRows
    .filter((m) => m.confidence && verdicts.includes(m.confidence.verdict as "knowledge_gap" | "suspect_badcase"))
    .slice(0, limit);

  // Fetch preceding customer message + visitor name for each entry.
  // 为每条低置信回复找上一条客户提问 + 访客名。
  const entries: LowConfidenceEntry[] = [];
  for (const aiMessage of filtered) {
    let customerMessage: CSMessage | null = null;
    let visitorName: string | null = null;

    if (getDbType() === DB_SQLITE) {
      const prevResult = sqliteQuery(
        `SELECT * FROM cs_messages
         WHERE session_id = ? AND role = 'customer' AND created_at < ?
         ORDER BY created_at DESC LIMIT 1`,
        [aiMessage.sessionId, (aiMessage.createdAt as unknown as string) ?? new Date(aiMessage.createdAt).toISOString()],
      );
      if (prevResult.rows.length > 0) {
        customerMessage = rowToMessage(prevResult.rows[0] as Record<string, unknown>);
      }
      const sessResult = sqliteQuery(
        "SELECT visitor_name FROM cs_sessions WHERE id = ?",
        [aiMessage.sessionId],
      );
      if (sessResult.rows.length > 0) {
        visitorName = ((sessResult.rows[0] as Record<string, unknown>).visitor_name as string) ?? null;
      }
    } else {
      const prevResult = await query(
        `SELECT * FROM cs_messages
         WHERE session_id = $1 AND role = 'customer' AND created_at < $2
         ORDER BY created_at DESC LIMIT 1`,
        [aiMessage.sessionId, aiMessage.createdAt],
      );
      if (prevResult.rows.length > 0) {
        customerMessage = rowToMessage(prevResult.rows[0]);
      }
      const sessResult = await query(
        "SELECT visitor_name FROM cs_sessions WHERE id = $1",
        [aiMessage.sessionId],
      );
      if (sessResult.rows.length > 0) {
        visitorName = (sessResult.rows[0].visitor_name as string) ?? null;
      }
    }

    entries.push({ aiMessage, customerMessage, visitorName });
  }

  return entries;
}
