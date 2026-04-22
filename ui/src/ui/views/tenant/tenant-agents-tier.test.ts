/**
 * Unit tests for the Agent-side tier helpers:
 *
 *   tenantTierGroups      - flatten+group tenant model catalog into per-tier buckets
 *   deriveEnabledTiers    - infer enabled tiers from an existing agent's modelConfig
 *   pickTierDefault       - find the (providerId, modelId) currently marked default in a tier
 *   projectModelConfig    - project a set of enabled tiers → new modelConfig array
 *                           (preserves prior per-tier default when possible;
 *                            legacy models treated as 'standard' to match
 *                            src/gateway/tier-chain.ts + validator)
 */

import { describe, expect, it } from "vitest";
import {
  tenantTierGroups,
  deriveEnabledTiers,
  pickTierDefault,
  projectModelConfig,
  type TenantModelLite,
  type ModelConfigEntryLite,
} from "./tenant-agents-tier.ts";

function mkProvider(
  id: string,
  models: Array<{ id: string; name?: string; tier?: "pro" | "standard" | "lite" }>,
  overrides: Partial<TenantModelLite> = {},
): TenantModelLite {
  return {
    id,
    providerType: "anthropic",
    providerName: `Provider ${id}`,
    isActive: true,
    visibility: "private",
    models: models.map((m) => ({ id: m.id, name: m.name ?? m.id, ...(m.tier ? { tier: m.tier } : {}) })),
    ...overrides,
  };
}

// ─── tenantTierGroups ─────────────────────────────────────────────────────

describe("tenantTierGroups", () => {
  it("produces per-tier buckets in pro→standard→lite order", () => {
    const providers = [
      mkProvider("p1", [{ id: "opus", tier: "pro" }]),
      mkProvider("p2", [{ id: "sonnet", tier: "standard" }, { id: "qwen", tier: "standard" }]),
      mkProvider("p3", [{ id: "haiku", tier: "lite" }]),
    ];
    const groups = tenantTierGroups(providers);
    expect(groups.map((g) => g.tier)).toEqual(["pro", "standard", "lite"]);
    expect(groups[0].models.map((m) => m.modelId)).toEqual(["opus"]);
    expect(groups[1].models.map((m) => m.modelId)).toEqual(["sonnet", "qwen"]);
    expect(groups[2].models.map((m) => m.modelId)).toEqual(["haiku"]);
  });

  it("treats legacy (tier=undefined) models as 'standard' with legacy=true", () => {
    const providers = [
      mkProvider("p1", [{ id: "sonnet", tier: "standard" }]),
      mkProvider("p2", [{ id: "legacy-a" }, { id: "legacy-b" }]),
    ];
    const groups = tenantTierGroups(providers);
    const standard = groups.find((g) => g.tier === "standard");
    expect(standard?.models.map((m) => m.modelId)).toEqual(["sonnet", "legacy-a", "legacy-b"]);
    expect(standard?.models.find((m) => m.modelId === "legacy-a")?.legacy).toBe(true);
    expect(standard?.models.find((m) => m.modelId === "sonnet")?.legacy).toBe(false);
  });

  it("drops inactive providers", () => {
    const providers = [
      mkProvider("p1", [{ id: "opus", tier: "pro" }], { isActive: false }),
      mkProvider("p2", [{ id: "sonnet", tier: "standard" }]),
    ];
    const groups = tenantTierGroups(providers);
    expect(groups.some((g) => g.tier === "pro")).toBe(false);
    expect(groups.find((g) => g.tier === "standard")?.models).toHaveLength(1);
  });

  it("includes shared providers alongside private ones", () => {
    const providers = [
      mkProvider("p1", [{ id: "sonnet", tier: "standard" }], { visibility: "shared" }),
      mkProvider("p2", [{ id: "qwen", tier: "standard" }]),
    ];
    const groups = tenantTierGroups(providers);
    const standard = groups.find((g) => g.tier === "standard");
    expect(standard?.models.map((m) => m.modelId)).toEqual(["sonnet", "qwen"]);
  });

  it("omits empty tiers from the output (no pro/lite bucket when none configured)", () => {
    const providers = [mkProvider("p1", [{ id: "sonnet", tier: "standard" }])];
    const groups = tenantTierGroups(providers);
    expect(groups.map((g) => g.tier)).toEqual(["standard"]);
  });
});

// ─── deriveEnabledTiers ───────────────────────────────────────────────────

