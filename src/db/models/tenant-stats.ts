/**
 * Tenant-level statistics — scoped to a single tenant.
 * Used by the enterprise overview dashboard.
 */

import { query, getDbType, DB_SQLITE } from "../index.js";
import * as sqliteStats from "../sqlite/models/tenant-stats.js";

function periodCondition(column: string, period: "all" | "month" | "today"): string {
  if (period === "month") return `${column} >= DATE_TRUNC('month', NOW())`;
  if (period === "today") return `${column} >= DATE_TRUNC('day', NOW())`;
  return "1=1";
}

function pInt(v: unknown): number {
  return parseInt(String(v ?? 0), 10) || 0;
}

export async function getTenantSummary(tenantId: string) {
  if (getDbType() === DB_SQLITE) return sqliteStats.getTenantSummary(tenantId);

  const [
    tenantRes, agentTotal, agentActive, agentActive30d,
    channelTotal, channelActive, appCount,
    modelCount, providerCount,
    userTotal, userActive30d,
    tokensAll, tokensMonth, tokensToday, tokensLastMonth, quotaRes,
  ] = await Promise.all([
    query("SELECT name, plan, status, slug, created_at FROM tenants WHERE id = $1", [tenantId]),
    query("SELECT COUNT(*) as c FROM tenant_agents WHERE tenant_id = $1", [tenantId]),
    query("SELECT COUNT(*) as c FROM tenant_agents WHERE tenant_id = $1 AND is_active = true", [tenantId]),
    query("SELECT COUNT(DISTINCT agent_id) as c FROM llm_interaction_traces WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'", [tenantId]),
    query("SELECT COUNT(*) as c FROM tenant_channels WHERE tenant_id = $1", [tenantId]),
    query("SELECT COUNT(*) as c FROM tenant_channels WHERE tenant_id = $1 AND is_active = true", [tenantId]),
    query("SELECT COUNT(*) as c FROM tenant_channel_apps WHERE tenant_id = $1", [tenantId]),
    query("SELECT COALESCE(SUM(jsonb_array_length(models)), 0) as c FROM tenant_models WHERE tenant_id = $1 AND is_active = true", [tenantId]),
    query("SELECT COUNT(*) as c FROM tenant_models WHERE tenant_id = $1 AND is_active = true", [tenantId]),
    query("SELECT COUNT(*) as c FROM users WHERE tenant_id = $1 AND status != 'deleted'", [tenantId]),
    query("SELECT COUNT(DISTINCT user_id) as c FROM llm_interaction_traces WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'", [tenantId]),
    query("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = $1", [tenantId]),
    query("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = $1 AND recorded_at >= DATE_TRUNC('month', NOW())", [tenantId]),
    query("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = $1 AND recorded_at >= DATE_TRUNC('day', NOW())", [tenantId]),
    query("SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as c FROM usage_records WHERE tenant_id = $1 AND recorded_at >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' AND recorded_at < DATE_TRUNC('month', NOW())", [tenantId]),
    query("SELECT quotas FROM tenants WHERE id = $1", [tenantId]),
  ]);

  const t = tenantRes.rows[0] ?? {};
  const admin = await query("SELECT display_name FROM users WHERE tenant_id = $1 AND role = 'owner' LIMIT 1", [tenantId]);
  const quotas = (quotaRes.rows[0]?.quotas ?? {}) as Record<string, unknown>;

  return {
    tenant: {
      name: (t.name as string) ?? "-",
      plan: (t.plan as string) ?? "free",
      status: (t.status as string) ?? "active",
      slug: (t.slug as string) ?? "-",
      createdAt: t.created_at ? new Date(t.created_at as string).toISOString() : "",
      admin: (admin.rows[0]?.display_name as string) ?? "-",
    },
    agents: { total: pInt(agentTotal.rows[0]?.c), active: pInt(agentActive.rows[0]?.c), active30d: pInt(agentActive30d.rows[0]?.c) },
    channels: { total: pInt(channelTotal.rows[0]?.c), active: pInt(channelActive.rows[0]?.c), apps: pInt(appCount.rows[0]?.c) },
    models: { total: pInt(modelCount.rows[0]?.c), providers: pInt(providerCount.rows[0]?.c) },
    users: { total: pInt(userTotal.rows[0]?.c), active30d: pInt(userActive30d.rows[0]?.c) },
    tokens: {
      all: pInt(tokensAll.rows[0]?.c),
      month: pInt(tokensMonth.rows[0]?.c),
      today: pInt(tokensToday.rows[0]?.c),
      quota: pInt(quotas.maxTokensPerMonth),
      lastMonth: pInt(tokensLastMonth.rows[0]?.c),
    },
  };
}

