/**
 * Pure helpers for the tier-cascading "Add Model" modal on the tenant-models
 * page. Kept outside the Lit component so the branching logic (tier/provider
 * lookup, dedup against existing Provider containers, tenant-wide set-default
 * fan-out) is unit-testable without a DOM.
 *
 *  Public surface:
 *   - AddModelDraft / CreateProviderPayload / AddTarget / AgentLike types
 *   - suggestDraftFields(tier, provider)
 *   - validateAddDraft(draft)
 *   - resolveAddTarget(draft, existingProviders)
 *   - buildSetTierDefaultUpdates(providerId, modelId, tier, agents, findTier)
 */

import {
  PROVIDER_TYPES,
  MODEL_SUGGESTIONS,
  type ModelTierValue,
} from "../../../constants/providers.ts";

// ─── Types ────────────────────────────────────────────────────────────────

export interface AddModelDraft {
  tier: ModelTierValue | "";
  provider: string;
  providerName: string;
  baseUrl: string;
  protocol: string;
  authMode: "api-key" | "oauth" | "token" | "none";
  apiKey: string;
  modelId: string;
  modelName: string;
}

export interface ModelDefinitionLite {
  id: string;
  name: string;
  tier?: ModelTierValue;
}

export interface ExistingProviderLite {
  id: string;
  providerType: string;
  providerName: string;
  baseUrl: string | null;
  apiProtocol: string;
  authMode: string;
  models: ModelDefinitionLite[];
}

export interface CreateProviderPayload {
  providerType: string;
  providerName: string;
  baseUrl: string;
  apiProtocol: string;
  authMode: string;
  apiKey: string;
  models: ModelDefinitionLite[];
}

export type AddTarget =
  | { mode: "append"; providerId: string; nextModels: ModelDefinitionLite[]; apiKey: string }
  | { mode: "create"; payload: CreateProviderPayload };

export interface AgentLike {
  id: string;
  modelConfig: Array<{ providerId: string; modelId: string; isDefault: boolean }>;
}

export interface AgentConfigUpdate {
  agentId: string;
  modelConfig: Array<{ providerId: string; modelId: string; isDefault: boolean }>;
}

// ─── suggestDraftFields ───────────────────────────────────────────────────

/**
 * Derive the cascading form defaults when the admin picks a (tier, provider)
 * pair. Falls back to safe empty strings for unknown providers so the caller
 * can surface a free-form entry UI ("custom" provider).
 */
export function suggestDraftFields(
  tier: ModelTierValue | "",
  provider: string,
): {
  baseUrl: string;
  protocol: string;
  modelId: string;
  providerNameSuggestion: string;
} {
  if (!provider) {
    return { baseUrl: "", protocol: "", modelId: "", providerNameSuggestion: "" };
  }
  const def = PROVIDER_TYPES.find((p) => p.value === provider);
  const baseUrl = def?.defaultBaseUrl ?? "";
  const protocol = def?.defaultProtocol ?? "openai-completions";
  const modelId = tier ? (MODEL_SUGGESTIONS[provider]?.[tier] ?? "") : "";
  const providerNameSuggestion = def?.label ? `我的 ${def.label} 账号` : "";
  return { baseUrl, protocol, modelId, providerNameSuggestion };
}

// ─── validateAddDraft ─────────────────────────────────────────────────────

/**
 * Returns a list of i18n keys for each rule violated. An empty list means the
 * draft is submittable. The caller renders the messages in the modal header.
 */
export function validateAddDraft(draft: AddModelDraft): string[] {
  const errors: string[] = [];
  if (!draft.tier) errors.push("models.addForm.errorTierRequired");
  if (!draft.provider) errors.push("models.addForm.errorProviderRequired");
  if (!draft.providerName.trim()) errors.push("models.addForm.errorProviderNameRequired");
  if (!draft.baseUrl.trim() && draft.provider !== "custom") {
    errors.push("models.addForm.errorBaseUrlRequired");
  } else if (!draft.baseUrl.trim() && draft.provider === "custom") {
    // custom still needs an endpoint
    errors.push("models.addForm.errorBaseUrlRequired");
  }
  if (!draft.modelId.trim()) errors.push("models.addForm.errorModelIdRequired");
  if ((draft.authMode === "api-key" || draft.authMode === "token") && !draft.apiKey.trim()) {
    errors.push("models.addForm.errorApiKeyRequired");
  }
  return errors;
}

