/**
 * Tenant CRUD operations — SQLite implementation.
 */

import { sqliteQuery, generateUUID } from "../index.js";
import type {
  Tenant,
  CreateTenantInput,
  TenantPlan,
  TenantQuotas,
  TenantSettings,
  TenantStatus,
} from "../../types.js";

function rowToTenant(row: Record<string, unknown>): Tenant {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    plan: row.plan as TenantPlan,
    status: row.status as TenantStatus,
    settings: (typeof row.settings === "string" ? JSON.parse(row.settings) : row.settings ?? {}) as TenantSettings,
    quotas: (typeof row.quotas === "string" ? JSON.parse(row.quotas) : row.quotas ?? {}) as TenantQuotas,
    traceEnabled: Boolean(row.trace_enabled),
    identityPrompt: (row.identity_prompt as string) ?? "",
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

const DEFAULT_QUOTAS: TenantQuotas = {
  maxUsers: 5,
  maxAgents: 3,
  maxChannels: 5,
  maxTokensPerMonth: 1_000_000,
};

export async function createTenant(input: CreateTenantInput): Promise<Tenant> {
  const id = generateUUID();
  const quotas = { ...DEFAULT_QUOTAS, ...input.quotas };

  sqliteQuery(
    `INSERT INTO tenants (id, name, slug, plan, settings, quotas)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.name,
      input.slug,
      input.plan ?? "free",
      JSON.stringify(input.settings ?? {}),
      JSON.stringify(quotas),
    ],
  );

  const result = sqliteQuery("SELECT * FROM tenants WHERE id = ?", [id]);
  return rowToTenant(result.rows[0]);
}

export async function getTenantById(id: string): Promise<Tenant | null> {
  const result = sqliteQuery("SELECT * FROM tenants WHERE id = ?", [id]);
  return result.rows.length > 0 ? rowToTenant(result.rows[0]) : null;
}

export async function getTenantBySlug(slug: string): Promise<Tenant | null> {
  const result = sqliteQuery("SELECT * FROM tenants WHERE slug = ?", [slug]);
  return result.rows.length > 0 ? rowToTenant(result.rows[0]) : null;
}

export async function listTenants(opts?: {
  status?: TenantStatus;
  limit?: number;
  offset?: number;
}): Promise<{ tenants: Tenant[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts?.status) {
    conditions.push("status = ?");
    values.push(opts.status);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const dataResult = sqliteQuery(
    `SELECT * FROM tenants ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...values, limit, offset],
  );
  const countResult = sqliteQuery(
    `SELECT COUNT(*) as count FROM tenants ${where}`,
    values,
  );

  return {
    tenants: dataResult.rows.map(rowToTenant),
    total: Number(countResult.rows[0].count),
  };
}

export async function updateTenant(
  id: string,
  updates: Partial<Pick<Tenant, "name" | "slug" | "plan" | "status" | "settings" | "quotas" | "traceEnabled" | "identityPrompt">>,
): Promise<Tenant | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.slug !== undefined) {
    sets.push("slug = ?");
    values.push(updates.slug);
  }
  if (updates.plan !== undefined) {
    sets.push("plan = ?");
    values.push(updates.plan);
  }
  if (updates.status !== undefined) {
    sets.push("status = ?");
    values.push(updates.status);
  }
  if (updates.settings !== undefined) {
    sets.push("settings = ?");
    values.push(JSON.stringify(updates.settings));
  }
  if (updates.quotas !== undefined) {
    sets.push("quotas = ?");
    values.push(JSON.stringify(updates.quotas));
  }
  if (updates.traceEnabled !== undefined) {
    sets.push("trace_enabled = ?");
    values.push(updates.traceEnabled);
  }
  if (updates.identityPrompt !== undefined) {
    sets.push("identity_prompt = ?");
    values.push(updates.identityPrompt);
  }

  if (sets.length === 0) {return getTenantById(id);}

  values.push(id);
  sqliteQuery(
    `UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`,
    values,
  );

  return getTenantById(id);
}

export async function deleteTenant(id: string): Promise<boolean> {
  const result = sqliteQuery(
    "UPDATE tenants SET status = 'deleted' WHERE id = ? AND status != 'deleted'",
    [id],
  );
  return result.rowCount > 0;
}

export async function checkTenantQuota(
  tenantId: string,
  resource: "users" | "agents" | "channels",
): Promise<{ allowed: boolean; current: number; max: number }> {
  const tenant = await getTenantById(tenantId);
  if (!tenant) {return { allowed: false, current: 0, max: 0 };}

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

  const countResult = sqliteQuery(
    `SELECT COUNT(*) as count FROM ${tableMap[resource]} WHERE tenant_id = ?`,
    [tenantId],
  );
  const current = Number(countResult.rows[0].count);
  const max = tenant.quotas[quotaKeyMap[resource]];

  return { allowed: current < max, current, max };
}
