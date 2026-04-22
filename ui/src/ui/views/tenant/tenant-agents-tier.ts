/**
 * Pure helpers powering the tier-checkbox replacement for the Agent
 * modelConfig picker (Task 2.5).
 *
 * Keeps the Lit component in tenant-agents.ts focused on rendering; all
 * derivations (tier grouping, enabled-tier inference, default picking,
 * modelConfig projection) live here so they're unit-testable without a DOM.
 *
 * Legacy-data policy: models with tier=undefined are treated as 'standard'
 * at every layer — mirrors src/gateway/tier-chain.ts (runtime),
 * src/gateway/server-methods/tenant-agents-api.ts (validator),
 * and the UI add-form helpers. Keep LEGACY_TIER_FALLBACK in sync.
 */

import type { ModelTierValue } from "../../../constants/providers.ts";

const LEGACY_TIER_FALLBACK: ModelTierValue = "standard";

/**
 * Tier display order (pro → standard → lite). Mirrors TIER_BUCKET_ORDER
 * from tenant-models-tier-view.ts minus the 'unassigned' bucket (which
 * isn't visible here: legacy entries get folded into 'standard').
 */
export const TIER_DISPLAY_ORDER: readonly ModelTierValue[] = ["pro", "standard", "lite"];

// ─── Public shape (loose/lite to avoid coupling to TenantModelConfig) ─────

export interface TenantModelLite {
  id: string;
  providerType: string;
  providerName: string;
  isActive: boolean;
  visibility?: string;
  models: Array<{ id: string; name: string; tier?: ModelTierValue; isTierDefault?: boolean }>;
}

export interface ModelConfigEntryLite {
  providerId: string;
  modelId: string;
  isDefault: boolean;
}

export interface TierGroupEntry {
  providerId: string;
  modelId: string;
  modelName: string;
  legacy: boolean;
  providerType: string;
  providerName: string;
  isTierDefault: boolean;
}

export interface TierGroup {
  tier: ModelTierValue;
  models: TierGroupEntry[];
}

// ─── tenantTierGroups ─────────────────────────────────────────────────────

/**
 * Group the tenant's active model catalog into per-tier buckets, ordered
 * pro → standard → lite. Buckets that end up empty are omitted so the UI
 * renders only the tiers admins can actually choose.
 */
export function tenantTierGroups(tenantModels: TenantModelLite[]): TierGroup[] {
  const buckets = new Map<ModelTierValue, TierGroupEntry[]>();
  for (const tm of tenantModels) {
    if (!tm.isActive) continue;
    for (const def of tm.models) {
      const tier: ModelTierValue = def.tier ?? LEGACY_TIER_FALLBACK;
      if (!buckets.has(tier)) buckets.set(tier, []);
      buckets.get(tier)!.push({
        providerId: tm.id,
        modelId: def.id,
        modelName: def.name,
        legacy: def.tier === undefined,
        providerType: tm.providerType,
        providerName: tm.providerName,
        isTierDefault: def.isTierDefault === true,
      });
    }
  }
  const out: TierGroup[] = [];
  for (const tier of TIER_DISPLAY_ORDER) {
    const list = buckets.get(tier);
    if (list && list.length > 0) out.push({ tier, models: list });
  }
  return out;
}

// ─── deriveEnabledTiers ───────────────────────────────────────────────────

/**
 * Look up which tiers are currently enabled for an agent, inferred from
 * the tier of each modelConfig entry (legacy = standard). Returns each
 * tier at most once. Stale entries (model removed from the catalog) are
 * silently skipped.
 */
export function deriveEnabledTiers(
  modelConfig: ModelConfigEntryLite[] | undefined,
  tenantModels: TenantModelLite[],
): ModelTierValue[] {
  if (!modelConfig || modelConfig.length === 0) return [];
  const tierByKey = buildTierIndex(tenantModels);
  const seen = new Set<ModelTierValue>();
  for (const entry of modelConfig) {
    const tier = tierByKey.get(key(entry.providerId, entry.modelId));
    if (tier) seen.add(tier);
  }
  // Preserve canonical display order
  return TIER_DISPLAY_ORDER.filter((t) => seen.has(t));
}

// ─── pickTierDefault ──────────────────────────────────────────────────────

/**
 * The (providerId, modelId) currently marked isDefault=true within `tier`
 * for the given agent, or undefined if no such entry exists.
 */
export function pickTierDefault(
  tier: ModelTierValue,
  modelConfig: ModelConfigEntryLite[] | undefined,
  tenantModels: TenantModelLite[],
): { providerId: string; modelId: string } | undefined {
  if (!modelConfig) return undefined;
  const tierByKey = buildTierIndex(tenantModels);
  for (const entry of modelConfig) {
    if (!entry.isDefault) continue;
    if (tierByKey.get(key(entry.providerId, entry.modelId)) === tier) {
      return { providerId: entry.providerId, modelId: entry.modelId };
    }
  }
  return undefined;
}

