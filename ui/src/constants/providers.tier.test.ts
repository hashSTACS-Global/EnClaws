/**
 * Cross-constraint tests for tier-routing constants in providers.ts.
 * Catch mismatches between PROVIDERS_BY_TIER / MODEL_SUGGESTIONS / PROVIDER_TYPES
 * at test-time rather than at runtime when the add-model form misbehaves.
 */

import { describe, expect, it } from "vitest";
import {
  MODEL_SUGGESTIONS,
  MODEL_TIERS,
  PROVIDERS_BY_TIER,
  PROVIDER_TYPES,
  TIER_LABELS,
  type ModelTierValue,
} from "./providers.js";

const providerKeys = new Set(PROVIDER_TYPES.map((p) => p.value));

describe("MODEL_TIERS + TIER_LABELS", () => {
  it("exposes the three canonical tiers", () => {
    expect(MODEL_TIERS).toEqual(["lite", "standard", "pro"]);
  });

  it("has a non-empty label for every tier", () => {
    for (const t of MODEL_TIERS) {
      expect(TIER_LABELS[t]).toBeTruthy();
    }
  });
});

describe("PROVIDERS_BY_TIER", () => {
  it("only references providers that exist in PROVIDER_TYPES", () => {
    for (const tier of MODEL_TIERS) {
      for (const provider of PROVIDERS_BY_TIER[tier]) {
        expect(providerKeys.has(provider)).toBe(true);
      }
    }
  });

  it("covers every tier with at least one provider", () => {
    for (const tier of MODEL_TIERS) {
      expect(PROVIDERS_BY_TIER[tier].length).toBeGreaterThan(0);
    }
  });

  it("DeepSeek is intentionally absent from lite (no lite model published)", () => {
    expect(PROVIDERS_BY_TIER.lite).not.toContain("deepseek");
    expect(PROVIDERS_BY_TIER.pro).toContain("deepseek");
    expect(PROVIDERS_BY_TIER.standard).toContain("deepseek");
  });

  it("custom is available for every tier (escape hatch)", () => {
    for (const tier of MODEL_TIERS) {
      expect(PROVIDERS_BY_TIER[tier]).toContain("custom");
    }
  });
});

describe("MODEL_SUGGESTIONS", () => {
  it("has an entry for every provider referenced by PROVIDERS_BY_TIER", () => {
    const referenced = new Set<string>();
    for (const tier of MODEL_TIERS) {
      for (const p of PROVIDERS_BY_TIER[tier]) referenced.add(p);
    }
    for (const p of referenced) {
      expect(MODEL_SUGGESTIONS).toHaveProperty(p);
    }
  });

  it("every provider entry covers all three tiers (value may be empty string)", () => {
    for (const [provider, perTier] of Object.entries(MODEL_SUGGESTIONS)) {
      for (const tier of MODEL_TIERS) {
        expect(perTier).toHaveProperty(tier);
        expect(typeof perTier[tier as ModelTierValue]).toBe("string");
      }
    }
  });

  it("leaves DeepSeek lite blank (no canonical model)", () => {
    expect(MODEL_SUGGESTIONS.deepseek.lite).toBe("");
  });

  it("leaves all custom tiers blank (admin must fill)", () => {
    for (const tier of MODEL_TIERS) {
      expect(MODEL_SUGGESTIONS.custom[tier]).toBe("");
    }
  });

  it("non-custom providers have a non-empty suggestion wherever they appear in PROVIDERS_BY_TIER", () => {
    for (const tier of MODEL_TIERS) {
      for (const provider of PROVIDERS_BY_TIER[tier]) {
        if (provider === "custom") continue;
        // A provider listed for this tier should either have a concrete suggestion
        // OR be intentionally blank (like deepseek.lite — which is excluded from
        // the list anyway). So if we reach here, the suggestion must be non-empty.
        expect(
          MODEL_SUGGESTIONS[provider][tier],
          `${provider}.${tier} is listed in PROVIDERS_BY_TIER but has empty suggestion`,
        ).not.toBe("");
      }
    }
  });
});
