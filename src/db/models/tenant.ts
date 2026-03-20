/**
 * Tenant CRUD operations.
 */

import { query, withTransaction, getDbType, DB_SQLITE } from "../index.js";
import * as sqliteTenant from "../sqlite/models/tenant.js";
import type {
  Tenant,
  CreateTenantInput,
  TenantPlan,
  TenantQuotas,
  TenantSettings,
  TenantStatus,
} from "../types.js";

function rowToTenant(row: Record<string, unknown>): Tenant {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    plan: row.plan as TenantPlan,
    status: row.status as TenantStatus,
    settings: (row.settings ?? {}) as TenantSettings,
    quotas: (row.quotas ?? {}) as TenantQuotas,
    traceEnabled: (row.trace_enabled as boolean) ?? false,
    identityPrompt: (row.identity_prompt as string) ?? "",
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

const DEFAULT_QUOTAS: TenantQuotas = {
  maxUsers: 5,
  maxAgents: 3,
  maxChannels: 5,
  maxTokensPerMonth: 1_000_000,
};

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.createTenant(input);
  const quotas = { ...DEFAULT_QUOTAS, ...input.quotas };
  const result = await query(
    `INSERT INTO tenants (name, slug, plan, settings, quotas)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.name,
      input.slug,
      input.plan ?? "free",
      JSON.stringify(input.settings ?? {}),
      JSON.stringify(quotas),
    ],
  );
  return rowToTenant(result.rows[0]);
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.getTenantById(id);
  const result = await query("SELECT * FROM tenants WHERE id = $1", [id]);
  return result.rows.length > 0 ? rowToTenant(result.rows[0]) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.getTenantBySlug(slug);
  const result = await query("SELECT * FROM tenants WHERE slug = $1", [slug]);
  return result.rows.length > 0 ? rowToTenant(result.rows[0]) : null;
}

export async function listTenants(opts?: {
  status?: TenantStatus;
  limit?: number;
  offset?: number;
}): Promise<{ tenants: Tenant[]; total: number }> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.listTenants(opts);
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (opts?.status) {
    conditions.push(`status = $${idx++}`);
    values.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const [dataResult, countResult] = await Promise.all([
    query(`SELECT * FROM tenants ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`, [
      ...values,
      limit,
      offset,
    ]),
    query(`SELECT COUNT(*) as count FROM tenants ${where}`, values),
  ]);

  return {
    tenants: dataResult.rows.map(rowToTenant),
    total: parseInt(countResult.rows[0].count as string, 10),
  };
}

export async function updateTenant(
  id: string,
  updates: Partial<Pick<Tenant, "name" | "slug" | "plan" | "status" | "settings" | "quotas" | "traceEnabled" | "identityPrompt">>,
): Promise<Tenant | null> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.updateTenant(id, updates);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.name !== undefined) {
    sets.push(`name = $${idx++}`);
    values.push(updates.name);
  }
  if (updates.slug !== undefined) {
    sets.push(`slug = $${idx++}`);
    values.push(updates.slug);
  }
  if (updates.plan !== undefined) {
    sets.push(`plan = $${idx++}`);
    values.push(updates.plan);
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.settings !== undefined) {
    sets.push(`settings = $${idx++}`);
    values.push(JSON.stringify(updates.settings));
  }
  if (updates.quotas !== undefined) {
    sets.push(`quotas = $${idx++}`);
    values.push(JSON.stringify(updates.quotas));
  }
  if (updates.traceEnabled !== undefined) {
    sets.push(`trace_enabled = $${idx++}`);
    values.push(updates.traceEnabled);
  }
  if (updates.identityPrompt !== undefined) {
    sets.push(`identity_prompt = $${idx++}`);
    values.push(updates.identityPrompt);
  }

  if (sets.length === 0) return getTenantById(id);

  values.push(id);
  const result = await query(
    `UPDATE tenants SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows.length > 0 ? rowToTenant(result.rows[0]) : null;
}

export async function deleteTenant(id: string): Promise<boolean> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.deleteTenant(id);
  const result = await query(
    "UPDATE tenants SET status = 'deleted' WHERE id = $1 AND status != 'deleted'",
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Check if a tenant has exceeded a quota.
 */
export async function checkTenantQuota(
  tenantId: string,
  resource: "users" | "agents" | "channels",
): Promise<{ allowed: boolean; current: number; max: number }> {
  if (getDbType() === DB_SQLITE) return sqliteTenant.checkTenantQuota(tenantId, resource);
  const tenant = await getTenantById(tenantId);
  if (!tenant) return { allowed: false, current: 0, max: 0 };

  const tableMap = {
    users: "users",
    agents: "tenant_agents",
    channels: "tenant_channels",
  };
  const quotaKeyMap = {
    users: "maxUsers",
    agents: "maxAgents",
    channels: "maxChannels",
  } as const;

  const countResult = await query(
    `SELECT COUNT(*) as count FROM ${tableMap[resource]} WHERE tenant_id = $1`,
    [tenantId],
  );
  const current = parseInt(countResult.rows[0].count as string, 10);
  const max = tenant.quotas[quotaKeyMap[resource]];

  return { allowed: current < max, current, max };
}
