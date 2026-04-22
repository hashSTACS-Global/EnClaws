/**
 * Gateway RPC handlers for tenant-scoped model management.
 *
 * Methods:
 *   tenant.models.list    - List model configs for the current tenant
 *   tenant.models.create  - Create a new model config
 *   tenant.models.update  - Update a model config
 *   tenant.models.delete  - Delete a model config
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized, withTransaction, getDbType, DB_SQLITE } from "../../db/index.js";
import {
  createTenantModel,
  listTenantModels,
  getTenantModel,
  updateTenantModel,
  deleteTenantModel,
} from "../../db/models/tenant-model.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import { invalidateTenantConfigCache } from "../../config/tenant-config.js";
import { listTenantAgents } from "../../db/models/tenant-agent.js";
import type { TenantContext } from "../../auth/middleware.js";
import { isModelTier, type ModelTier, type TenantModelDefinition } from "../../db/types.js";

function getTenantCtx(
  client: GatewayRequestHandlerOptions["client"],
  respond: GatewayRequestHandlerOptions["respond"],
): TenantContext | null {
  if (!isDbInitialized()) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Multi-tenant mode not enabled"));
    return null;
  }
  const tenant = (client as unknown as { tenant?: TenantContext })?.tenant;
  if (!tenant) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Authentication required"));
    return null;
  }
  return tenant;
}

/** Strip api_key_encrypted from response for security. */
function sanitizeModel(m: Record<string, unknown>) {
  const { apiKeyEncrypted, ...rest } = m as Record<string, unknown> & { apiKeyEncrypted?: string };
  return { ...rest, hasApiKey: !!apiKeyEncrypted };
}

