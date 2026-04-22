/**
 * Unit tests for the pure helpers behind the tier-cascading Add Model modal.
 *
 *  - suggestDraftFields(tier, provider):
 *      Returns the derived baseUrl / protocol / modelId / providerName
 *      suggestion when the admin picks a (tier, provider) pair.
 *  - validateAddDraft(draft):
 *      Returns a list of i18n keys for each rule violated. Empty list = OK.
 *  - resolveAddTarget(draft, existingProviders):
 *      Decides whether to append the new model to an existing Provider
 *      container (matched by providerName + baseUrl) or create a fresh one.
 *  - buildSetTierDefaultUpdates(providerId, modelId, tier, agents, findTier):
 *      Produces the minimal set of tenant.agents.update payloads so that
 *      every agent using `tier` has the designated (providerId, modelId)
 *      marked isDefault=true and all other same-tier entries isDefault=false.
 */

import { describe, expect, it } from "vitest";
import {
  suggestDraftFields,
  validateAddDraft,
  resolveAddTarget,
  buildSetTierDefaultUpdates,
  type AddModelDraft,
} from "./tenant-models-add-form.ts";

// ─── suggestDraftFields ───────────────────────────────────────────────────

describe("suggestDraftFields", () => {
  it("fills anthropic pro tier with opus suggestion and anthropic defaults", () => {
    const s = suggestDraftFields("pro", "anthropic");
    expect(s.baseUrl).toBe("https://api.anthropic.com");
    expect(s.protocol).toBe("anthropic-messages");
    expect(s.modelId).toBe("claude-opus-4-7");
    expect(s.providerNameSuggestion).toContain("Anthropic");
  });

  it("fills qwen standard tier with qwen-plus", () => {
    const s = suggestDraftFields("standard", "qwen");
    expect(s.modelId).toBe("qwen-plus");
    expect(s.protocol).toBe("openai-completions");
  });

  it("leaves modelId blank for deepseek lite (intentional gap)", () => {
    const s = suggestDraftFields("lite", "deepseek");
    // deepseek still has a baseUrl, but no published lite model
    expect(s.baseUrl).toBe("https://api.deepseek.com/v1");
    expect(s.modelId).toBe("");
  });

  it("returns empty baseUrl/modelId for custom provider", () => {
    const s = suggestDraftFields("standard", "custom");
    expect(s.baseUrl).toBe("");
    expect(s.modelId).toBe("");
    expect(s.protocol).toBe("openai-completions");
  });

  it("returns blank suggestion when tier is empty", () => {
    const s = suggestDraftFields("", "anthropic");
    expect(s.baseUrl).toBe("https://api.anthropic.com");
    // tier missing → no modelId suggestion, but provider defaults still useful
    expect(s.modelId).toBe("");
  });

  it("returns blank suggestion when provider is empty", () => {
    const s = suggestDraftFields("pro", "");
    expect(s.baseUrl).toBe("");
    expect(s.modelId).toBe("");
    expect(s.protocol).toBe("");
    expect(s.providerNameSuggestion).toBe("");
  });
});

// ─── validateAddDraft ─────────────────────────────────────────────────────

function makeDraft(overrides: Partial<AddModelDraft> = {}): AddModelDraft {
  return {
    tier: "standard",
    provider: "anthropic",
    providerName: "My Anthropic",
    baseUrl: "https://api.anthropic.com",
    protocol: "anthropic-messages",
    authMode: "api-key",
    apiKey: "sk-xxx",
    modelId: "claude-sonnet-4-6",
    modelName: "Sonnet",
    ...overrides,
  };
}

