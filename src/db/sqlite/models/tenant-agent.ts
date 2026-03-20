/**
 * Tenant Agent CRUD — SQLite implementation.
 */

import { sqliteQuery, generateUUID } from "../index.js";
import type { TenantAgent, ModelConfigEntry } from "../../types.js";

function rowToAgent(row: Record<string, unknown>): TenantAgent {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    agentId: row.agent_id as string,
    name: (row.name as string) ?? null,
    config: (typeof row.config === "string" ? JSON.parse(row.config) : row.config ?? {}) as Record<string, unknown>,
    channelAppId: (row.channel_app_id as string) ?? null,
    modelConfig: (typeof row.model_config === "string" ? JSON.parse(row.model_config) : row.model_config ?? []) as ModelConfigEntry[],
    isActive: Boolean(row.is_active),
    createdBy: (row.created_by as string) ?? null,
    createdAt: new Date(row.created_at as string),
    updatedAt: new Date(row.updated_at as string),
  };
}

export async function createTenantAgent(params: {
  tenantId: string;
  agentId: string;
  name?: string;
  config?: Record<string, unknown>;
  channelAppId?: string;
  modelConfig?: ModelConfigEntry[];
  createdBy?: string;
}): Promise<TenantAgent> {
  const id = generateUUID();
  sqliteQuery(
    `INSERT INTO tenant_agents (id, tenant_id, agent_id, name, config, channel_app_id, model_config, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, params.tenantId, params.agentId, params.name, JSON.stringify(params.config ?? {}), params.channelAppId ?? null, JSON.stringify(params.modelConfig ?? []), params.createdBy ?? null],
  );
  const result = sqliteQuery("SELECT * FROM tenant_agents WHERE id = ?", [id]);
  return rowToAgent(result.rows[0]);
}

export async function getTenantAgent(tenantId: string, agentId: string): Promise<TenantAgent | null> {
  const result = sqliteQuery(
    "SELECT * FROM tenant_agents WHERE tenant_id = ? AND agent_id = ?",
    [tenantId, agentId],
  );
  return result.rows.length > 0 ? rowToAgent(result.rows[0]) : null;
}

export async function listTenantAgents(
  tenantId: string,
  opts?: { activeOnly?: boolean; createdBy?: string },
): Promise<TenantAgent[]> {
  const conditions = ["tenant_id = ?"];
  const values: unknown[] = [tenantId];

  if (opts?.activeOnly !== false) {
    conditions.push("is_active = 1");
  }
  if (opts?.createdBy) {
    conditions.push("created_by = ?");
    values.push(opts.createdBy);
  }

  const result = sqliteQuery(
    `SELECT * FROM tenant_agents WHERE ${conditions.join(" AND ")} ORDER BY created_at ASC`,
    values,
  );
  return result.rows.map(rowToAgent);
}

export async function updateTenantAgent(
  tenantId: string,
  agentId: string,
  updates: Partial<Pick<TenantAgent, "name" | "config" | "channelAppId" | "modelConfig" | "isActive">>,
): Promise<TenantAgent | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    sets.push("name = ?");
    values.push(updates.name);
  }
  if (updates.config !== undefined) {
    sets.push("config = ?");
    values.push(JSON.stringify(updates.config));
  }
  if (updates.channelAppId !== undefined) {
    sets.push("channel_app_id = ?");
    values.push(updates.channelAppId);
  }
  if (updates.modelConfig !== undefined) {
    sets.push("model_config = ?");
    values.push(JSON.stringify(updates.modelConfig));
  }
  if (updates.isActive !== undefined) {
    sets.push("is_active = ?");
    values.push(updates.isActive);
  }

  if (sets.length === 0) return getTenantAgent(tenantId, agentId);

  values.push(tenantId, agentId);
  sqliteQuery(
    `UPDATE tenant_agents SET ${sets.join(", ")} WHERE tenant_id = ? AND agent_id = ?`,
    values,
  );
  return getTenantAgent(tenantId, agentId);
}

export async function deleteTenantAgent(tenantId: string, agentId: string): Promise<boolean> {
  const result = sqliteQuery(
    "DELETE FROM tenant_agents WHERE tenant_id = ? AND agent_id = ?",
    [tenantId, agentId],
  );
  return result.rowCount > 0;
}

