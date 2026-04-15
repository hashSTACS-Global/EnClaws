import { listTenantModels } from "../../db/models/tenant-model.js";
import { getTenantAgent } from "../../db/models/tenant-agent.js";
import { logWarn } from "../../logger.js";
import type { ModelTier } from "./types.js";

export interface ModelTierMap {
  lite: string;
  standard: string;
  reasoning: string;
}

/**
 * Fallback tier map used only when DB query fails or returns nothing.
 */
export const DEFAULT_TIER_MAP: ModelTierMap = {
  lite: "claude-haiku-4-5-20251001",
  standard: "claude-sonnet-4-6",
  reasoning: "claude-opus-4-6",
};

// Cache per (tenantId, agentId) with 5-minute TTL
const cache = new Map<string, { map: ModelTierMap; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheKey(tenantId: string, agentId?: string): string {
  return agentId ? `${tenantId}:${agentId}` : tenantId;
}

/**
 * Resolve the model tier map for a tenant agent.
 *
 * Strategy:
 *  1. If agentId is provided → look up tenant_agents.model_config for that
 *     agent, find the entry with isDefault=true (fallback to first entry),
 *     verify it exists in tenant_models (active provider), and use that
 *     model ID for all three tiers (lite/standard/reasoning).
 *  2. Otherwise → scan all active tenant_models, pick the first model, use
 *     it for all three tiers.
 *  3. On any failure (DB error, no agent, no models) → DEFAULT_TIER_MAP.
 */
async function buildTierMapForAgent(tenantId: string, agentId?: string): Promise<ModelTierMap> {
  const ctx = `tenant=${tenantId} agent=${agentId ?? "(none)"}`;
  try {
    if (agentId) {
      const agent = await getTenantAgent(tenantId, agentId);
      if (!agent) {
        logWarn(`model-tier: [${ctx}] agent record not found in tenant_agents`);
      } else {
        const entries = agent.modelConfig ?? [];
        logWarn(
          `model-tier: [${ctx}] agent found, model_config has ${entries.length} entries: ${entries.map((e) => `${e.modelId}${e.isDefault ? "*" : ""}`).join(", ") || "(empty)"}`,
        );
        const defaultEntry = entries.find((e) => e.isDefault) ?? entries[0];
        if (defaultEntry) {
          logWarn(
            `model-tier: [${ctx}] selected entry providerId=${defaultEntry.providerId} modelId=${defaultEntry.modelId} isDefault=${defaultEntry.isDefault}`,
          );
          const providers = await listTenantModels(tenantId, { activeOnly: true });
          const provider = providers.find((p) => p.id === defaultEntry.providerId);
          if (!provider) {
            logWarn(`model-tier: [${ctx}] provider ${defaultEntry.providerId} not found or inactive`);
          } else if (!provider.models.some((m) => m.id === defaultEntry.modelId)) {
            logWarn(
              `model-tier: [${ctx}] model ${defaultEntry.modelId} not found in provider ${provider.providerName} (has: ${provider.models.map((m) => m.id).join(", ")})`,
            );
          } else {
            const modelId = defaultEntry.modelId;
            logWarn(`model-tier: [${ctx}] RESOLVED via agent default → "${modelId}"`);
            return { lite: modelId, standard: modelId, reasoning: modelId };
          }
        }
      }
    }

    // Fallback: first available active model
    logWarn(`model-tier: [${ctx}] falling back to first active tenant_models entry`);
    const providers = await listTenantModels(tenantId, { activeOnly: true });
    logWarn(`model-tier: [${ctx}] found ${providers.length} active providers`);
    for (const p of providers) {
      if (p.models.length > 0) {
        const modelId = p.models[0].id;
        logWarn(
          `model-tier: [${ctx}] RESOLVED via tenant fallback → provider="${p.providerName}" modelId="${modelId}"`,
        );
        return { lite: modelId, standard: modelId, reasoning: modelId };
      }
    }
    logWarn(`model-tier: [${ctx}] no active models at all, using hard-coded DEFAULT_TIER_MAP`);
  } catch (e) {
    logWarn(
      `model-tier: [${ctx}] DB lookup failed: ${e instanceof Error ? e.message : String(e)} — using DEFAULT_TIER_MAP`,
    );
  }

  return { ...DEFAULT_TIER_MAP };
}

/**
 * Resolve a concrete model ID for a pipeline's tier declaration.
 * All three tiers currently resolve to the agent's default model.
 */
export async function resolveModelTier(
  tier: ModelTier,
  tenantId?: string,
  agentIdOrMap?: string | ModelTierMap,
): Promise<string> {
  // Test override: explicit map
  if (agentIdOrMap && typeof agentIdOrMap !== "string") {
    return agentIdOrMap[tier];
  }
  const agentId = typeof agentIdOrMap === "string" ? agentIdOrMap : undefined;

  if (!tenantId) {
    logWarn(`model-tier: resolve tier="${tier}" without tenantId — using DEFAULT_TIER_MAP → "${DEFAULT_TIER_MAP[tier]}"`);
    return DEFAULT_TIER_MAP[tier];
  }

  const key = cacheKey(tenantId, agentId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    logWarn(
      `model-tier: resolve tier="${tier}" tenant=${tenantId} agent=${agentId ?? "(none)"} — cache HIT → "${cached.map[tier]}"`,
    );
    return cached.map[tier];
  }

  logWarn(
    `model-tier: resolve tier="${tier}" tenant=${tenantId} agent=${agentId ?? "(none)"} — cache MISS, querying DB`,
  );
  const map = await buildTierMapForAgent(tenantId, agentId);
  cache.set(key, { map, expiresAt: Date.now() + CACHE_TTL_MS });
  return map[tier];
}