export async function getTenantTokenTrend(tenantId: string, days = 7) {
  if (getDbType() === DB_SQLITE) return sqliteStats.getTenantTokenTrend(tenantId, days);

  const result = await query(
    `SELECT DATE(recorded_at) AS day,
            COALESCE(SUM(input_tokens), 0) AS input_tokens,
            COALESCE(SUM(output_tokens), 0) AS output_tokens
     FROM usage_records
     WHERE tenant_id = $1 AND recorded_at >= NOW() - $2::INTERVAL
     GROUP BY DATE(recorded_at) ORDER BY day ASC`,
    [tenantId, `${days} days`],
  );
  return result.rows.map((r) => {
    const d = new Date(r.day as string);
    return { date: `${d.getMonth() + 1}/${d.getDate()}`, inputTokens: pInt(r.input_tokens), outputTokens: pInt(r.output_tokens) };
  });
}

export async function getTenantTokenRank(tenantId: string, period: "all" | "month" | "today" = "all", limit = 5) {
  if (getDbType() === DB_SQLITE) return sqliteStats.getTenantTokenRank(tenantId, period, limit);

  const cond = periodCondition("ur.recorded_at", period);

  const [usersRes, modelsRes, agentsRes] = await Promise.all([
    query(
      `SELECT COALESCE(u.display_name, u.email, ur.user_id) AS name, SUM(ur.input_tokens + ur.output_tokens) AS tokens
       FROM usage_records ur LEFT JOIN users u ON u.tenant_id = ur.tenant_id AND (ur.user_id = u.id::text OR ur.user_id = u.union_id)
       WHERE ur.tenant_id = $1 AND ${cond}
       GROUP BY ur.user_id, u.display_name, u.email ORDER BY tokens DESC LIMIT $2`,
      [tenantId, limit],
    ),
    query(
      `SELECT model, SUM(input_tokens + output_tokens) AS tokens
       FROM usage_records WHERE tenant_id = $1 AND model IS NOT NULL AND ${cond.replace("ur.recorded_at", "recorded_at")}
       GROUP BY model ORDER BY tokens DESC LIMIT $2`,
      [tenantId, limit],
    ),
    query(
      `SELECT COALESCE(ta.name, ur.agent_id) AS name, SUM(ur.input_tokens + ur.output_tokens) AS tokens
       FROM usage_records ur LEFT JOIN tenant_agents ta ON ur.agent_id = ta.agent_id AND ta.tenant_id = ur.tenant_id
       WHERE ur.tenant_id = $1 AND ur.agent_id IS NOT NULL AND ${cond}
       GROUP BY ur.agent_id, ta.name ORDER BY tokens DESC LIMIT $2`,
      [tenantId, limit],
    ),
  ]);

  const modelTotal = modelsRes.rows.reduce((s, r) => s + pInt(r.tokens), 0);

  return {
    users: usersRes.rows.map((r) => ({ name: (r.name as string) || "-", tokens: pInt(r.tokens) })),
    models: modelsRes.rows.map((r) => {
      const tokens = pInt(r.tokens);
      return { model: r.model as string, tokens, percent: modelTotal > 0 ? Math.round(tokens / modelTotal * 1000) / 10 : 0 };
    }),
    agents: agentsRes.rows.map((r) => ({ name: (r.name as string) || "-", tokens: pInt(r.tokens) })),
  };
}

