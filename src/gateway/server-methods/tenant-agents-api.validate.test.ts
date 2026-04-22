/**
 * Unit tests for validateModelConfigTiers: "each tier has at most one isDefault".
 *
 * Semantics shifted from v3 (agent-level single default) to v4 (tier-scoped default).
 * Legacy TenantModelDefinition entries whose `tier` is undefined are treated as
 * "standard" — mirroring the runtime fallback in src/gateway/tier-chain.ts.
 */

import { describe, expect, it } from "vitest";
import { validateModelConfigTiers } from "./tenant-agents-api.js";
import type { ModelConfigEntry, ModelTier, TenantModel } from "../../db/types.js";

function mkModel(id: string, modelId: string, tier?: ModelTier): TenantModel {
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

describe("validateModelConfigTiers", () => {
  it("allows one isDefault=true per tier across different tiers", () => {
    const models = [
      mkModel("p1", "opus", "pro"),
      mkModel("p2", "sonnet", "standard"),
      mkModel("p3", "haiku", "lite"),
    ];
    const cfg: ModelConfigEntry[] = [
      { providerId: "p1", modelId: "opus", isDefault: true },
      { providerId: "p2", modelId: "sonnet", isDefault: true },
      { providerId: "p3", modelId: "haiku", isDefault: true },
    ];
    expect(() => validateModelConfigTiers(cfg, models)).not.toThrow();
  });

  it("allows a tier with a default plus non-default backups", () => {
    const models = [
      mkModel("p1", "sonnet", "standard"),
      mkModel("p2", "qwen", "standard"),
    ];
    const cfg: ModelConfigEntry[] = [
      { providerId: "p1", modelId: "sonnet", isDefault: true },
      { providerId: "p2", modelId: "qwen", isDefault: false },
    ];
    expect(() => validateModelConfigTiers(cfg, models)).not.toThrow();
  });

  it("rejects two isDefault=true in the same tier", () => {
    const models = [
      mkModel("p1", "opus", "pro"),
      mkModel("p2", "gpt5", "pro"),
    ];
    const cfg: ModelConfigEntry[] = [
      { providerId: "p1", modelId: "opus", isDefault: true },
      { providerId: "p2", modelId: "gpt5", isDefault: true },
    ];
    expect(() => validateModelConfigTiers(cfg, models))
      .toThrow(/tier 'pro' has more than one default/);
  });

  it("allows empty modelConfig (caller enforces non-empty separately)", () => {
    expect(() => validateModelConfigTiers([], [])).not.toThrow();
  });

  it("allows modelConfig with zero defaults (tier default may be absent)", () => {
    const models = [
      mkModel("p1", "sonnet", "standard"),
      mkModel("p2", "qwen", "standard"),
    ];
    const cfg: ModelConfigEntry[] = [
      { providerId: "p1", modelId: "sonnet", isDefault: false },
      { providerId: "p2", modelId: "qwen", isDefault: false },
    ];
    expect(() => validateModelConfigTiers(cfg, models)).not.toThrow();
  });

  it("treats legacy models (tier=undefined) as 'standard' for default counting", () => {
    const legacyModels = [mkModel("p1", "legacy-a"), mkModel("p2", "legacy-b")];
    const cfg: ModelConfigEntry[] = [
      { providerId: "p1", modelId: "legacy-a", isDefault: true },
      { providerId: "p2", modelId: "legacy-b", isDefault: true },
    ];
    expect(() => validateModelConfigTiers(cfg, legacyModels))
      .toThrow(/tier 'standard' has more than one default/);
  });

  it("accepts a single legacy default (treated as standard default)", () => {
    const legacyModels = [mkModel("p1", "legacy-a")];
    const cfg: ModelConfigEntry[] = [
      { providerId: "p1", modelId: "legacy-a", isDefault: true },
    ];
    expect(() => validateModelConfigTiers(cfg, legacyModels)).not.toThrow();
  });

  it("skips entries whose referenced model is not in tenantModels (stale data)", () => {
    // This covers the case where DB denormalization leaves an agent entry
    // referencing a model that was since deleted. Should not throw on the
    // orphan entry itself.
    const cfg: ModelConfigEntry[] = [
      { providerId: "missing-provider", modelId: "missing-model", isDefault: true },
    ];
    expect(() => validateModelConfigTiers(cfg, [])).not.toThrow();
  });
});
