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
  buildEditPayload,
  countAgentsUsingModel,
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

  it("allows empty apiKey in edit mode (server keeps existing key)", () => {
    expect(
      validateAddDraft(makeDraft({ authMode: "api-key", apiKey: "" }), { mode: "edit" }),
    ).not.toContain("models.addForm.errorApiKeyRequired");
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

// ─── buildEditPayload ─────────────────────────────────────────────────────

function mkAgent(
  id: string,
  modelConfig: Array<{ providerId: string; modelId: string }>,
): { id: string; modelConfig: Array<{ providerId: string; modelId: string }> } {
  return { id, modelConfig };
}

function mkExistingProvider(
  overrides: Parameters<typeof resolveAddTarget>[1][number] extends infer T
    ? Partial<T>
    : never = {},
): Parameters<typeof resolveAddTarget>[1][number] {
  return {
    id: "m-1",
    providerType: "anthropic",
    providerName: "My Anthropic",
    baseUrl: "https://api.anthropic.com",
    apiProtocol: "anthropic-messages",
    authMode: "api-key",
    models: [
      { id: "claude-opus-4-7", name: "Opus", tier: "pro" },
      { id: "claude-sonnet-4-6", name: "Sonnet", tier: "standard" },
    ],
    ...overrides,
  };
}

describe("buildEditPayload", () => {
  it("replaces the matching def in-place and keeps siblings intact", () => {
    const provider = mkExistingProvider();
    const draft = makeDraft({
      tier: "standard",
      modelId: "claude-sonnet-4-6",
      modelName: "Sonnet (renamed)",
    });
    const payload = buildEditPayload(
      draft,
      { providerId: "m-1", modelId: "claude-sonnet-4-6" },
      provider,
    );
    expect(payload.id).toBe("m-1");
    expect(payload.models).toHaveLength(2);
    const opus = payload.models.find((m) => m.id === "claude-opus-4-7");
    const sonnet = payload.models.find((m) => m.id === "claude-sonnet-4-6");
    expect(opus).toMatchObject({ id: "claude-opus-4-7", tier: "pro" });
    expect(sonnet).toMatchObject({
      id: "claude-sonnet-4-6",
      name: "Sonnet (renamed)",
      tier: "standard",
    });
  });

  it("handles modelId rename (old id removed, new id inserted in same slot)", () => {
    const provider = mkExistingProvider();
    const draft = makeDraft({
      tier: "standard",
      modelId: "claude-sonnet-4-7-beta",
      modelName: "Sonnet beta",
    });
    const payload = buildEditPayload(
      draft,
      { providerId: "m-1", modelId: "claude-sonnet-4-6" },
      provider,
    );
    expect(payload.models.map((m) => m.id)).toEqual([
      "claude-opus-4-7",
      "claude-sonnet-4-7-beta",
    ]);
  });

  it("drops tier from the edited def when the draft clears it", () => {
    const provider = mkExistingProvider();
    const draft = makeDraft({
      tier: "",
      modelId: "claude-sonnet-4-6",
      modelName: "Sonnet",
    });
    const payload = buildEditPayload(
      draft,
      { providerId: "m-1", modelId: "claude-sonnet-4-6" },
      provider,
    );
    const sonnet = payload.models.find((m) => m.id === "claude-sonnet-4-6");
    expect(sonnet?.tier).toBeUndefined();
  });

  it("passes provider-level fields straight through", () => {
    const provider = mkExistingProvider();
    const draft = makeDraft({
      providerName: "Renamed Anthropic",
      baseUrl: "https://proxy.example/v1",
      protocol: "openai-completions",
      authMode: "token",
      apiKey: "sk-new",
    });
    const payload = buildEditPayload(
      draft,
      { providerId: "m-1", modelId: "claude-sonnet-4-6" },
      provider,
    );
    expect(payload.providerName).toBe("Renamed Anthropic");
    expect(payload.baseUrl).toBe("https://proxy.example/v1");
    expect(payload.apiProtocol).toBe("openai-completions");
    expect(payload.authMode).toBe("token");
    expect(payload.apiKey).toBe("sk-new");
  });

  it("passes empty apiKey through (backend treats '' as keep-existing)", () => {
    const provider = mkExistingProvider();
    const draft = makeDraft({ apiKey: "" });
    const payload = buildEditPayload(
      draft,
      { providerId: "m-1", modelId: "claude-sonnet-4-6" },
      provider,
    );
    expect(payload.apiKey).toBe("");
  });
});

// ─── countAgentsUsingModel ────────────────────────────────────────────────

describe("countAgentsUsingModel", () => {
  it("returns 0 when no agent references the pair", () => {
    const agents = [mkAgent("a1", [{ providerId: "other", modelId: "x" }])];
    expect(countAgentsUsingModel("p1", "m1", agents)).toBe(0);
  });

  it("counts one per matching agent, even if the model appears twice in its config", () => {
    const a1 = mkAgent("a1", [
      { providerId: "p1", modelId: "m1" },
      { providerId: "p1", modelId: "m1" }, // dup (shouldn't happen, but be safe)
    ]);
    expect(countAgentsUsingModel("p1", "m1", [a1])).toBe(1);
  });

  it("counts distinct matching agents", () => {
    const agents = [
      mkAgent("a1", [{ providerId: "p1", modelId: "m1" }]),
      mkAgent("a2", [{ providerId: "p1", modelId: "m1" }]),
      mkAgent("a3", [{ providerId: "p2", modelId: "m1" }]), // different providerId
    ];
    expect(countAgentsUsingModel("p1", "m1", agents)).toBe(2);
  });
});