// ─── projectModelConfig ───────────────────────────────────────────────────

/**
 * Build the modelConfig array to send to tenant.agents.update from the
 * admin's chosen set of enabled tiers.
 *
 *  - For each enabled tier, every model in that tier (catalog order)
 *    gets an entry. This lets the runtime failover chain see backups.
 *  - Per-tier default is preserved from priorConfig when the referenced
 *    model is still listed; otherwise the first model in the tier becomes
 *    the new default.
 *  - Tiers that don't exist in the catalog are silently dropped.
 *  - Legacy models participate in the 'standard' projection.
 */
export function projectModelConfig(
  enabledTiers: ModelTierValue[],
  tenantModels: TenantModelLite[],
  priorConfig?: ModelConfigEntryLite[],
): ModelConfigEntryLite[] {
  const groups = tenantTierGroups(tenantModels);
  const byTier = new Map(groups.map((g) => [g.tier, g.models]));
  const out: ModelConfigEntryLite[] = [];

  // Only the first tier in enabledTiers (the agent's default tier; the caller
  // places it first in orderedTiers) gets an isDefault=true slot — and only
  // one within that tier, chosen by prior user choice > tenant isTierDefault
  // > first listed. Every other entry in the flattened array is a fallback
  // with isDefault=false.
  //
  // Why: toConfigAgentsList (src/db/models/tenant-agent.ts) translates the
  // flattened modelConfig into a {primary, fallbacks[]} shape that pi-
  // embedded-runner consumes, and that format requires exactly one global
  // primary. Standing multiple isDefault=true flags collapses the fallback
  // list because `filter(!isDefault)` drops every other isDefault=true slot
  // — the very bug this rewrite fixes.
  for (let tierIdx = 0; tierIdx < enabledTiers.length; tierIdx++) {
    const tier = enabledTiers[tierIdx];
    const models = byTier.get(tier);
    if (!models || models.length === 0) continue;

    const isDefaultTier = tierIdx === 0;
    let chosenKey: string | null = null;
    if (isDefaultTier) {
      const priorDefault = priorConfig?.find((e) => {
        if (!e.isDefault) return false;
        return models.some((m) => m.providerId === e.providerId && m.modelId === e.modelId);
      });
      const tierDefault = models.find((m) => m.isTierDefault);
      chosenKey = priorDefault
        ? key(priorDefault.providerId, priorDefault.modelId)
        : tierDefault
          ? key(tierDefault.providerId, tierDefault.modelId)
          : key(models[0].providerId, models[0].modelId);
    }

    for (const m of models) {
      out.push({
        providerId: m.providerId,
        modelId: m.modelId,
        isDefault: isDefaultTier && key(m.providerId, m.modelId) === chosenKey,
      });
    }
  }
  return out;
}

// ─── deriveAgentDefaultTier ───────────────────────────────────────────────

/**
 * Read the agent's preferred default tier for cross-tier fallback.
 *
 * Source of truth: `agent.config.defaultTier`. When that's missing/invalid
 * we fall back to the tier of the first isDefault=true entry in modelConfig
 * so legacy agents (pre-v4 where no config.defaultTier was ever written)
 * keep a sensible default without a migration. Returns undefined only when
 * both sources are empty.
 *
 * Accepts a loose shape so the Lit component can pass its internal agent
 * record directly without conversion.
 */
export function deriveAgentDefaultTier(
  agent: { config?: Record<string, unknown>; modelConfig?: ModelConfigEntryLite[] },
  tenantModels: TenantModelLite[],
): ModelTierValue | undefined {
  const candidate = agent.config?.defaultTier;
  if (candidate === "pro" || candidate === "standard" || candidate === "lite") {
    return candidate;
  }
  const tierByKey = buildTierIndex(tenantModels);
  const firstDefault = agent.modelConfig?.find((e) => e.isDefault);
  if (!firstDefault) return undefined;
  return tierByKey.get(key(firstDefault.providerId, firstDefault.modelId));
}

// ─── internals ────────────────────────────────────────────────────────────

function key(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function buildTierIndex(
  tenantModels: TenantModelLite[],
): Map<string, ModelTierValue> {
  const idx = new Map<string, ModelTierValue>();
  for (const tm of tenantModels) {
    if (!tm.isActive) continue;
    for (const def of tm.models) {
      idx.set(key(tm.id, def.id), def.tier ?? LEGACY_TIER_FALLBACK);
    }
  }
  return idx;
}
