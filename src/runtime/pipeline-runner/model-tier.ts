import { listTenantModels } from "../../db/models/tenant-model.js";
import type { TenantModelDefinition } from "../../db/types.js";
import { logWarn } from "../../logger.js";
import type { ModelTier } from "./types.js";

export interface ModelTierMap {
  lite: string;
  standard: string;
  reasoning: string;
}

/**
 * Fallback tier map used only when DB query fails or returns no models.
 */
export const DEFAULT_TIER_MAP: ModelTierMap = {
  lite: "claude-haiku-4-5-20251001",
  standard: "claude-sonnet-4-6",
  reasoning: "claude-opus-4-6",
};

/**
 * Build a ModelTierMap from the tenant's active model definitions.
 *
 * Rules:
 * - 1 model  → all three tiers use that model
 * - 2+ models → reasoning=true models fill the `reasoning` tier,
 *   remaining fill `standard` and `lite` (first non-reasoning → standard,
 *   second → lite; if only one non-reasoning, it fills both)
 */
function buildTierMapFromModels(models: TenantModelDefinition[]): ModelTierMap {
  if (models.length === 0) {
    return { ...DEFAULT_TIER_MAP };
  }
  if (models.length === 1) {
    const id = models[0].id;
    return { lite: id, standard: id, reasoning: id };
  }

  const reasoningModels = models.filter((m) => m.reasoning);
  const nonReasoningModels = models.filter((m) => !m.reasoning);

  const reasoning = reasoningModels.length > 0 ? reasoningModels[0].id : models[0].id;
  const standard = nonReasoningModels.length > 0 ? nonReasoningModels[0].id : models[0].id;
  const lite = nonReasoningModels.length > 1 ? nonReasoningModels[1].id : standard;

  return { lite, standard, reasoning };
}

// In-memory cache per tenant, TTL 5 minutes
const cache = new Map<string, { map: ModelTierMap; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Resolve the concrete model ID for a given tier.
 * When tenantId is provided, queries tenant_models from DB (cached 5min).
 * Falls back to DEFAULT_TIER_MAP on DB errors or missing tenant config.
 */
export async function resolveModelTier(
  tier: ModelTier,
  tenantId?: string,
  map?: ModelTierMap,
): Promise<string> {
  // Explicit map override (used by tests)
  if (map) return map[tier];

  // No tenant → use defaults
  if (!tenantId) return DEFAULT_TIER_MAP[tier];

  // Check cache
  const cached = cache.get(tenantId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.map[tier];
  }

  // Query DB
  try {
    const tenantModels = await listTenantModels(tenantId, { activeOnly: true });
    // Flatten all model definitions from all active providers
    const allModels: TenantModelDefinition[] = [];
    for (const tm of tenantModels) {
      if (tm.models && tm.models.length > 0) {
        allModels.push(...tm.models);
      }
    }
    const tierMap = buildTierMapFromModels(allModels);
    cache.set(tenantId, { map: tierMap, expiresAt: Date.now() + CACHE_TTL_MS });
    return tierMap[tier];
  } catch (e) {
    logWarn(
      `model-tier: failed to load tenant models for ${tenantId}, using defaults: ${e instanceof Error ? e.message : String(e)}`,
    );
    return DEFAULT_TIER_MAP[tier];
  }
}
