import type { ModelTier } from "./types.js";

export interface ModelTierMap {
  lite: string;
  standard: string;
  reasoning: string;
}

/**
 * Default tier map. These Claude model IDs are **placeholders**; the real
 * tier-to-model mapping comes from EC config at provider-adapter wire-up
 * time (see Task 19 provider-adapter.ts). Phase 1's LLM step and tests use
 * this default when no custom map is provided, which keeps the unit tests
 * vendor-agnostic from the resolver's perspective.
 */
export const DEFAULT_TIER_MAP: ModelTierMap = {
  lite: "claude-haiku-4-5-20251001",
  standard: "claude-sonnet-4-6",
  reasoning: "claude-opus-4-6",
};

export function resolveModelTier(tier: ModelTier, map: ModelTierMap = DEFAULT_TIER_MAP): string {
  return map[tier];
}
