/**
 * Tenant-level statistics — SQLite implementation.
 */

import { sqliteQuery } from "../index.js";

function periodCondition(column: string, period: "all" | "month" | "today"): string {
  if (period === "month") return `${column} >= date('now', 'start of month')`;
  if (period === "today") return `${column} >= date('now')`;
  return "1=1";
}

function pInt(v: unknown): number {
  return parseInt(String(v ?? 0), 10) || 0;
}

export function getTenantSummary(tenantId: string) {
  const tenantRes = sqliteQuery("SELECT name, plan, status, slug, created_at FROM tenants WHERE id = ?", [tenantId]);
  const t = tenantRes.rows[0] ?? {};
  const adminRes = sqliteQuery("SELECT display_name FROM users WHERE tenant_id = ? AND role = 'owner' LIMIT 1", [tenantId]);

  const agentTotal = pInt(sqliteQuery("SELECT COUNT(*) as c FROM tenant_agents WHERE tenant_id = ?", [tenantId]).rows[0]?.c);
  const agentActive = pInt(sqliteQuery("SELECT COUNT(*) as c FROM tenant_agents WHERE tenant_id = ? AND is_active = 1", [tenantId]).rows[0]?.c);
  const agentActive30d = pInt(sqliteQuery("SELECT COUNT(DISTINCT agent_id) as c FROM llm_interaction_traces WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')", [tenantId]).rows[0]?.c);

  const channelTotal = pInt(sqliteQuery("SELECT COUNT(*) as c FROM tenant_channels WHERE tenant_id = ?", [tenantId]).rows[0]?.c);
  const channelActive = pInt(sqliteQuery("SELECT COUNT(*) as c FROM tenant_channels WHERE tenant_id = ? AND is_active = 1", [tenantId]).rows[0]?.c);
  const appCount = pInt(sqliteQuery("SELECT COUNT(*) as c FROM tenant_channel_apps WHERE tenant_id = ?", [tenantId]).rows[0]?.c);

  // Count models from JSON array in tenant_models.models column
  const modelRows = sqliteQuery("SELECT models FROM tenant_models WHERE tenant_id = ? AND is_active = 1", [tenantId]).rows;
  let modelTotal = 0;
  for (const r of modelRows) {
    try {
      const arr = typeof r.models === "string" ? JSON.parse(r.models) : r.models;
      if (Array.isArray(arr)) modelTotal += arr.length;
    } catch { /* skip */ }
  }
  const providerCount = modelRows.length;

  const userTotal = pInt(sqliteQuery("SELECT COUNT(DISTINCT COALESCE(union_id, id)) as c FROM users WHERE tenant_id = ? AND status = 'active'", [tenantId]).rows[0]?.c);
  const userActive30d = pInt(sqliteQuery("SELECT COUNT(DISTINCT user_id) as c FROM llm_interaction_traces WHERE tenant_id = ? AND created_at >= datetime('now', '-30 days')", [tenantId]).rows[0]?.c);

  const tokensAll = pInt(sqliteQuery("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = ?", [tenantId]).rows[0]?.c);
  const tokensMonth = pInt(sqliteQuery("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = ? AND recorded_at >= date('now', 'start of month')", [tenantId]).rows[0]?.c);
  const tokensToday = pInt(sqliteQuery("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = ? AND recorded_at >= date('now')", [tenantId]).rows[0]?.c);
  const tokensLastMonth = pInt(sqliteQuery("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = ? AND recorded_at >= date('now', 'start of month', '-1 month') AND recorded_at < date('now', 'start of month')", [tenantId]).rows[0]?.c);

  const quotasRaw = sqliteQuery("SELECT quotas FROM tenants WHERE id = ?", [tenantId]).rows[0]?.quotas;
  let quotas: Record<string, unknown> = {};
  try { quotas = typeof quotasRaw === "string" ? JSON.parse(quotasRaw) : (quotasRaw ?? {}); } catch { /* */ }

  return {
    tenant: {
      name: (t.name as string) ?? "-",
      plan: (t.plan as string) ?? "free",
      status: (t.status as string) ?? "active",
      slug: (t.slug as string) ?? "-",
      createdAt: t.created_at ? new Date(t.created_at as string).toISOString() : "",
      admin: (adminRes.rows[0]?.display_name as string) ?? "-",
    },
    agents: { total: agentTotal, active: agentActive, active30d: agentActive30d },
    channels: { total: channelTotal, active: channelActive, apps: appCount },
    models: { total: modelTotal, providers: providerCount },
    users: { total: userTotal, active30d: userActive30d },
    tokens: {
      all: tokensAll, month: tokensMonth, today: tokensToday,
      quota: pInt(quotas.maxTokensPerMonth), lastMonth: tokensLastMonth,
    },
  };
}

export function getTenantTokenTrend(tenantId: string, days = 7) {
  const result = sqliteQuery(
    `SELECT DATE(recorded_at) AS day,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM usage_records
     WHERE tenant_id = ? AND recorded_at >= datetime('now', ?)
     GROUP BY DATE(recorded_at) ORDER BY day ASC`,
    [tenantId, `-${days} days`],
  );
  return result.rows.map((r: any) => {
    const d = new Date(r.day as string);
    return { date: `${d.getMonth() + 1}/${d.getDate()}`, inputTokens: pInt(r.input_tokens), outputTokens: pInt(r.output_tokens) };
  });
}