// ─── resolveAddTarget ─────────────────────────────────────────────────────

/**
 * Decide how to route the new model into the tenant's existing data model.
 *
 * Two Providers with the same `providerName` + `baseUrl` are considered the
 * same "container" — the new model is appended into that container's
 * `models` array. If an entry with the same modelId already exists it's
 * replaced in place (filter-then-push) so the admin can re-enter to fix
 * typos without creating duplicates.
 *
 * Otherwise a fresh Provider is created with the draft's full payload.
 */
export function resolveAddTarget(
  draft: AddModelDraft,
  existingProviders: ExistingProviderLite[],
): AddTarget {
  const newDef: ModelDefinitionLite = {
    id: draft.modelId,
    name: draft.modelName || draft.modelId,
    ...(draft.tier ? { tier: draft.tier as ModelTierValue } : {}),
  };

  const match = existingProviders.find(
    (p) =>
      p.providerName === draft.providerName &&
      (p.baseUrl ?? "") === draft.baseUrl,
  );

  if (match) {
    const nextModels = [
      ...match.models.filter((m) => m.id !== draft.modelId),
      newDef,
    ];
    return {
      mode: "append",
      providerId: match.id,
      nextModels,
      apiKey: draft.apiKey,
    };
  }

  return {
    mode: "create",
    payload: {
      providerType: draft.provider,
      providerName: draft.providerName,
      baseUrl: draft.baseUrl,
      apiProtocol: draft.protocol,
      authMode: draft.authMode,
      apiKey: draft.apiKey,
      models: [newDef],
    },
  };
}

// ─── buildSetTierDefaultUpdates ───────────────────────────────────────────

const LEGACY_TIER_FALLBACK: ModelTierValue = "standard";

/**
 * Compute the minimal set of tenant.agents.update payloads required to make
 * the (providerId, modelId) entry the sole default within `tier` for every
 * agent that currently has at least one same-tier entry.
 *
 *  - Agents without any same-tier entry are skipped (they don't use this tier).
 *  - Agents already in the desired shape are skipped (no-op).
 *  - Legacy (tier=undefined) models are treated as "standard" via
 *    LEGACY_TIER_FALLBACK — mirrors the server-side tier-chain fallback.
 */
export function buildSetTierDefaultUpdates(
  targetProviderId: string,
  targetModelId: string,
  tier: ModelTierValue,
  agents: AgentLike[],
  findTier: (providerId: string, modelId: string) => ModelTierValue | undefined,
): AgentConfigUpdate[] {
  const resolve = (providerId: string, modelId: string): ModelTierValue =>
    findTier(providerId, modelId) ?? LEGACY_TIER_FALLBACK;

  const updates: AgentConfigUpdate[] = [];
  for (const agent of agents) {
    const sameTier = agent.modelConfig.filter(
      (e) => resolve(e.providerId, e.modelId) === tier,
    );
    if (sameTier.length === 0) continue;

    const next = agent.modelConfig.map((e) => {
      if (resolve(e.providerId, e.modelId) !== tier) return e;
      const shouldBeDefault =
        e.providerId === targetProviderId && e.modelId === targetModelId;
      if (e.isDefault === shouldBeDefault) return e;
      return { ...e, isDefault: shouldBeDefault };
    });

    const changed = next.some((e, i) => e.isDefault !== agent.modelConfig[i].isDefault);
    if (!changed) continue;

    updates.push({ agentId: agent.id, modelConfig: next });
  }
  return updates;
}
