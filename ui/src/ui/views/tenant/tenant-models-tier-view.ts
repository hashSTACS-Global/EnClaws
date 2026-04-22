/**
 * Pure helpers for the "by tier" view of tenant-models.
 *
 * Keeps the existing Provider-container data model untouched and just
 * projects it into a tier-grouped flat list for rendering / filtering.
 */

import type { ModelTierValue } from "../../../constants/providers.ts";

export type TierBucket = ModelTierValue | "unassigned";

export const TIER_BUCKET_ORDER: readonly TierBucket[] = ["pro", "standard", "lite", "unassigned"];

export interface FlatModelEntry {
  providerId: string;
  providerName: string;
  providerType: string;
  isActive: boolean;
  isShared: boolean;
  modelId: string;
  modelName: string;
  tier?: ModelTierValue;
  reasoning: boolean;
}

/**
 * Subset of TenantModelConfig needed for tier grouping. Kept loose so the
 * helper doesn't pull in the whole Lit component file.
 */
export interface GroupableProvider {
  id: string;
  providerType: string;
  providerName: string;
  visibility?: string;
  isActive: boolean;
  models: Array<{
    id: string;
    name: string;
    tier?: ModelTierValue;
    reasoning?: boolean;
  }>;
}

/** Flatten every (provider × model) pair into a single entry list. */
export function flattenProviders(providers: GroupableProvider[]): FlatModelEntry[] {
  const out: FlatModelEntry[] = [];
  for (const p of providers) {
    const isShared = p.visibility === "shared";
    for (const m of p.models) {
      out.push({
        providerId: p.id,
        providerName: p.providerName,
        providerType: p.providerType,
        isActive: p.isActive,
        isShared,
        modelId: m.id,
        modelName: m.name,
        tier: m.tier,
        reasoning: !!m.reasoning,
      });
    }
  }
  return out;
}

/**
 * Group flat entries into a per-tier record. Tier=undefined entries go to
 * "unassigned" — rendered in a separate section so admins know which models
 * are still using the runtime standard fallback.
 */
export function groupByTier(entries: FlatModelEntry[]): Record<TierBucket, FlatModelEntry[]> {
  const buckets: Record<TierBucket, FlatModelEntry[]> = {
    pro: [],
    standard: [],
    lite: [],
    unassigned: [],
  };
  for (const e of entries) {
    const key: TierBucket = e.tier ?? "unassigned";
    buckets[key].push(e);
  }
  return buckets;
}

/** Convenience: providers → tier buckets in one call. */
export function groupProvidersByTier(providers: GroupableProvider[]): Record<TierBucket, FlatModelEntry[]> {
  return groupByTier(flattenProviders(providers));
}
