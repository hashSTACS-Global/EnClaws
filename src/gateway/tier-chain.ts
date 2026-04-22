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
 * @param modelConfig  The agent's configured (providerId, modelId, isDefault) list
 * @param tenantModels The tenant's model catalog (used to look up each entry's tier)
 * @param requestedTier Explicit tier requested by the caller, or undefined to infer
 *                      the default tier from the first isDefault entry
 * @throws TierChainError "NO_DEFAULT"          no tier requested and no isDefault entry
 * @throws TierChainError "TIER_NOT_CONFIGURED" resolved tier has no usable entries
 */
export function resolveTierChain(
  modelConfig: ModelConfigEntry[],
  tenantModels: TenantModel[],
  requestedTier: ModelTier | undefined,
): ModelConfigEntry[] {
  const tierByKey = new Map<string, ModelTier>();
  for (const tm of tenantModels) {
    for (const def of tm.models) {
      tierByKey.set(`${tm.id}:${def.id}`, normalizeTier(def.tier));
    }
  }

  let tier = requestedTier;
  if (!tier) {
    const firstDefault = modelConfig.find((e) => e.isDefault);
    const inferred = firstDefault
      ? tierByKey.get(`${firstDefault.providerId}:${firstDefault.modelId}`)
      : undefined;
    if (!inferred) {
      throw new TierChainError("NO_DEFAULT", "NO_DEFAULT: no default tier configured");
    }
    tier = inferred;
  }

  // Filter to same-tier entries; stale entries (model removed from the
  // catalog) yield undefined from tierByKey, naturally excluding them.
  const chain = modelConfig.filter(
    (e) => tierByKey.get(`${e.providerId}:${e.modelId}`) === tier,
  );

  if (chain.length === 0) {
    throw new TierChainError(
      "TIER_NOT_CONFIGURED",
      `TIER_NOT_CONFIGURED: tier '${tier}' has no configured models`,
    );
  }

  // Stable sort: isDefault=true first, then original order preserved.
  // Array.prototype.sort is stable in Node 22+ / V8, so equal-key entries
  // keep their input order.
  return chain.slice().sort((a, b) => Number(b.isDefault) - Number(a.isDefault));
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
