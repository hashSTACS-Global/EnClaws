/**
 * Unit tests for resolveTierChain — the pure function that picks the
 * ordered model-config chain for a request's target tier.
 *
 *  Contract summary:
 *   - Input: modelConfig (per-agent entries), tenantModels (for tier lookup),
 *     requestedTier (undefined means 'use the tier of the first isDefault')
 *   - Output: the subset of modelConfig entries belonging to that tier,
 *     sorted so isDefault=true comes first. Stable otherwise.
 *   - Errors:
 *       NO_DEFAULT           - requestedTier undefined AND no isDefault entry
 *       TIER_NOT_CONFIGURED  - resolved tier has zero entries in modelConfig
 *   - Legacy: models with tier=undefined are treated as 'standard'
 *     (matches src/gateway/server-methods/tenant-agents-api.ts
 *     LEGACY_TIER_FALLBACK + the UI helpers).
 */

import { describe, expect, it } from "vitest";
import { resolveTierChain, TierChainError } from "./tier-chain.js";
import type { ModelConfigEntry, ModelTier, TenantModel } from "../db/types.js";

function mkModel(
  id: string,
  modelId: string,
  tier?: ModelTier,
): TenantModel {
  const now = new Date("2026-04-22T00:00:00Z");
  return {
    id,
    tenantId: "t1",
    providerType: "anthropic",
    providerName: "X",
    baseUrl: null,
    apiProtocol: "anthropic-messages",
    authMode: "api-key",
    apiKeyEncrypted: null,
    extraHeaders: {},
    extraConfig: {},
    models: [{ id: modelId, name: modelId, ...(tier ? { tier } : {}) }],
    visibility: "private",
    isActive: true,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

const models: TenantModel[] = [
  mkModel("p1", "opus", "pro"),
  mkModel("p2", "sonnet", "standard"),
  mkModel("p3", "qwen", "standard"),
  mkModel("p4", "haiku", "lite"),
];

const fullCfg: ModelConfigEntry[] = [
  { providerId: "p1", modelId: "opus", isDefault: true }, // pro default
  { providerId: "p2", modelId: "sonnet", isDefault: true }, // standard default
  { providerId: "p3", modelId: "qwen", isDefault: false }, // standard backup
  { providerId: "p4", modelId: "haiku", isDefault: true }, // lite default
];

describe("resolveTierChain", () => {
  it("returns the standard-tier chain with default first", () => {
    const chain = resolveTierChain(fullCfg, models, "standard");
    expect(chain.map((x) => x.modelId)).toEqual(["sonnet", "qwen"]);
  });

  it("returns a single-entry chain when tier has one model", () => {
    const chain = resolveTierChain(fullCfg, models, "pro");
    expect(chain.map((x) => x.modelId)).toEqual(["opus"]);
    expect(chain[0].isDefault).toBe(true);
  });

  it("falls back to the tier of the first isDefault when no tier requested", () => {
    const chain = resolveTierChain(fullCfg, models, undefined);
    // p1 (opus, pro) is the first default in the array
    expect(chain[0].modelId).toBe("opus");
    expect(chain).toHaveLength(1);
  });

  it("puts the default entry first even when it isn't first in modelConfig", () => {
    // Reorder so the backup is listed before the default for standard tier
    const reordered: ModelConfigEntry[] = [
      { providerId: "p3", modelId: "qwen", isDefault: false },
      { providerId: "p2", modelId: "sonnet", isDefault: true },
    ];
    const chain = resolveTierChain(reordered, models, "standard");
    expect(chain.map((x) => x.modelId)).toEqual(["sonnet", "qwen"]);
  });

  it("preserves relative order among non-default entries (stable sort)", () => {
    const many: ModelConfigEntry[] = [
      { providerId: "p2", modelId: "sonnet", isDefault: false },
      { providerId: "p3", modelId: "qwen", isDefault: false },
    ];
    const chain = resolveTierChain(many, models, "standard");
    expect(chain.map((x) => x.modelId)).toEqual(["sonnet", "qwen"]);
  });

  it("throws TIER_NOT_CONFIGURED when the requested tier has no entries", () => {
    const onlyProCfg = [fullCfg[0]];
    expect(() => resolveTierChain(onlyProCfg, models, "standard")).toThrowError(
      TierChainError,
    );
    try {
      resolveTierChain(onlyProCfg, models, "standard");
    } catch (err) {
      expect((err as TierChainError).code).toBe("TIER_NOT_CONFIGURED");
    }
  });

  it("throws NO_DEFAULT when no tier is requested and no entry is marked default", () => {
    const noDefault = fullCfg.map((e) => ({ ...e, isDefault: false }));
    expect(() => resolveTierChain(noDefault, models, undefined)).toThrowError(
      TierChainError,
    );
    try {
      resolveTierChain(noDefault, models, undefined);
    } catch (err) {
      expect((err as TierChainError).code).toBe("NO_DEFAULT");
    }
  });

  it("throws TIER_NOT_CONFIGURED when modelConfig is empty", () => {
    expect(() => resolveTierChain([], models, "standard")).toThrowError(
      /TIER_NOT_CONFIGURED/,
    );
  });

  it("drops stale modelConfig entries whose referenced model no longer exists", () => {
    const withStale: ModelConfigEntry[] = [
      { providerId: "missing", modelId: "ghost", isDefault: true },
      { providerId: "p2", modelId: "sonnet", isDefault: false },
    ];
    const chain = resolveTierChain(withStale, models, "standard");
    expect(chain.map((x) => x.modelId)).toEqual(["sonnet"]);
  });

  describe("legacy tier fallback (tier=undefined → 'standard')", () => {
    const legacyModels = [mkModel("px", "legacy")];
    const legacyCfg: ModelConfigEntry[] = [
      { providerId: "px", modelId: "legacy", isDefault: true },
    ];

    it("treats legacy models as members of the standard tier", () => {
      expect(
        resolveTierChain(legacyCfg, legacyModels, "standard").map(
          (x) => x.modelId,
        ),
      ).toEqual(["legacy"]);
    });

    it("infers standard as the default tier when only legacy models exist", () => {
      expect(
        resolveTierChain(legacyCfg, legacyModels, undefined).map(
          (x) => x.modelId,
        ),
      ).toEqual(["legacy"]);
    });

    it("excludes legacy models from non-standard tiers", () => {
      expect(() => resolveTierChain(legacyCfg, legacyModels, "pro")).toThrow(
        /TIER_NOT_CONFIGURED/,
      );
      expect(() => resolveTierChain(legacyCfg, legacyModels, "lite")).toThrow(
        /TIER_NOT_CONFIGURED/,
      );
    });

    it("mixes legacy and explicit-standard entries under standard", () => {
      const mixedModels = [...legacyModels, mkModel("p2", "sonnet", "standard")];
      const mixedCfg: ModelConfigEntry[] = [
        { providerId: "px", modelId: "legacy", isDefault: false },
        { providerId: "p2", modelId: "sonnet", isDefault: true },
      ];
      expect(
        resolveTierChain(mixedCfg, mixedModels, "standard").map(
          (x) => x.modelId,
        ),
      ).toEqual(["sonnet", "legacy"]);
    });
  });
});