export async function getTenantLlmStats(tenantId: string, period: "all" | "month" | "today" = "all") {
  if (getDbType() === DB_SQLITE) return sqliteStats.getTenantLlmStats(tenantId, period);

  const cond = periodCondition("created_at", period);
  const where = `tenant_id = $1 AND ${cond}`;

  const [turnsRes, avgRes, errorRes, modelRes] = await Promise.all([
    query(`SELECT COUNT(DISTINCT turn_id) as c FROM llm_interaction_traces WHERE ${where}`, [tenantId]),
    query(`SELECT AVG(duration_ms) as avg_ms FROM llm_interaction_traces WHERE duration_ms IS NOT NULL AND ${where}`, [tenantId]),
    query(`SELECT COUNT(CASE WHEN error_message IS NOT NULL OR stop_reason = 'error' THEN 1 END) as err, COUNT(*) as total FROM llm_interaction_traces WHERE ${where}`, [tenantId]),
    query(`SELECT model, COUNT(*) as count FROM llm_interaction_traces WHERE model IS NOT NULL AND ${where} GROUP BY model ORDER BY count DESC`, [tenantId]),
  ]);

  const turns = pInt(turnsRes.rows[0]?.c);
  const avgDurationMs = Math.round(parseFloat(String(avgRes.rows[0]?.avg_ms)) || 0);
  const errCount = pInt(errorRes.rows[0]?.err);
  const totalCount = pInt(errorRes.rows[0]?.total);
  const errorRate = totalCount > 0 ? Math.round(errCount / totalCount * 1000) / 10 : 0;
  const modelTotalCount = modelRes.rows.reduce((s, r) => s + pInt(r.count), 0);

  return {
    turns, avgDurationMs, errorRate,
    modelDistribution: modelRes.rows.map((r) => {
      const count = pInt(r.count);
      return { model: r.model as string, count, percent: modelTotalCount > 0 ? Math.round(count / modelTotalCount * 100) : 0 };
    }),
  };
}

export async function getTenantChannelDistribution(tenantId: string) {
  if (getDbType() === DB_SQLITE) return sqliteStats.getTenantChannelDistribution(tenantId);

  const result = await query(
    `SELECT tc.channel_type AS type, COUNT(ca.id) AS count
     FROM tenant_channels tc LEFT JOIN tenant_channel_apps ca ON ca.channel_id = tc.id
     WHERE tc.tenant_id = $1 AND tc.is_active = true
     GROUP BY tc.channel_type ORDER BY count DESC`,
    [tenantId],
  );
  return result.rows.map((r) => ({ type: r.type as string, count: pInt(r.count) }));
}

export async function getTenantRecentTraces(tenantId: string, limit = 10) {
  if (getDbType() === DB_SQLITE) return sqliteStats.getTenantRecentTraces(tenantId, limit);

  const result = await query(
    `SELECT COALESCE(ta.name, t.agent_id) AS agent_name,
            COALESCE(u.display_name, t.user_id) AS user_name,
            t.model,
            (t.input_tokens + t.output_tokens) AS tokens,
            t.created_at
     FROM llm_interaction_traces t
     LEFT JOIN tenant_agents ta ON ta.agent_id = t.agent_id AND ta.tenant_id = t.tenant_id
     LEFT JOIN users u ON u.tenant_id = t.tenant_id AND (t.user_id = u.id::text OR t.user_id = u.union_id)
     WHERE t.tenant_id = $1 AND t.turn_index = 0
     ORDER BY t.created_at DESC LIMIT $2`,
    [tenantId, limit],
  );
  return result.rows.map((r) => ({
    agentName: (r.agent_name as string) || "-",
    userName: (r.user_name as string) || "-",
    model: (r.model as string) || "-",
    tokens: pInt(r.tokens),
    createdAt: r.created_at ? new Date(r.created_at as string).toISOString() : "",
  }));
}
