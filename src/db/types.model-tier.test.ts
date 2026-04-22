import { describe, expect, it } from "vitest";
import { MODEL_TIER_VALUES, isModelTier, type ModelTier, type TenantModelDefinition } from "./types.js";

describe("MODEL_TIER_VALUES + ModelTier", () => {
  it("exposes the three canonical tiers in ordered form", () => {
    expect(MODEL_TIER_VALUES).toEqual(["lite", "standard", "pro"]);
  });

  it("is treated as readonly at the type level", () => {
    // type-level sanity: const assertion keeps the tuple literal narrow
    const first: "lite" = MODEL_TIER_VALUES[0];
    expect(first).toBe("lite");
  });
});

describe("isModelTier", () => {
  it.each(["lite", "standard", "pro"])("accepts canonical tier %s", (v) => {
    expect(isModelTier(v)).toBe(true);
  });

  it.each([
    ["LITE (wrong case)", "LITE"],
    ["Standard (mixed case)", "Standard"],
    ["empty string", ""],
    ["unrelated value", "ultra"],
  ])("rejects %s", (_label, v) => {
    expect(isModelTier(v)).toBe(false);
  });

  it("rejects non-string inputs", () => {
    expect(isModelTier(undefined)).toBe(false);
    expect(isModelTier(null)).toBe(false);
    expect(isModelTier(123)).toBe(false);
    expect(isModelTier({})).toBe(false);
  });
});

describe("TenantModelDefinition.tier", () => {
  it("is optional (legacy models have undefined tier)", () => {
    const legacy: TenantModelDefinition = { id: "m1", name: "legacy" };
    expect(legacy.tier).toBeUndefined();
  });

  it("accepts any ModelTier value", () => {
    const tiers: ModelTier[] = ["lite", "standard", "pro"];
    for (const t of tiers) {
      const def: TenantModelDefinition = { id: `m-${t}`, name: `model-${t}`, tier: t };
      expect(def.tier).toBe(t);
    }
  });
});