export function getTenantTokenRank(tenantId: string, period: "all" | "month" | "today" = "all", limit = 5) {
  const cond = periodCondition("ur.recorded_at", period);
  const condNoAlias = periodCondition("recorded_at", period);

  const usersRes = sqliteQuery(
    `SELECT COALESCE(u.display_name, u.email, ur.user_id) AS name, SUM(ur.input_tokens + ur.output_tokens) AS tokens
     FROM usage_records ur LEFT JOIN users u ON u.tenant_id = ur.tenant_id AND (ur.user_id = u.id OR ur.user_id = u.union_id)
     WHERE ur.tenant_id = ? AND ${cond}
     GROUP BY ur.user_id ORDER BY tokens DESC LIMIT ?`,
    [tenantId, limit],
  );
  const modelsRes = sqliteQuery(
    `SELECT model, SUM(input_tokens + output_tokens) AS tokens
     FROM usage_records WHERE tenant_id = ? AND model IS NOT NULL AND ${condNoAlias}
     GROUP BY model ORDER BY tokens DESC LIMIT ?`,
    [tenantId, limit],
  );
  const agentsRes = sqliteQuery(
    `SELECT COALESCE(ta.name, ur.agent_id) AS name, SUM(ur.input_tokens + ur.output_tokens) AS tokens
     FROM usage_records ur LEFT JOIN tenant_agents ta ON ur.agent_id = ta.agent_id AND ta.tenant_id = ur.tenant_id
     WHERE ur.tenant_id = ? AND ur.agent_id IS NOT NULL AND ${cond}
     GROUP BY ur.agent_id ORDER BY tokens DESC LIMIT ?`,
    [tenantId, limit],
  );

  const modelTotal = modelsRes.rows.reduce((s: number, r: any) => s + pInt(r.tokens), 0);

  return {
    users: usersRes.rows.map((r: any) => ({ name: (r.name as string) || "-", tokens: pInt(r.tokens) })),
    models: modelsRes.rows.map((r: any) => {
      const tokens = pInt(r.tokens);
      return { model: r.model as string, tokens, percent: modelTotal > 0 ? Math.round(tokens / modelTotal * 1000) / 10 : 0 };
    }),
    agents: agentsRes.rows.map((r: any) => ({ name: (r.name as string) || "-", tokens: pInt(r.tokens) })),
  };
}

export function getTenantLlmStats(tenantId: string, period: "all" | "month" | "today" = "all") {
  const cond = periodCondition("created_at", period);
  const where = `tenant_id = ? AND ${cond}`;

  const turns = pInt(sqliteQuery(`SELECT COUNT(DISTINCT turn_id) as c FROM llm_interaction_traces WHERE ${where}`, [tenantId]).rows[0]?.c);
  const avgDurationMs = Math.round(parseFloat(String(sqliteQuery(`SELECT AVG(duration_ms) as avg_ms FROM llm_interaction_traces WHERE duration_ms IS NOT NULL AND ${where}`, [tenantId]).rows[0]?.avg_ms)) || 0);
  const errorRow = sqliteQuery(`SELECT COUNT(CASE WHEN error_message IS NOT NULL OR stop_reason = 'error' THEN 1 END) as err, COUNT(*) as total FROM llm_interaction_traces WHERE ${where}`, [tenantId]).rows[0];
  const errCount = pInt(errorRow?.err);
  const totalCount = pInt(errorRow?.total);
  const errorRate = totalCount > 0 ? Math.round(errCount / totalCount * 1000) / 10 : 0;

  const modelRes = sqliteQuery(`SELECT model, COUNT(*) as count FROM llm_interaction_traces WHERE model IS NOT NULL AND ${where} GROUP BY model ORDER BY count DESC`, [tenantId]);
  const modelTotalCount = modelRes.rows.reduce((s: number, r: any) => s + pInt(r.count), 0);

  return {
    turns, avgDurationMs, errorRate,
    modelDistribution: modelRes.rows.map((r: any) => {
      const count = pInt(r.count);
      return { model: r.model as string, count, percent: modelTotalCount > 0 ? Math.round(count / modelTotalCount * 100) : 0 };
    }),
  };
}

export function getTenantChannelDistribution(tenantId: string) {
  const result = sqliteQuery(
    `SELECT tc.channel_type AS type, COUNT(ca.id) AS count
     FROM tenant_channels tc LEFT JOIN tenant_channel_apps ca ON ca.channel_id = tc.id
     WHERE tc.tenant_id = ? AND tc.is_active = 1
     GROUP BY tc.channel_type ORDER BY count DESC`,
    [tenantId],
  );
  return result.rows.map((r: any) => ({ type: r.type as string, count: pInt(r.count) }));
}

export function getTenantRecentTraces(tenantId: string, limit = 10) {
  const result = sqliteQuery(
    `SELECT COALESCE(ta.name, t.agent_id) AS agent_name,
            COALESCE((SELECT display_name FROM users
                      WHERE tenant_id = t.tenant_id AND (id = t.user_id OR union_id = t.user_id)
                      LIMIT 1), t.user_id) AS user_name,
            t.model,
            (t.input_tokens + t.output_tokens) AS tokens,
            t.created_at
     FROM llm_interaction_traces t
     LEFT JOIN tenant_agents ta ON ta.agent_id = t.agent_id AND ta.tenant_id = t.tenant_id
     WHERE t.tenant_id = ? AND t.turn_index = 0
     ORDER BY t.created_at DESC LIMIT ?`,
    [tenantId, limit],
  );
  return result.rows.map((r: any) => ({
    agentName: (r.agent_name as string) || "-",
    userName: (r.user_name as string) || "-",
    model: (r.model as string) || "-",
    tokens: pInt(r.tokens),
    createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : "",
  }));
}
