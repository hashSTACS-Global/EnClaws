import { describe, expect, it } from "vitest";
import {
  TIER_BUCKET_ORDER,
  flattenProviders,
  groupByTier,
  groupProvidersByTier,
  type GroupableProvider,
} from "./tenant-models-tier-view.ts";

function mkProvider(partial: Partial<GroupableProvider> & { id: string; models: GroupableProvider["models"] }): GroupableProvider {
  return {
    providerType: "anthropic",
    providerName: "Anthropic Main",
    visibility: "private",
    isActive: true,
    ...partial,
  };
}

describe("TIER_BUCKET_ORDER", () => {
  it("lists pro → standard → lite → unassigned", () => {
    expect(TIER_BUCKET_ORDER).toEqual(["pro", "standard", "lite", "unassigned"]);
  });
});

describe("flattenProviders", () => {
  it("emits one entry per (provider × model) pair", () => {
    const providers: GroupableProvider[] = [
      mkProvider({
        id: "p1",
        models: [
          { id: "opus", name: "Opus", tier: "pro" },
          { id: "sonnet", name: "Sonnet", tier: "standard" },
        ],
      }),
      mkProvider({
        id: "p2",
        providerName: "Qwen",
        providerType: "qwen",
        models: [{ id: "qwen-plus", name: "Qwen Plus", tier: "standard" }],
      }),
    ];
    const flat = flattenProviders(providers);
    expect(flat).toHaveLength(3);
    expect(flat[0]).toMatchObject({ providerId: "p1", modelId: "opus", tier: "pro" });
    expect(flat[2]).toMatchObject({ providerId: "p2", modelId: "qwen-plus", tier: "standard" });
  });

  it("carries providerName, isActive, and isShared through to each entry", () => {
    const providers: GroupableProvider[] = [
      mkProvider({
        id: "p1",
        providerName: "Shared Pool",
        visibility: "shared",
        isActive: false,
        models: [{ id: "opus", name: "Opus", tier: "pro" }],
      }),
    ];
    const [entry] = flattenProviders(providers);
    expect(entry.providerName).toBe("Shared Pool");
    expect(entry.isActive).toBe(false);
    expect(entry.isShared).toBe(true);
  });

  it("defaults reasoning to false when provider omits it", () => {
    const providers: GroupableProvider[] = [
      mkProvider({
        id: "p1",
        models: [{ id: "opus", name: "Opus", tier: "pro" }],
      }),
    ];
    expect(flattenProviders(providers)[0].reasoning).toBe(false);
  });

  it("preserves reasoning flag when present", () => {
    const providers: GroupableProvider[] = [
      mkProvider({
        id: "p1",
        models: [{ id: "o1", name: "O1", tier: "pro", reasoning: true }],
      }),
    ];
    expect(flattenProviders(providers)[0].reasoning).toBe(true);
  });

  it("keeps tier=undefined as-is (legacy models)", () => {
    const providers: GroupableProvider[] = [
      mkProvider({ id: "p1", models: [{ id: "legacy", name: "Legacy" }] }),
    ];
    expect(flattenProviders(providers)[0].tier).toBeUndefined();
  });
});

describe("groupByTier", () => {
  it("buckets entries into pro/standard/lite/unassigned", () => {
    const providers: GroupableProvider[] = [
      mkProvider({
        id: "p1",
        models: [
          { id: "opus", name: "Opus", tier: "pro" },
          { id: "sonnet", name: "Sonnet", tier: "standard" },
          { id: "haiku", name: "Haiku", tier: "lite" },
          { id: "legacy", name: "Legacy" },
        ],
      }),
    ];
    const buckets = groupProvidersByTier(providers);
    expect(buckets.pro.map((e) => e.modelId)).toEqual(["opus"]);
    expect(buckets.standard.map((e) => e.modelId)).toEqual(["sonnet"]);
    expect(buckets.lite.map((e) => e.modelId)).toEqual(["haiku"]);
    expect(buckets.unassigned.map((e) => e.modelId)).toEqual(["legacy"]);
  });

  it("handles empty providers list", () => {
    const buckets = groupProvidersByTier([]);
    for (const key of TIER_BUCKET_ORDER) {
      expect(buckets[key]).toEqual([]);
    }
  });

  it("preserves insertion order within a tier", () => {
    // Multiple providers in the same tier — entries must appear in the order
    // they were encountered across providers (pro of p1 before pro of p2).
    const providers: GroupableProvider[] = [
      mkProvider({ id: "p1", models: [{ id: "opus", name: "Opus", tier: "pro" }] }),
      mkProvider({ id: "p2", providerName: "Alt", models: [{ id: "gpt5", name: "GPT5", tier: "pro" }] }),
    ];
    const buckets = groupProvidersByTier(providers);
    expect(buckets.pro.map((e) => e.modelId)).toEqual(["opus", "gpt5"]);
  });

  it("keeps entries with the same modelId but different providers distinct", () => {
    const providers: GroupableProvider[] = [
      mkProvider({ id: "p1", models: [{ id: "claude-sonnet-4-6", name: "S1", tier: "standard" }] }),
      mkProvider({ id: "p2", providerName: "Backup Anthropic", models: [{ id: "claude-sonnet-4-6", name: "S2", tier: "standard" }] }),
    ];
    const buckets = groupProvidersByTier(providers);
    expect(buckets.standard).toHaveLength(2);
    expect(buckets.standard.map((e) => e.providerId)).toEqual(["p1", "p2"]);
  });
});

describe("groupByTier (direct, pre-flattened input)", () => {
  it("accepts an already-flat entry list", () => {
    const buckets = groupByTier([
      { providerId: "p1", providerName: "A", providerType: "anthropic", isActive: true, isShared: false, modelId: "opus", modelName: "Opus", tier: "pro", isTierDefault: false, reasoning: false },
      { providerId: "p1", providerName: "A", providerType: "anthropic", isActive: true, isShared: false, modelId: "sonnet", modelName: "Sonnet", tier: "standard", isTierDefault: false, reasoning: false },
    ]);
    expect(buckets.pro).toHaveLength(1);
    expect(buckets.standard).toHaveLength(1);
  });
});