describe("validateAddDraft", () => {
  it("returns empty list for a fully-populated draft", () => {
    expect(validateAddDraft(makeDraft())).toEqual([]);
  });

  it("flags missing tier", () => {
    expect(validateAddDraft(makeDraft({ tier: "" }))).toContain("models.addForm.errorTierRequired");
  });

  it("flags missing provider", () => {
    expect(validateAddDraft(makeDraft({ provider: "" }))).toContain(
      "models.addForm.errorProviderRequired",
    );
  });

  it("flags missing providerName/baseUrl/modelId", () => {
    const errors = validateAddDraft(
      makeDraft({ providerName: "", baseUrl: "", modelId: "" }),
    );
    expect(errors).toContain("models.addForm.errorProviderNameRequired");
    expect(errors).toContain("models.addForm.errorBaseUrlRequired");
    expect(errors).toContain("models.addForm.errorModelIdRequired");
  });

  it("requires apiKey when authMode is api-key", () => {
    expect(validateAddDraft(makeDraft({ authMode: "api-key", apiKey: "" }))).toContain(
      "models.addForm.errorApiKeyRequired",
    );
  });

  it("requires apiKey when authMode is token", () => {
    expect(validateAddDraft(makeDraft({ authMode: "token", apiKey: "" }))).toContain(
      "models.addForm.errorApiKeyRequired",
    );
  });

  it("does not require apiKey when authMode is none", () => {
    expect(validateAddDraft(makeDraft({ authMode: "none", apiKey: "" }))).toEqual([]);
  });

  it("does not require apiKey when authMode is oauth", () => {
    expect(validateAddDraft(makeDraft({ authMode: "oauth", apiKey: "" }))).toEqual([]);
  });
});

// ─── resolveAddTarget ─────────────────────────────────────────────────────

type ExistingProvider = Parameters<typeof resolveAddTarget>[1][number];

function makeProvider(
  overrides: Partial<ExistingProvider> = {},
): ExistingProvider {
  return {
    id: "m-1",
    providerType: "anthropic",
    providerName: "My Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiProtocol: "anthropic-messages",
    authMode: "api-key",
    models: [],
    ...overrides,
  };
}

describe("resolveAddTarget", () => {
  it("creates a new provider when no match exists", () => {
    const draft = makeDraft();
    const target = resolveAddTarget(draft, []);
    expect(target.mode).toBe("create");
    if (target.mode === "create") {
      expect(target.payload.providerType).toBe("anthropic");
      expect(target.payload.providerName).toBe("My Anthropic");
      expect(target.payload.apiKey).toBe("sk-xxx");
      expect(target.payload.models).toEqual([
        { id: "claude-sonnet-4-6", name: "Sonnet", tier: "standard" },
      ]);
    }
  });

  it("appends to an existing provider matched by providerName+baseUrl", () => {
    const existing = makeProvider({
      models: [{ id: "claude-haiku-4-5", name: "Haiku", tier: "lite" }],
    });
    const draft = makeDraft({ modelId: "claude-sonnet-4-6", modelName: "Sonnet" });
    const target = resolveAddTarget(draft, [existing]);
    expect(target.mode).toBe("append");
    if (target.mode === "append") {
      expect(target.providerId).toBe("m-1");
      // existing model kept, new one appended
      expect(target.nextModels.map((m) => m.id)).toEqual([
        "claude-haiku-4-5",
        "claude-sonnet-4-6",
      ]);
      expect(target.nextModels[1].tier).toBe("standard");
    }
  });

  it("de-duplicates when the same modelId already exists on the matched provider", () => {
    const existing = makeProvider({
      models: [{ id: "claude-sonnet-4-6", name: "Old Sonnet", tier: "standard" }],
    });
    const draft = makeDraft({ modelId: "claude-sonnet-4-6", modelName: "Sonnet" });
    const target = resolveAddTarget(draft, [existing]);
    expect(target.mode).toBe("append");
    if (target.mode === "append") {
      // The existing duplicate is replaced (filter-then-push), so length stays 1
      expect(target.nextModels).toHaveLength(1);
      expect(target.nextModels[0].name).toBe("Sonnet");
    }
  });

  it("treats null baseUrl as equivalent to empty string when matching", () => {
    const existing = makeProvider({
      baseUrl: null,
      providerType: "custom",
      providerName: "Local",
    });
    const draft = makeDraft({
      providerName: "Local",
      baseUrl: "",
      provider: "custom",
    });
    const target = resolveAddTarget(draft, [existing]);
    expect(target.mode).toBe("append");
  });

  it("does not match when providerName differs", () => {
    const existing = makeProvider({ providerName: "Anthropic A" });
    const draft = makeDraft({ providerName: "Anthropic B" });
    const target = resolveAddTarget(draft, [existing]);
    expect(target.mode).toBe("create");
  });

  it("does not match when baseUrl differs", () => {
    const existing = makeProvider({ baseUrl: "https://api.anthropic.com" });
    const draft = makeDraft({ baseUrl: "https://proxy.example/v1" });
    const target = resolveAddTarget(draft, [existing]);
    expect(target.mode).toBe("create");
  });
});

// ─── buildSetTierDefaultUpdates ───────────────────────────────────────────

type AgentLike = Parameters<typeof buildSetTierDefaultUpdates>[3][number];

