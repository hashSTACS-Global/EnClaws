/**
 * Pure helper that picks the model-config chain for a given request tier.
 *
 * Returns the subset of a tenant-agent's modelConfig that belongs to the
 * resolved tier, ordered so the isDefault=true entry comes first and the
 * remaining entries keep their original relative order (stable).
 *
 * Used by the gateway chat handler to drive per-tier failover:
 *   - First entry is the primary; remaining are backups within the same tier
 *   - Cross-tier fallback is intentionally not performed — each tier
 *     represents a cost/capability budget and silently escalating
 *     would violate the admin's intent
 *
 * Legacy data compatibility: TenantModelDefinition entries whose `tier`
 * field is undefined are treated as "standard" (see LEGACY_TIER_FALLBACK),
 * matching the validator in tenant-agents-api.ts and the UI helpers.
 */

import type { ModelConfigEntry, ModelTier, TenantModel } from "../db/types.js";
import { coerceToFailoverError } from "../agents/failover-error.js";

export type TierChainErrorCode = "TIER_NOT_CONFIGURED" | "NO_DEFAULT";

export class TierChainError extends Error {
  readonly code: TierChainErrorCode;
  constructor(code: TierChainErrorCode, message: string) {
    super(message);
    this.name = "TierChainError";
    this.code = code;
  }
}

const LEGACY_TIER_FALLBACK: ModelTier = "standard";

function normalizeTier(raw: ModelTier | undefined): ModelTier {
  return raw ?? LEGACY_TIER_FALLBACK;
}

/**
 * Build the ordered failover chain for a request.
 *
 * Behavior depends on whether the caller supplies an explicit tier:
 *  - requestedTier provided → strict single-tier chain; exhaustion surfaces
 *    as TIER_EXHAUSTED upstream (no cross-tier fallback). Intended for
 *    scene-specific routing where callers mean exactly what they asked for.
 *  - requestedTier undefined → multi-tier chain: agent's default tier first,
 *    remaining enabled tiers appended in modelConfig appearance order. Lets
 *    an agent hedge against an entire tier outage when the caller doesn't
 *    care about scene-specific constraints.
 *
 * Within any tier, entries are re-sorted so isDefault=true comes first
 * (stable). Stale entries (model no longer in catalog) are dropped silently.
 *
 * @param modelConfig     The agent's configured entries
 * @param tenantModels    Tenant model catalog (used for tier lookup)
 * @param requestedTier   Explicit per-request tier override, or undefined
 * @param agentDefaultTier The agent's preferred default tier (from
 *                        agent.config.defaultTier). Used only when
 *                        requestedTier is undefined. Falls back to the tier
 *                        of the first isDefault=true entry if not supplied.
 * @throws TierChainError "NO_DEFAULT"          no tier requested and no isDefault entry,
 *                                              or agentDefaultTier points at a tier with no entries
 * @throws TierChainError "TIER_NOT_CONFIGURED" requestedTier has no usable entries
 */
export function resolveTierChain(
  modelConfig: ModelConfigEntry[],
  tenantModels: TenantModel[],
  requestedTier: ModelTier | undefined,
  agentDefaultTier?: ModelTier,
): ModelConfigEntry[] {
  const tierByKey = new Map<string, ModelTier>();
  for (const tm of tenantModels) {
    for (const def of tm.models) {
      tierByKey.set(`${tm.id}:${def.id}`, normalizeTier(def.tier));
    }
  }

  const tierOf = (entry: ModelConfigEntry) =>
    tierByKey.get(`${entry.providerId}:${entry.modelId}`);

  // Explicit per-request tier: strict single-tier chain (no cross-tier fallback).
  if (requestedTier) {
    const chain = modelConfig.filter((e) => tierOf(e) === requestedTier);
    if (chain.length === 0) {
      throw new TierChainError(
        "TIER_NOT_CONFIGURED",
        `TIER_NOT_CONFIGURED: tier '${requestedTier}' has no configured models`,
      );
    }
    return chain.slice().sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
  }

  // No explicit tier: multi-tier fallback using the agent's default tier.
  // Resolve the default tier from either the agent config override or the
  // first isDefault=true entry (legacy/back-compat path).
  let defaultTier: ModelTier | undefined = agentDefaultTier;
  if (!defaultTier) {
    const firstDefault = modelConfig.find((e) => e.isDefault);
    defaultTier = firstDefault ? tierOf(firstDefault) : undefined;
  }

  if (!defaultTier) {
    throw new TierChainError("NO_DEFAULT", "NO_DEFAULT: no default tier configured");
  }

  // Validate the default tier actually has entries; if an explicit
  // agentDefaultTier points at a tier with no modelConfig entries, surface
  // NO_DEFAULT rather than silently dropping it — the agent's config is
  // inconsistent and the caller should know.
  const defaultTierEntries = modelConfig.filter((e) => tierOf(e) === defaultTier);
  if (defaultTierEntries.length === 0) {
    throw new TierChainError(
      "NO_DEFAULT",
      `NO_DEFAULT: agent default tier '${defaultTier}' has no configured models`,
    );
  }

  // Collect backup tiers in modelConfig appearance order, deduped, excluding
  // the default tier.
  const backupTiers: ModelTier[] = [];
  const seen = new Set<ModelTier>([defaultTier]);
  for (const entry of modelConfig) {
    const t = tierOf(entry);
    if (!t || seen.has(t)) continue;
    seen.add(t);
    backupTiers.push(t);
  }

  const sortedTier = (tier: ModelTier): ModelConfigEntry[] =>
    modelConfig
      .filter((e) => tierOf(e) === tier)
      .slice()
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

  const chain = [
    ...sortedTier(defaultTier),
    ...backupTiers.flatMap((t) => sortedTier(t)),
  ];
  return chain;
}

/**
 * Decide whether a failed LLM call within a tier-chain attempt should
 * trigger a fall-through to the next entry.
 *
 * Retriable (move to next model):
 *   - 5xx, 429, network timeouts, "timeout" reason
 * Not retriable (bail immediately — user error / config error):
 *   - 400 format, 401/403 auth, 402 billing, content_policy, unknown
 *
 * Returns { retriable, status }: the status is the classified HTTP code
 * (useful for the non-retriable path to surface back to the caller).
 */
export function isRetriableFailover(err: unknown): {
  retriable: boolean;
  status: number | undefined;
} {
  const rawStatus =
    typeof (err as { status?: unknown })?.status === "number"
      ? ((err as { status: number }).status)
      : undefined;
  const fe = coerceToFailoverError(err);
  const status = fe?.status ?? rawStatus;

  // 5xx is always retriable — we want to try the next model regardless of
  // whether coerceToFailoverError had a mapped reason (500 maps to null;
  // 502/503/504 map to 'timeout'). Keep this check first.
  if (typeof status === "number" && status >= 500 && status <= 599) {
    return { retriable: true, status };
  }

  if (fe && (fe.reason === "rate_limit" || fe.reason === "timeout")) {
    return { retriable: true, status };
  }

  return { retriable: false, status };
}