describe("deriveEnabledTiers", () => {
  const providers = [
    mkProvider("p1", [{ id: "opus", tier: "pro" }]),
    mkProvider("p2", [{ id: "sonnet", tier: "standard" }]),
    mkProvider("p3", [{ id: "haiku", tier: "lite" }]),
  ];

  it("returns only the tiers referenced in modelConfig", () => {
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "p1", modelId: "opus", isDefault: true },
      { providerId: "p3", modelId: "haiku", isDefault: true },
    ];
    const tiers = deriveEnabledTiers(cfg, providers);
    expect(new Set(tiers)).toEqual(new Set(["pro", "lite"]));
  });

  it("returns empty array for empty modelConfig", () => {
    expect(deriveEnabledTiers([], providers)).toEqual([]);
    expect(deriveEnabledTiers(undefined, providers)).toEqual([]);
  });

  it("treats legacy entries as enabling the 'standard' tier", () => {
    const legacyProviders = [mkProvider("p-legacy", [{ id: "old" }])];
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "p-legacy", modelId: "old", isDefault: true },
    ];
    expect(deriveEnabledTiers(cfg, legacyProviders)).toEqual(["standard"]);
  });

  it("ignores entries whose referenced model is no longer in the catalog", () => {
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "gone", modelId: "missing", isDefault: true },
      { providerId: "p2", modelId: "sonnet", isDefault: false },
    ];
    expect(deriveEnabledTiers(cfg, providers)).toEqual(["standard"]);
  });

  it("returns each tier at most once", () => {
    const dualStd = [
      mkProvider("p1", [{ id: "sonnet", tier: "standard" }, { id: "qwen", tier: "standard" }]),
    ];
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "p1", modelId: "sonnet", isDefault: true },
      { providerId: "p1", modelId: "qwen", isDefault: false },
    ];
    expect(deriveEnabledTiers(cfg, dualStd)).toEqual(["standard"]);
  });
});

// ─── pickTierDefault ──────────────────────────────────────────────────────

describe("pickTierDefault", () => {
  const providers = [
    mkProvider("p1", [{ id: "sonnet", tier: "standard" }, { id: "qwen", tier: "standard" }]),
    mkProvider("p2", [{ id: "opus", tier: "pro" }]),
  ];

  it("returns the isDefault=true entry in the requested tier", () => {
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "p1", modelId: "sonnet", isDefault: true },
      { providerId: "p1", modelId: "qwen", isDefault: false },
    ];
    expect(pickTierDefault("standard", cfg, providers)).toEqual({
      providerId: "p1",
      modelId: "sonnet",
    });
  });

  it("returns undefined when the tier has no default entry in modelConfig", () => {
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "p1", modelId: "sonnet", isDefault: false },
    ];
    expect(pickTierDefault("standard", cfg, providers)).toBeUndefined();
  });

  it("returns undefined when modelConfig is empty / undefined", () => {
    expect(pickTierDefault("pro", [], providers)).toBeUndefined();
    expect(pickTierDefault("pro", undefined, providers)).toBeUndefined();
  });

  it("ignores defaults in a different tier", () => {
    const cfg: ModelConfigEntryLite[] = [
      { providerId: "p2", modelId: "opus", isDefault: true },
    ];
    expect(pickTierDefault("standard", cfg, providers)).toBeUndefined();
  });
});

// ─── projectModelConfig ───────────────────────────────────────────────────

describe("projectModelConfig", () => {
  const providers = [
    mkProvider("p1", [{ id: "sonnet", tier: "standard" }, { id: "qwen", tier: "standard" }]),
    mkProvider("p2", [{ id: "opus", tier: "pro" }]),
    mkProvider("p3", [{ id: "haiku", tier: "lite" }]),
  ];

  it("emits one entry per (provider, model) in every enabled tier; default = first model in tier", () => {
    const out = projectModelConfig(["standard"], providers, []);
    expect(out).toEqual([
      { providerId: "p1", modelId: "sonnet", isDefault: true },
      { providerId: "p1", modelId: "qwen", isDefault: false },
    ]);
  });

  it("preserves a prior per-tier default when that model is still in the tier", () => {
    const prior: ModelConfigEntryLite[] = [
      { providerId: "p1", modelId: "qwen", isDefault: true },
    ];
    const out = projectModelConfig(["standard"], providers, prior);
    expect(out.find((e) => e.modelId === "qwen")?.isDefault).toBe(true);
    expect(out.find((e) => e.modelId === "sonnet")?.isDefault).toBe(false);
  });

  it("falls back to first-in-tier when the prior default is no longer listed", () => {
    const prior: ModelConfigEntryLite[] = [
      { providerId: "p1", modelId: "gone", isDefault: true },
    ];
    const out = projectModelConfig(["standard"], providers, prior);
    // 'gone' not in catalog → falls back to first listed ('sonnet')
    expect(out.find((e) => e.modelId === "sonnet")?.isDefault).toBe(true);
  });

  it("drops tiers that are absent from the catalog", () => {
    const noProProviders = [mkProvider("p1", [{ id: "sonnet", tier: "standard" }])];
    const out = projectModelConfig(["pro", "standard"], noProProviders, []);
    expect(out.map((e) => e.modelId)).toEqual(["sonnet"]);
  });

  it("returns [] when no tier is enabled", () => {
    expect(projectModelConfig([], providers, [])).toEqual([]);
  });

  it("handles multiple tiers (each with its own default)", () => {
    const out = projectModelConfig(["pro", "standard", "lite"], providers, []);
    const defaults = out.filter((e) => e.isDefault).map((e) => e.modelId);
    expect(defaults).toEqual(["opus", "sonnet", "haiku"]);
    expect(out).toHaveLength(4); // opus + sonnet + qwen + haiku
  });

  it("treats legacy models as standard and includes them in the standard projection", () => {
    const mixed = [
      mkProvider("p1", [{ id: "sonnet", tier: "standard" }]),
      mkProvider("p2", [{ id: "legacy" }]),
    ];
    const out = projectModelConfig(["standard"], mixed, []);
    expect(out.map((e) => e.modelId)).toEqual(["sonnet", "legacy"]);
    expect(out.find((e) => e.modelId === "sonnet")?.isDefault).toBe(true);
  });
});