export const tenantModelsHandlers: GatewayRequestHandlers = {
  "tenant.models.list": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "model.list");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const models = await listTenantModels(ctx.tenantId, { activeOnly: false, includeShared: true });
    respond(true, {
      models: models.map((m) => sanitizeModel({
        id: m.id,
        providerType: m.providerType,
        providerName: m.providerName,
        baseUrl: m.baseUrl,
        apiProtocol: m.apiProtocol,
        authMode: m.authMode,
        apiKeyEncrypted: m.apiKeyEncrypted,
        extraHeaders: m.extraHeaders,
        extraConfig: m.extraConfig,
        models: m.models,
        visibility: m.visibility,
        isActive: m.isActive,
        createdBy: m.createdBy,
        createdAt: m.createdAt,
        updatedAt: m.updatedAt,
      })),
    });
  },

  "tenant.models.create": async ({ params, client, respond, context }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "model.create");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const {
      providerType, providerName, baseUrl, apiProtocol, authMode,
      apiKey, extraHeaders, extraConfig, models,
    } = params as {
      providerType: string;
      providerName: string;
      baseUrl?: string;
      apiProtocol?: string;
      authMode?: string;
      apiKey?: string;
      extraHeaders?: Record<string, string>;
      extraConfig?: Record<string, unknown>;
      models?: TenantModelDefinition[];
    };

    if (!providerType || !providerName) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing providerType or providerName"));
      return;
    }

    if (models && !Array.isArray(models)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "models must be an array"));
      return;
    }

    if (models) {
      const modelIds = new Set<string>();
      for (const m of models) {
        if (!m.id || !m.name) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Each model must have id and name"));
          return;
        }
        if (modelIds.has(m.id)) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, `Duplicate model id: ${m.id}`));
          return;
        }
        modelIds.add(m.id);
        if (!m.contextWindow) m.contextWindow = 128000;
      }
    }

    try {
      const model = await createTenantModel({
        tenantId: ctx.tenantId,
        providerType,
        providerName,
        baseUrl,
        apiProtocol,
        authMode,
        apiKeyEncrypted: apiKey ?? undefined,
        extraHeaders,
        extraConfig,
        models,
        createdBy: ctx.userId,
      });

      invalidateTenantConfigCache(ctx.tenantId);
      await context.reloadDbChannels();

      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "model.create",
        resource: `model:${model.id}`,
        detail: { providerType, providerName },
      });

      respond(true, sanitizeModel({
        id: model.id,
        providerType: model.providerType,
        providerName: model.providerName,
        baseUrl: model.baseUrl,
        apiProtocol: model.apiProtocol,
        authMode: model.authMode,
        apiKeyEncrypted: model.apiKeyEncrypted,
        extraHeaders: model.extraHeaders,
        extraConfig: model.extraConfig,
        models: model.models,
        isActive: model.isActive,
      }));
    } catch (err: unknown) {
      throw err;
    }
  },

  "tenant.models.update": async ({ params, client, respond, context }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "model.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const {
      id, providerName, baseUrl, apiProtocol, authMode,
      apiKey, extraHeaders, extraConfig, models, isActive,
    } = params as {
      id: string;
      providerName?: string;
      baseUrl?: string;
      apiProtocol?: string;
      authMode?: string;
      apiKey?: string;
      extraHeaders?: Record<string, string>;
      extraConfig?: Record<string, unknown>;
      models?: TenantModelDefinition[];
      isActive?: boolean;
    };

    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing id"));
      return;
    }

    if (models) {
      const modelIds = new Set<string>();
      for (const m of models) {
        if (!m.id || !m.name) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Each model must have id and name"));
          return;
        }
        if (modelIds.has(m.id)) {
          respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, `Duplicate model id: ${m.id}`));
          return;
        }
        modelIds.add(m.id);
        if (!m.contextWindow) m.contextWindow = 128000;
      }
    }

    // When models list changes, check if any removed modelId is referenced by agents
    if (models) {
      const existing = await getTenantModel(ctx.tenantId, id);
      if (existing) {
        const newModelIds = new Set(models.map((m) => m.id));
        const removedModelIds = (existing.models ?? [])
          .map((m) => m.id)
          .filter((mid) => !newModelIds.has(mid));

        if (removedModelIds.length > 0) {
          const agents = await listTenantAgents(ctx.tenantId);
          const conflicts: string[] = [];
          for (const agent of agents) {
            const boundRemoved = (agent.modelConfig ?? []).filter(
              (mc) => mc.providerId === id && removedModelIds.includes(mc.modelId),
            );
            if (boundRemoved.length > 0) {
              const modelIds = boundRemoved.map((mc) => mc.modelId).join(", ");
              conflicts.push(`${agent.name || agent.agentId} (${modelIds})`);
            }
          }
          if (conflicts.length > 0) {
            respond(false, undefined, errorShape(
              ErrorCodes.INVALID_REQUEST,
              "models.removeModelInUse",
              { details: { agents: conflicts.join("; ") } },
            ));
            return;
          }
        }
      }
    }

    const updates: Record<string, unknown> = {};
    if (providerName !== undefined) updates.providerName = providerName;
    if (baseUrl !== undefined) updates.baseUrl = baseUrl;
    if (apiProtocol !== undefined) updates.apiProtocol = apiProtocol;
    if (authMode !== undefined) updates.authMode = authMode;
    // v4: empty-string apiKey means "keep existing" (edit modal left blank intentionally).
    // Only overwrite when a non-empty value is supplied.
    if (apiKey !== undefined && apiKey !== "") updates.apiKeyEncrypted = apiKey;
    if (extraHeaders !== undefined) updates.extraHeaders = extraHeaders;
    if (extraConfig !== undefined) updates.extraConfig = extraConfig;
    if (models !== undefined) updates.models = models;
    if (isActive !== undefined) updates.isActive = isActive;

    const updated = await updateTenantModel(ctx.tenantId, id, updates as any);
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Model config not found"));
      return;
    }

    invalidateTenantConfigCache(ctx.tenantId);
    await context.reloadDbChannels();

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "model.update",
      resource: `model:${id}`,
      detail: { providerName: updated.providerName },
    });

    respond(true, sanitizeModel({
      id: updated.id,
      providerType: updated.providerType,
      providerName: updated.providerName,
      baseUrl: updated.baseUrl,
      apiProtocol: updated.apiProtocol,
      authMode: updated.authMode,
      apiKeyEncrypted: updated.apiKeyEncrypted,
      extraHeaders: updated.extraHeaders,
      extraConfig: updated.extraConfig,
      models: updated.models,
      isActive: updated.isActive,
    }));
  },

  /**
   * Probe whether a provider config actually works. Sends a minimal
   * "hi" prompt and reports status + duration. Does not write DB.
   *
   * apiKey == "" + providerId given → reuse the stored key (edit mode).
   * Supports openai-completions and anthropic-messages; other protocols
   * return an "unsupported protocol" error without calling out.
   */
  "tenant.models.testConnection": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "model.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const {
      baseUrl, apiProtocol, authMode, apiKey, modelId, providerId, extraHeaders,
    } = params as {
      baseUrl?: string; apiProtocol?: string; authMode?: string;
      apiKey?: string; modelId?: string; providerId?: string;
      extraHeaders?: Record<string, string>;
    };

    if (!baseUrl || !apiProtocol || !modelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "baseUrl, apiProtocol, modelId required"));
      return;
    }

    // Resolve key: blank + providerId → load from DB
    let effectiveKey = apiKey ?? "";
    if (!effectiveKey && providerId) {
      const existing = await getTenantModel(ctx.tenantId, providerId);
      effectiveKey = existing?.apiKeyEncrypted ?? "";
    }
    if ((authMode === "api-key" || authMode === "token") && !effectiveKey) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "apiKey required for this auth mode"));
      return;
    }

    const trimmedBase = baseUrl.replace(/\/+$/, "");
    const startedAt = Date.now();
    try {
      let url: string;
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      let body: Record<string, unknown>;
      if (apiProtocol === "anthropic-messages") {
        url = `${trimmedBase}/v1/messages`;
        headers["x-api-key"] = effectiveKey;
        headers["anthropic-version"] = "2023-06-01";
        body = { model: modelId, max_tokens: 4, messages: [{ role: "user", content: "ping" }] };
      } else if (apiProtocol === "openai-completions" || apiProtocol === "openai-responses" || apiProtocol === "ollama") {
        url = `${trimmedBase}/chat/completions`;
        if (effectiveKey) headers["Authorization"] = `Bearer ${effectiveKey}`;
        body = { model: modelId, messages: [{ role: "user", content: "ping" }], max_tokens: 4, stream: false };
      } else {
        respond(true, { ok: false, status: 0, durationMs: 0, errorMessage: `Unsupported protocol for test: ${apiProtocol}` });
        return;
      }
      if (extraHeaders) Object.assign(headers, extraHeaders);

      const resp = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      const durationMs = Date.now() - startedAt;
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        respond(true, { ok: false, status: resp.status, durationMs, errorMessage: text.slice(0, 300) });
        return;
      }
      respond(true, { ok: true, status: resp.status, durationMs });
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      respond(true, { ok: false, status: 0, durationMs, errorMessage: String(err).slice(0, 300) });
    }
  },

  /**
   * Atomically set the tenant-wide default model for a tier.
   *
   * Walks every private `tenant_models` row that has at least one model in the
   * target tier and rewrites its `models` JSONB so that, within the tier, only
   * the target (providerId, modelId) carries `isTierDefault=true`. The fan-out
   * runs inside a single transaction so partial failures cannot leave the
   * catalog with two (or zero) tier-default markers.
   */
  "tenant.models.setTierDefault": async ({ params, client, respond, context }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "model.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { tier, providerId, modelId } = params as {
      tier?: unknown;
      providerId?: unknown;
      modelId?: unknown;
    };
    if (!isModelTier(tier)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "tier must be lite|standard|pro"));
      return;
    }
    if (typeof providerId !== "string" || !providerId || typeof modelId !== "string" || !modelId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "providerId and modelId required"));
      return;
    }
    const targetTier: ModelTier = tier;

    // Load tenant's own catalog (shared platform models are read-only here).
    const all = await listTenantModels(ctx.tenantId, { activeOnly: false, includeShared: false });
    const targetProvider = all.find((p) => p.id === providerId);
    const targetModel = targetProvider?.models.find((m) => m.id === modelId);
    if (!targetProvider || !targetModel) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Target model not found"));
      return;
    }
    if ((targetModel.tier ?? "standard") !== targetTier) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        `Target model tier (${targetModel.tier ?? "unassigned"}) does not match requested tier '${targetTier}'`,
      ));
      return;
    }

    // Compute the rewrite per provider container. Skip providers whose
    // serialized models array doesn't need to change (idempotent call).
    type PendingUpdate = { id: string; models: TenantModelDefinition[] };
    const updatesToApply: PendingUpdate[] = [];
    for (const p of all) {
      if (!p.models.some((m) => m.tier === targetTier)) continue;

      let changed = false;
      const next: TenantModelDefinition[] = p.models.map((m) => {
        if (m.tier !== targetTier) return m;
        const shouldBeDefault = p.id === providerId && m.id === modelId;
        const currentIsDefault = m.isTierDefault === true;
        if (currentIsDefault === shouldBeDefault) return m;
        changed = true;
        return { ...m, isTierDefault: shouldBeDefault };
      });
      if (changed) updatesToApply.push({ id: p.id, models: next });
    }

    if (updatesToApply.length === 0) {
      respond(true, { updated: 0 });
      return;
    }

    // Atomic fan-out. SQLite: withTransaction holds BEGIN/COMMIT on the
    // singleton connection, so updateTenantModel participates via sqliteQuery.
    // PG: go through the transaction client directly; updateTenantModel would
    // otherwise pull a fresh pool connection outside the TX.
    await withTransaction(async (txClient) => {
      for (const u of updatesToApply) {
        if (getDbType() === DB_SQLITE) {
          await updateTenantModel(ctx.tenantId, u.id, { models: u.models });
        } else {
          await txClient.query(
            `UPDATE tenant_models SET models = $1 WHERE tenant_id = $2 AND id = $3`,
            [JSON.stringify(u.models), ctx.tenantId, u.id],
          );
        }
      }
    });

    invalidateTenantConfigCache(ctx.tenantId);
    await context.reloadDbChannels();

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "model.update",
      resource: `tier:${targetTier}`,
      detail: { tierDefault: `${providerId}:${modelId}`, affected: updatesToApply.length },
    });

    respond(true, { updated: updatesToApply.length });
  },

  "tenant.models.delete": async ({ params, client, respond, context }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "model.delete");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { id } = params as { id: string };
    if (!id) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing id"));
      return;
    }

    // Check if any agent references this model (as default or fallback)
    const agents = await listTenantAgents(ctx.tenantId);
    const referencingAgents = agents.filter((a) =>
      (a.modelConfig ?? []).some((mc) => mc.providerId === id),
    );
    if (referencingAgents.length > 0) {
      const names = referencingAgents.map((a) => a.name || a.agentId).join(", ");
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_REQUEST,
        "models.deleteInUse",
        { details: { agents: names } },
      ));
      return;
    }

    const deleted = await deleteTenantModel(ctx.tenantId, id);

    invalidateTenantConfigCache(ctx.tenantId);
    await context.reloadDbChannels();

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "model.delete",
      resource: `model:${id}`,
    });

    respond(true, { deleted });
  },
};