function mkAgent(
  id: string,
  modelConfig: Array<{ providerId: string; modelId: string; isDefault: boolean }>,
): AgentLike {
  return { id, modelConfig };
}

describe("buildSetTierDefaultUpdates", () => {
  const findTier = (tiers: Record<string, string>) => (providerId: string, modelId: string) =>
    (tiers[`${providerId}:${modelId}`] ?? undefined) as
      | "pro"
      | "standard"
      | "lite"
      | undefined;

  it("marks the target entry isDefault=true and clears other same-tier defaults", () => {
    const agent = mkAgent("a1", [
      { providerId: "p-old", modelId: "opus", isDefault: true }, // pro
      { providerId: "p-new", modelId: "gpt5", isDefault: false }, // pro
      { providerId: "p-std", modelId: "sonnet", isDefault: true }, // standard — untouched
    ]);
    const tiers = {
      "p-old:opus": "pro",
      "p-new:gpt5": "pro",
      "p-std:sonnet": "standard",
    };
    const updates = buildSetTierDefaultUpdates(
      "p-new",
      "gpt5",
      "pro",
      [agent],
      findTier(tiers),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].agentId).toBe("a1");
    expect(updates[0].modelConfig).toEqual([
      { providerId: "p-old", modelId: "opus", isDefault: false },
      { providerId: "p-new", modelId: "gpt5", isDefault: true },
      { providerId: "p-std", modelId: "sonnet", isDefault: true },
    ]);
  });

  it("skips agents that don't use the target tier at all", () => {
    const agent = mkAgent("a1", [
      { providerId: "p-std", modelId: "sonnet", isDefault: true },
    ]);
    const tiers = { "p-std:sonnet": "standard" };
    const updates = buildSetTierDefaultUpdates(
      "p-new",
      "gpt5",
      "pro",
      [agent],
      findTier(tiers),
    );
    expect(updates).toEqual([]);
  });

  it("treats legacy (tier=undefined) entries as standard when tier target is standard", () => {
    const agent = mkAgent("a1", [
      { providerId: "p-legacy", modelId: "old", isDefault: true },
      { providerId: "p-std", modelId: "sonnet", isDefault: false },
    ]);
    // p-legacy has no tier recorded → treated as standard
    const tiers = { "p-std:sonnet": "standard" };
    const updates = buildSetTierDefaultUpdates(
      "p-std",
      "sonnet",
      "standard",
      [agent],
      findTier(tiers),
    );
    expect(updates).toHaveLength(1);
    const [{ modelConfig }] = updates;
    // legacy got downgraded to isDefault=false
    expect(modelConfig.find((e) => e.providerId === "p-legacy")?.isDefault).toBe(false);
    expect(modelConfig.find((e) => e.providerId === "p-std")?.isDefault).toBe(true);
  });

  it("emits no update when the target entry is already the sole default", () => {
    const agent = mkAgent("a1", [
      { providerId: "p-new", modelId: "gpt5", isDefault: true },
      { providerId: "p-bkp", modelId: "gpt5-mini", isDefault: false },
    ]);
    const tiers = {
      "p-new:gpt5": "pro",
      "p-bkp:gpt5-mini": "pro",
    };
    const updates = buildSetTierDefaultUpdates(
      "p-new",
      "gpt5",
      "pro",
      [agent],
      findTier(tiers),
    );
    // Already in the desired shape — no-op
    expect(updates).toEqual([]);
  });

  it("handles multiple agents, emitting only the ones that actually changed", () => {
    const a1 = mkAgent("a1", [
      { providerId: "p-old", modelId: "opus", isDefault: true },
      { providerId: "p-new", modelId: "gpt5", isDefault: false },
    ]);
    const a2 = mkAgent("a2", [
      { providerId: "p-new", modelId: "gpt5", isDefault: true }, // already correct
    ]);
    const a3 = mkAgent("a3", [
      { providerId: "p-std", modelId: "sonnet", isDefault: true }, // different tier, ignore
    ]);
    const tiers = {
      "p-old:opus": "pro",
      "p-new:gpt5": "pro",
      "p-std:sonnet": "standard",
    };
    const updates = buildSetTierDefaultUpdates(
      "p-new",
      "gpt5",
      "pro",
      [a1, a2, a3],
      findTier(tiers),
    );
    expect(updates.map((u) => u.agentId)).toEqual(["a1"]);
  });
});
