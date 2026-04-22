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
import { resolveTierChain, TierChainError, isRetriableFailover } from "./tier-chain.js";
import type { ModelConfigEntry, ModelTier, TenantModel } from "../db/types.js";
import { FailoverError } from "../agents/failover-error.js";

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

  it("falls back to the tier of the first isDefault when no tier requested (multi-tier chain)", () => {
    const chain = resolveTierChain(fullCfg, models, undefined);
    // default tier derived from first isDefault entry (p1 opus = pro);
    // backup tiers appended in modelConfig appearance order (standard, lite)
    expect(chain[0].modelId).toBe("opus");
    expect(chain.map((e) => e.modelId)).toEqual(["opus", "sonnet", "qwen", "haiku"]);
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

  describe("cross-tier fallback (requestedTier=undefined, multi-tier agent)", () => {
    it("puts the agent's default tier first, backup tiers after", () => {
      // Agent has standard (default) + lite (backup)
      const cfg: ModelConfigEntry[] = [
        { providerId: "p4", modelId: "haiku", isDefault: false }, // lite
        { providerId: "p2", modelId: "sonnet", isDefault: true }, // standard default
      ];
      // No requestedTier, agentDefaultTier=standard → standard chain first, lite after
      const chain = resolveTierChain(cfg, models, undefined, "standard");
      expect(chain.map((e) => e.modelId)).toEqual(["sonnet", "haiku"]);
    });

    it("respects the agent's default tier override even when it's not the first isDefault", () => {
      // Agent has pro (legacy default via isDefault) + standard (declared default)
      const cfg: ModelConfigEntry[] = [
        { providerId: "p1", modelId: "opus", isDefault: true }, // pro
        { providerId: "p2", modelId: "sonnet", isDefault: false }, // standard
      ];
      // agentDefaultTier=standard (explicit override)
      const chain = resolveTierChain(cfg, models, undefined, "standard");
      expect(chain.map((e) => e.modelId)).toEqual(["sonnet", "opus"]);
    });

    it("orders multiple backup tiers by modelConfig appearance order", () => {
      // Agent enables pro + standard + lite; default = standard; backup order = pro then lite
      const cfg: ModelConfigEntry[] = [
        { providerId: "p1", modelId: "opus", isDefault: false }, // pro
        { providerId: "p2", modelId: "sonnet", isDefault: true }, // standard default
        { providerId: "p4", modelId: "haiku", isDefault: false }, // lite
      ];
      const chain = resolveTierChain(cfg, models, undefined, "standard");
      expect(chain.map((e) => e.modelId)).toEqual(["sonnet", "opus", "haiku"]);
    });

    it("within each tier, the default model is still tried first", () => {
      // standard tier has 2 models: qwen first, sonnet default
      const cfg: ModelConfigEntry[] = [
        { providerId: "p3", modelId: "qwen", isDefault: false },
        { providerId: "p2", modelId: "sonnet", isDefault: true }, // standard default
        { providerId: "p4", modelId: "haiku", isDefault: false }, // lite backup
      ];
      const chain = resolveTierChain(cfg, models, undefined, "standard");
      // standard default first, then standard backup, then lite
      expect(chain.map((e) => e.modelId)).toEqual(["sonnet", "qwen", "haiku"]);
    });

    it("falls back to isDefault-derived tier when agentDefaultTier is not supplied (backward compat)", () => {
      const cfg: ModelConfigEntry[] = [
        { providerId: "p1", modelId: "opus", isDefault: true }, // pro default
        { providerId: "p2", modelId: "sonnet", isDefault: false }, // standard backup
      ];
      // Old caller (no agentDefaultTier) — should still work, default tier derived
      // from first isDefault entry. Multi-tier chain retains the rest as backup.
      const chain = resolveTierChain(cfg, models, undefined);
      expect(chain.map((e) => e.modelId)).toEqual(["opus", "sonnet"]);
    });

    it("throws NO_DEFAULT when agentDefaultTier points at a tier with no configured entries", () => {
      const cfg: ModelConfigEntry[] = [
        { providerId: "p2", modelId: "sonnet", isDefault: true }, // standard only
      ];
      expect(() => resolveTierChain(cfg, models, undefined, "pro")).toThrow(
        /NO_DEFAULT/,
      );
    });

    it("when requestedTier is explicit, agentDefaultTier is ignored (strict scene routing)", () => {
      // Agent default=standard; caller explicitly asks for lite → only lite chain
      const cfg: ModelConfigEntry[] = [
        { providerId: "p2", modelId: "sonnet", isDefault: true }, // standard default
        { providerId: "p4", modelId: "haiku", isDefault: false }, // lite backup
      ];
      const chain = resolveTierChain(cfg, models, "lite", "standard");
      expect(chain.map((e) => e.modelId)).toEqual(["haiku"]);
    });
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

describe("isRetriableFailover", () => {
  it("returns retriable=true for 500/502/503/504", () => {
    for (const status of [500, 502, 503, 504]) {
      const err = Object.assign(new Error("bad gateway"), { status });
      expect(isRetriableFailover(err).retriable).toBe(true);
    }
  });

  it("returns retriable=true for 429 rate_limit", () => {
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    const result = isRetriableFailover(err);
    expect(result.retriable).toBe(true);
    expect(result.status).toBe(429);
  });

  it("returns retriable=true for timeout errors", () => {
    const err = new FailoverError("timed out", { reason: "timeout" });
    expect(isRetriableFailover(err).retriable).toBe(true);
  });

  it("returns retriable=false for 400 format errors", () => {
    const err = Object.assign(new Error("bad request"), { status: 400 });
    const result = isRetriableFailover(err);
    expect(result.retriable).toBe(false);
    expect(result.status).toBe(400);
  });

  it("returns retriable=false for auth (401/403)", () => {
    for (const status of [401, 403]) {
      const err = Object.assign(new Error("unauthorized"), { status });
      expect(isRetriableFailover(err).retriable).toBe(false);
    }
  });

  it("returns retriable=false for billing (402)", () => {
    const err = new FailoverError("billing", { reason: "billing", status: 402 });
    const result = isRetriableFailover(err);
    expect(result.retriable).toBe(false);
    expect(result.status).toBe(402);
  });

  it("returns retriable=false for format errors (malformed request)", () => {
    const err = new FailoverError("invalid schema", { reason: "format", status: 400 });
    expect(isRetriableFailover(err).retriable).toBe(false);
  });

  it("returns retriable=false with status=undefined for unclassifiable errors", () => {
    const result = isRetriableFailover(new Error("random"));
    expect(result.retriable).toBe(false);
    expect(result.status).toBeUndefined();
  });
});
