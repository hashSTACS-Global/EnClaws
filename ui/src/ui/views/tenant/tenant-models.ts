/**
 * Tenant model management view.
 *
 * Create, edit, and delete LLM provider/model configs scoped to the current tenant.
 * Supports different provider types with dynamic form fields.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { tenantRpc } from "./rpc.ts";
import {
  PROVIDER_TYPES as SHARED_PROVIDERS,
  API_PROTOCOLS as SHARED_PROTOCOLS,
  MODEL_TIERS,
  PROVIDERS_BY_TIER,
  type ModelTierValue,
} from "../../../constants/providers.ts";
import { t } from "../../../i18n/index.ts";
import { I18nController } from "../../../i18n/lib/lit-controller.ts";
import { tierLabel } from "../../../i18n/tier-labels.ts";
import { showConfirm } from "../../components/confirm-dialog.ts";
import { caretFix } from "../../shared-styles.ts";
import {
  TIER_BUCKET_ORDER,
  groupProvidersByTier,
  type TierBucket,
} from "./tenant-models-tier-view.ts";
import {
  suggestDraftFields,
  validateAddDraft,
  resolveAddTarget,
  buildEditPayload,
  countAgentsUsingModel,
  type AddModelDraft,
} from "./tenant-models-add-form.ts";

interface ModelDefinition {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
  tier?: ModelTierValue;
  isTierDefault?: boolean;
}

interface TenantModelConfig {
  id: string;
  providerType: string;
  providerName: string;
  baseUrl: string | null;
  apiProtocol: string;
  authMode: string;
  hasApiKey: boolean;
  extraHeaders: Record<string, string>;
  extraConfig: Record<string, unknown>;
  models: ModelDefinition[];
  visibility?: string;
  isActive: boolean;
  createdAt: string;
}

const PROVIDER_TYPES = SHARED_PROVIDERS;
const API_PROTOCOLS = SHARED_PROTOCOLS;

function emptyAddModelDraft(): AddModelDraft {
  return {
    tier: "",
    provider: "",
    providerName: "",
    baseUrl: "",
    protocol: "",
    authMode: "api-key",
    apiKey: "",
    modelId: "",
    modelName: "",
  };
}

@customElement("tenant-models-view")
export class TenantModelsView extends LitElement {
  static styles = [caretFix, css`
    :host {
      display: block;
      padding: 1.5rem;
      color: var(--text);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    h3 { margin: 0 0 1rem; font-size: 0.95rem; font-weight: 600; }
    h4 { margin: 0.75rem 0 0.5rem; font-size: 0.85rem; font-weight: 600; color: var(--text-2); }
    .btn {
      padding: 0.45rem 0.9rem; border: none; border-radius: var(--radius-md);
      font-size: 0.85rem; cursor: pointer; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent); color: var(--accent-foreground); }
    .btn-danger { background: var(--danger-subtle); color: var(--danger); }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 1rem;
    }
    .model-card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.25rem;
    }
    .model-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; }
    .model-name { font-size: 0.95rem; font-weight: 600; }
    .model-provider { font-size: 0.75rem; color: var(--muted); margin-top: 0.15rem; }
    .model-meta { font-size: 0.8rem; color: var(--text-2); margin-bottom: 0.5rem; }
    .model-meta span { margin-right: 1rem; }
    .model-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.5rem; }
    .model-tag {
      font-size: 0.72rem; padding: 0.15rem 0.5rem;
      background: var(--bg); border: 1px solid var(--border);
      border-radius: 999px; color: var(--text-2);
    }
    .model-tag.reasoning { border-color: var(--warn); color: var(--warn); }
    .shared-badge {
      font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px;
      background: var(--accent-light); color: var(--accent); margin-left: 0.4rem;
    }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.3rem; }
    .status-dot.active { background: var(--ok); }
    .status-dot.inactive { background: var(--border); }
    .model-actions { display: flex; gap: 0.4rem; margin-top: 0.75rem; }
    .error-msg {
      background: var(--danger-subtle); border: 1px solid var(--danger);
      border-radius: var(--radius-md); color: var(--danger);
      padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .success-msg {
      background: var(--ok-subtle); border: 1px solid var(--ok); border-radius: var(--radius-md);
      color: var(--ok); padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .form-card {
      background: var(--card); border: 1px solid var(--border);
      border-radius: var(--radius-lg); padding: 1.25rem; margin-bottom: 1.5rem;
    }
    .form-row { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; }
    .form-field { flex: 1; }
    .form-field label { display: block; font-size: 0.8rem; margin-bottom: 0.3rem; color: var(--text-2); }
    .form-field input, .form-field textarea, .form-field select {
      width: 100%; padding: 0.45rem 0.65rem; background: var(--input-bg);
      border: 1px solid var(--input-border); border-radius: var(--radius-md);
      color: var(--text); font-size: 0.85rem; outline: none; box-sizing: border-box;
    }
    .form-field input:focus, .form-field select:focus { border-color: var(--accent); }
    .form-hint { font-size: 0.72rem; color: var(--muted); margin-top: 0.25rem; }
    .empty { text-align: center; padding: 2rem; color: var(--muted); font-size: 0.85rem; }
    .loading { text-align: center; padding: 2rem; color: var(--muted); }
    .sub-models-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 0.5rem; }
    .sub-models-table th, .sub-models-table td {
      text-align: left; padding: 0.4rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .sub-models-table th { color: var(--text-2); font-weight: 500; }
    .sub-model-form { background: var(--input-bg); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 0.75rem; margin-top: 0.5rem; }
    .sub-model-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: flex-end; }
    .sub-model-row .form-field { flex: 1; }
    .sub-model-row .form-field label { font-size: 0.72rem; }
    .sub-model-row .form-field input { font-size: 0.8rem; padding: 0.35rem 0.5rem; }
    /* Tier badge used on model tags and in the "by tier" view rows. */
    .tier-badge {
      display: inline-block;
      font-size: 0.68rem;
      padding: 0.05rem 0.4rem;
      border-radius: 3px;
      margin-left: 0.35rem;
      font-weight: 500;
      letter-spacing: 0.02em;
      background: var(--bg);
      border: 1px solid var(--border);
      color: var(--text-2);
    }
    .tier-badge.tier-pro { color: var(--accent); border-color: var(--accent); }
    .tier-badge.tier-standard { color: var(--ok); border-color: var(--ok); }
    .tier-badge.tier-lite { color: var(--warn); border-color: var(--warn); }
    .tier-badge.tier-unassigned { color: var(--muted); }
    /* View switcher */
    .view-switch { display: inline-flex; gap: 0.25rem; margin-right: 0.5rem; }
    .view-switch .btn { border: 1px solid var(--border); background: transparent; color: var(--text-2); }
    .view-switch .btn.active { background: var(--accent-light); color: var(--accent); border-color: var(--accent); }
    /* By-tier view */
    .tier-section { margin-bottom: 1.5rem; }
    .tier-section-head { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; font-size: 0.9rem; font-weight: 600; color: var(--text); }
    .tier-section-head .count { font-size: 0.75rem; color: var(--muted); font-weight: 400; }
    .tier-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.6rem 0.9rem; border: 1px solid var(--border);
      border-radius: var(--radius-md); background: var(--card);
      margin-bottom: 0.4rem;
    }
    .tier-row-main { display: flex; flex-direction: column; gap: 0.15rem; }
    .tier-default-badge {
      margin-left: 0.5rem;
      font-size: 0.7rem;
      padding: 0.05rem 0.45rem;
      border-radius: 3px;
      color: var(--accent);
      border: 1px solid var(--accent);
      letter-spacing: 0.03em;
      vertical-align: middle;
    }
    .tier-row-title { font-size: 0.9rem; font-weight: 500; }
    .tier-row-sub { font-size: 0.75rem; color: var(--muted); }
    .tier-unassigned-hint {
      font-size: 0.75rem; color: var(--warn);
      padding: 0.4rem 0.6rem;
      background: var(--warn-subtle, var(--bg));
      border-radius: var(--radius-md);
      margin-bottom: 0.5rem;
    }
    /* Add Model modal (tier-cascading) */
    .modal-overlay {
      position: fixed; inset: 0;
      background: rgba(0, 0, 0, 0.45);
      display: flex; align-items: center; justify-content: center;
      z-index: 100;
    }
    .modal-box {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: var(--radius-lg);
      padding: 1.5rem;
      width: min(560px, 92vw);
      max-height: 90vh;
      overflow-y: auto;
    }
    .modal-box h3 { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; }
    .modal-box .form-field { margin-bottom: 0.8rem; }
    .modal-box .form-field label {
      display: block; font-size: 0.78rem; color: var(--text-2);
      margin-bottom: 0.3rem;
    }
    .modal-box .form-field input,
    .modal-box .form-field select {
      width: 100%;
      padding: 0.45rem 0.6rem;
      border: 1px solid var(--border);
      border-radius: var(--radius-md);
      background: var(--bg); color: var(--text);
      font-size: 0.85rem;
    }
    .modal-actions {
      display: flex; justify-content: flex-end; gap: 0.5rem;
      margin-top: 1.2rem;
    }
    .tier-pills { display: flex; gap: 0.4rem; flex-wrap: wrap; }
    .tier-pill {
      padding: 0.4rem 1rem;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--text-2);
      cursor: pointer;
      font-size: 0.8rem;
      font-weight: 500;
    }
    .tier-pill:hover { background: var(--bg); }
    .tier-pill.selected.tier-pro { color: var(--accent); border-color: var(--accent); }
    .tier-pill.selected.tier-standard { color: var(--ok); border-color: var(--ok); }
    .tier-pill.selected.tier-lite { color: var(--warn); border-color: var(--warn); }
    .modal-hint { font-size: 0.78rem; color: var(--muted); padding: 0.3rem 0 0.5rem; }
    .modal-errors {
      font-size: 0.78rem; color: var(--danger);
      background: var(--danger-subtle);
      padding: 0.5rem 0.7rem;
      border-radius: var(--radius-md);
      margin-top: 0.5rem;
    }
    .modal-errors > div { margin: 0.15rem 0; }
    .test-result {
      font-size: 0.78rem;
      padding: 0.5rem 0.7rem;
      border-radius: var(--radius-md);
      margin-top: 0.5rem;
      word-break: break-word;
    }
    .test-result.ok { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }
    .test-result.fail { color: var(--danger); background: var(--danger-subtle); }
  `];

  private i18nController = new I18nController(this);

  @property({ type: String }) gatewayUrl = "";
  @state() private configs: TenantModelConfig[] = [];
  @state() private loading = false;
  @state() private errorKey = "";
  @state() private successKey = "";
  private msgParams: Record<string, string> = {};
  private msgTimer?: ReturnType<typeof setTimeout>;
  @state() private showForm = false;
  @state() private saving = false;
  @state() private editingId: string | null = null;

  // Form fields
  @state() private formProviderType = "openai";
  @state() private formProviderName = "";
  @state() private formBaseUrl = "";
  @state() private formApiProtocol = "openai-completions";
  @state() private formAuthMode = "api-key";
  @state() private formApiKey = "";
  @state() private formModels: ModelDefinition[] = [];

  // Sub-model form
  @state() private showModelForm = false;
  @state() private subModelId = "";
  @state() private subModelName = "";
  @state() private subModelTier: ModelTierValue | "" = "";

  // View switcher: "tier" (flat list grouped by model tier, default) vs
  // "provider" (Provider-container cards, currently only reachable
  // programmatically — switcher UI is hidden per product direction).
  @state() private viewMode: "provider" | "tier" = "tier";

  // Tier-cascading Add/Edit Model modal state (separate from the legacy
  // Provider-level showForm flow above).
  @state() private showAddModel = false;
  @state() private addModelDraft: AddModelDraft = emptyAddModelDraft();
  @state() private addModelErrors: string[] = [];
  @state() private modalMode: "add" | "edit" = "add";
  @state() private editingHandle: { providerId: string; modelId: string } | null = null;
  @state() private testingConnection = false;
  @state() private testResult: { ok: boolean; status: number; durationMs: number; errorMessage?: string } | null = null;

  // Cached agent list — used by countAgentsUsingModel to decide whether
  // a tier change on a model needs the soft-confirm dialog.
  private cachedAgents: Array<{
    name: string;
    agentId: string;
    modelConfig: Array<{ providerId: string; modelId: string }>;
  }> = [];

  private showError(key: string, params?: Record<string, string>) {
    this.errorKey = key;
    this.successKey = "";
    this.msgParams = params ?? {};
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.errorKey = ""), 5000);
  }

  private showSuccess(key: string, params?: Record<string, string>) {
    this.successKey = key;
    this.errorKey = "";
    this.msgParams = params ?? {};
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.successKey = ""), 5000);
  }

  /** Translate key at render time; raw server messages pass through as-is. */
  private tr(key: string): string {
    const result = t(key, this.msgParams);
    return result === key ? key : result;
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfigs();
    this.loadAgents();
  }

  private async loadAgents() {
    try {
      const result = (await this.rpc("tenant.agents.list")) as {
        agents: Array<{
          name: string;
          agentId: string;
          modelConfig: Array<{ providerId: string; modelId: string }>;
        }>;
      };
      this.cachedAgents = result.agents ?? [];
    } catch {
      this.cachedAgents = [];
    }
  }

  /**
   * Tenant-wide "make this model the default for its tier" action.
   *
   * Delegates to the transactional server RPC `tenant.models.setTierDefault`,
   * which walks every private `tenant_models` row in the target tier and
   * flips isTierDefault flags inside a single DB transaction. No concurrent-
   * request race window like the old per-provider Promise.all client fan-out.
   */
  private async setAsTierDefault(providerId: string, modelId: string) {
    const target = this.configs
      .find((c) => c.id === providerId)
      ?.models.find((m) => m.id === modelId);
    const tier = target?.tier;
    if (!tier) {
      this.showError("models.unassignedCantBeDefault");
      return;
    }
    this.saving = true;
    try {
      await this.rpc("tenant.models.setTierDefault", { tier, providerId, modelId });
      await this.loadConfigs();
      this.showSuccess("models.saved");
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "models.saveFailed");
    } finally {
      this.saving = false;
    }
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private async loadConfigs() {
    this.loading = true;
    this.errorKey = "";
    try {
      const result = await this.rpc("tenant.models.list") as { models: TenantModelConfig[] };
      this.configs = result.models;
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "models.loadFailed");
    } finally {
      this.loading = false;
    }
  }

  // ─── Tier-cascading Add Model modal ───────────────────────────────────

  private openAddModel() {
    this.modalMode = "add";
    this.editingHandle = null;
    this.addModelDraft = emptyAddModelDraft();
    this.addModelErrors = [];
    this.showAddModel = true;
  }

  private openEditModal(providerId: string, modelId: string) {
    const provider = this.configs.find((c) => c.id === providerId);
    const def = provider?.models.find((d) => d.id === modelId);
    if (!provider || !def) return;

    this.modalMode = "edit";
    this.editingHandle = { providerId, modelId };
    this.addModelDraft = {
      tier: def.tier ?? "",
      provider: provider.providerType,
      providerName: provider.providerName,
      baseUrl: provider.baseUrl ?? "",
      protocol: provider.apiProtocol,
      authMode: provider.authMode as AddModelDraft["authMode"],
      apiKey: "",
      modelId: def.id,
      modelName: def.name,
    };
    this.addModelErrors = [];
    this.showAddModel = true;
  }

  private resetTest() {
    this.testResult = null;
  }

  private closeAddModel() {
    this.testResult = null;
    this.testingConnection = false;
    this.showAddModel = false;
    this.addModelErrors = [];
    this.modalMode = "add";
    this.editingHandle = null;
  }

  private onAddTierChange(tier: ModelTierValue) {
    this.addModelDraft = {
      ...emptyAddModelDraft(),
      tier,
      authMode: this.addModelDraft.authMode,
    };
    this.addModelErrors = [];
  }

  private onAddProviderChange(provider: string) {
    const s = suggestDraftFields(this.addModelDraft.tier, provider);
    this.addModelDraft = {
      ...this.addModelDraft,
      provider,
      baseUrl: s.baseUrl,
      protocol: s.protocol,
      modelId: s.modelId,
      modelName: s.modelId,
      providerName: this.addModelDraft.providerName || s.providerNameSuggestion,
    };
    this.addModelErrors = [];
  }

  private patchDraft(patch: Partial<AddModelDraft>) {
    this.addModelDraft = { ...this.addModelDraft, ...patch };
    if (this.addModelErrors.length > 0) this.addModelErrors = [];
  }

  private async testConnection() {
    const d = this.addModelDraft;
    this.testingConnection = true;
    this.testResult = null;
    try {
      const res = (await this.rpc("tenant.models.testConnection", {
        baseUrl: d.baseUrl,
        apiProtocol: d.protocol,
        authMode: d.authMode,
        apiKey: d.apiKey,
        modelId: d.modelId,
        providerId: this.editingHandle?.providerId,
      })) as { ok: boolean; status: number; durationMs: number; errorMessage?: string };
      this.testResult = res;
    } catch (err) {
      this.testResult = { ok: false, status: 0, durationMs: 0, errorMessage: err instanceof Error ? err.message : String(err) };
    } finally {
      this.testingConnection = false;
    }
  }

  private async submitModal() {
    const errors = validateAddDraft(this.addModelDraft, { mode: this.modalMode });
    if (errors.length > 0) {
      this.addModelErrors = errors;
      return;
    }
    this.saving = true;
    try {
      if (this.modalMode === "edit" && this.editingHandle) {
        const { providerId, modelId } = this.editingHandle;
        const existing = this.configs.find((c) => c.id === providerId);
        const existingDef = existing?.models.find((m) => m.id === modelId);
        if (!existing || !existingDef) throw new Error("models.providerNotFound");
        if (existingDef.tier !== this.addModelDraft.tier) {
          const count = countAgentsUsingModel(providerId, modelId, this.cachedAgents);
          if (count > 0) {
            const ok = window.confirm(
              t("models.addForm.tierChangeConfirm", { count: String(count) }),
            );
            if (!ok) return;
          }
        }
        const payload = buildEditPayload(this.addModelDraft, this.editingHandle, existing);
        await this.rpc("tenant.models.update", { ...payload });
      } else {
        const target = resolveAddTarget(this.addModelDraft, this.configs);
        if (target.mode === "append") {
          await this.rpc("tenant.models.update", {
            id: target.providerId,
            models: target.nextModels,
            ...(target.apiKey ? { apiKey: target.apiKey } : {}),
          });
        } else {
          await this.rpc("tenant.models.create", { ...target.payload });
        }
      }
      this.showSuccess("models.saved");
      await this.loadConfigs();
      this.closeAddModel();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "models.saveFailed");
    } finally {
      this.saving = false;
    }
  }

  private startCreate() {
    this.editingId = null;
    this.formProviderType = "openai";
    this.formProviderName = "OpenAI";
    this.providerNameManuallyEdited = false;
    this.formBaseUrl = "https://api.openai.com/v1";
    this.formApiProtocol = "openai-completions";
    this.formAuthMode = "api-key";
    this.formApiKey = "";
    this.formModels = [];
    this.showModelForm = false;
    this.showForm = true;
  }

  private startEdit(config: TenantModelConfig) {
    this.editingId = config.id;
    this.formProviderType = config.providerType;
    this.formProviderName = config.providerName;
    this.providerNameManuallyEdited = true; // editing existing — treat as manual
    this.formBaseUrl = config.baseUrl ?? "";
    this.formApiProtocol = config.apiProtocol;
    this.formAuthMode = config.authMode;
    this.formApiKey = "";
    this.formModels = [...config.models];
    this.showModelForm = false;
    this.showForm = true;
  }

  /** Track whether the user has manually edited the provider name */
  private providerNameManuallyEdited = false;

  private onProviderTypeChange(value: string) {
    this.formProviderType = value;
    const provider = PROVIDER_TYPES.find((p) => p.value === value);
    if (provider) {
      this.formBaseUrl = provider.defaultBaseUrl;
      this.formApiProtocol = provider.defaultProtocol;
      // Always sync provider name unless user has manually edited it
      if (!this.providerNameManuallyEdited) {
        this.formProviderName = provider.label;
      }
      if (value === "ollama") {
        this.formAuthMode = "none";
      } else {
        this.formAuthMode = "api-key";
      }
    }
  }

  private startAddModel() {
    this.subModelId = "";
    this.subModelName = "";
    this.subModelTier = "";
    this.showModelForm = true;
  }

  private addModel() {
    if (!this.subModelId) {
      this.showError("models.modelIdRequired");
      return;
    }
    if (!this.subModelName) {
      this.showError("models.displayNameRequired");
      return;
    }
    if (this.formModels.some((m) => m.id === this.subModelId)) {
      this.showError("models.duplicateModelId");
      return;
    }
    this.formModels = [
      ...this.formModels,
      {
        id: this.subModelId,
        name: this.subModelName,
        reasoning: false,
        input: ["text"],
        contextWindow: 128000,
        maxTokens: 128000,
        ...(this.subModelTier ? { tier: this.subModelTier } : {}),
      },
    ];
    this.showModelForm = false;
  }

  private removeModel(idx: number) {
    const model = this.formModels[idx];
    if (this.editingId && model) {
      const conflicts = this.cachedAgents.filter((a) =>
        (a.modelConfig ?? []).some((mc) => mc.providerId === this.editingId && mc.modelId === model.id),
      );
      if (conflicts.length > 0) {
        const names = conflicts.map((a) => a.name || a.agentId).join(", ");
        this.showError("models.removeModelInUse", { agents: names });
        return;
      }
    }
    this.formModels = this.formModels.filter((_, i) => i !== idx);
  }

  private async handleSave(e: Event) {
    e.preventDefault();
    if (!this.formProviderType || !this.formProviderName) return;
    if (this.formModels.length === 0) {
      this.showError("models.needOneModel");
      return;
    }

    this.saving = true;
    this.errorKey = "";
    this.successKey = "";

    try {
      if (this.editingId) {
        await this.rpc("tenant.models.update", {
          id: this.editingId,
          providerName: this.formProviderName,
          baseUrl: this.formBaseUrl || undefined,
          apiProtocol: this.formApiProtocol,
          authMode: this.formAuthMode,
          ...(this.formApiKey ? { apiKey: this.formApiKey } : {}),
          models: this.formModels,
        });
        this.showSuccess("models.configUpdated");
      } else {
        await this.rpc("tenant.models.create", {
          providerType: this.formProviderType,
          providerName: this.formProviderName,
          baseUrl: this.formBaseUrl || undefined,
          apiProtocol: this.formApiProtocol,
          authMode: this.formAuthMode,
          ...(this.formApiKey ? { apiKey: this.formApiKey } : {}),
          models: this.formModels,
        });
        this.showSuccess("models.configCreated");
      }
      this.showForm = false;
      await this.loadConfigs();
    } catch (err: any) {
      this.showError(err?.message ?? "models.saveFailed", err?.details);
    } finally {
      this.saving = false;
    }
  }

  private async handleDelete(config: TenantModelConfig) {
    const ok = await showConfirm({
      title: t("models.delete"),
      message: t("models.confirmDelete", { name: config.providerName }),
      confirmText: t("models.delete"),
      cancelText: t("models.cancel"),
      danger: true,
    });
    if (!ok) return;
    this.errorKey = "";
    try {
      await this.rpc("tenant.models.delete", { id: config.id });
      this.showSuccess("models.configDeleted", { name: config.providerName });
      await this.loadConfigs();
    } catch (err: any) {
      this.showError(err?.message ?? "models.deleteFailed", err?.details);
    }
  }

  private async handleToggle(config: TenantModelConfig) {
    try {
      await this.rpc("tenant.models.update", { id: config.id, isActive: !config.isActive });
      await this.loadConfigs();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "models.toggleFailed");
    }
  }

  render() {
    return html`
      <div class="header">
        <h2>${t("models.title")}</h2>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <button class="btn btn-outline" @click=${() => this.loadConfigs()}>${t("models.refresh")}</button>
          <button class="btn btn-primary" @click=${() => this.openAddModel()}>${t("models.addModel")}</button>
          ${this.showForm ? html`
            <button class="btn btn-outline" @click=${() => (this.showForm = false)}>${t("models.cancel")}</button>
          ` : nothing}
        </div>
      </div>

      ${this.errorKey ? html`<div class="error-msg">${this.tr(this.errorKey)}</div>` : nothing}
      ${this.successKey ? html`<div class="success-msg">${this.tr(this.successKey)}</div>` : nothing}

      ${this.showAddModel ? this.renderAddModelModal() : nothing}
      ${this.showForm ? this.renderForm() : nothing}

      ${this.loading
        ? html`<div class="loading">${t("models.loading")}</div>`
        : this.configs.length === 0
          ? html`<div class="empty">${t("models.empty")}</div>`
          : this.viewMode === "tier"
            ? this.renderTierView()
            : html`
              <div class="card-grid">
                ${this.configs.map((c) => this.renderCard(c))}
              </div>
            `}
    `;
  }

  /** Small tier badge used on both Provider cards (model tags) and the by-tier rows. */
  private renderTierBadge(tier: ModelTierValue | undefined) {
    if (!tier) return nothing;
    return html`<span class="tier-badge tier-${tier}">${tierLabel(tier)}</span>`;
  }

  /** Flat, tier-grouped view. Shares data with the Provider view — no extra fetch. */
  private renderTierView() {
    const buckets = groupProvidersByTier(this.configs);
    const visibleTiers: TierBucket[] = TIER_BUCKET_ORDER.filter((t) => buckets[t].length > 0);

    return html`
      ${visibleTiers.map((tier) => html`
        <div class="tier-section">
          <div class="tier-section-head">
            <span class="tier-badge tier-${tier}">
              ${tier === "unassigned" ? t("models.tierUnassigned") : tierLabel(tier as ModelTierValue)}
            </span>
            <span class="count">${t("models.tierCount", { count: String(buckets[tier].length) })}</span>
          </div>
          ${tier === "unassigned" ? html`
            <div class="tier-unassigned-hint">${t("models.tierUnassignedHint")}</div>
          ` : nothing}
          ${buckets[tier].map((entry) => {
            const providerLabel = PROVIDER_TYPES.find((p) => p.value === entry.providerType)?.label ?? entry.providerType;
            const cfg = this.configs.find((c) => c.id === entry.providerId);
            return html`
              <div class="tier-row">
                <div class="tier-row-main">
                  <div class="tier-row-title">
                    ${entry.modelName} <span style="font-family:monospace;color:var(--muted);font-size:0.8rem">(${entry.modelId})</span>
                    ${entry.isTierDefault ? html`<span class="tier-default-badge">${t("models.tierIsDefault")}</span>` : nothing}
                  </div>
                  <div class="tier-row-sub">
                    ${providerLabel} · ${entry.providerName}
                    ${entry.isShared ? html`<span class="shared-badge">${t("platformModels.shared")}</span>` : nothing}
                    ${!entry.isActive ? html`<span style="color:var(--danger);margin-left:0.5rem">${t("models.disable")}</span>` : nothing}
                  </div>
                </div>
                ${entry.isShared || !cfg ? nothing : html`
                  <div style="display:flex;gap:0.3rem">
                    ${entry.tier && !entry.isTierDefault ? html`
                      <button
                        class="btn btn-outline btn-sm"
                        ?disabled=${this.saving}
                        @click=${() => this.setAsTierDefault(entry.providerId, entry.modelId)}>
                        ${t("models.setTierDefault")}
                      </button>
                    ` : nothing}
                    <button class="btn btn-outline btn-sm" @click=${() => this.openEditModal(entry.providerId, entry.modelId)}>${t("models.edit")}</button>
                  </div>
                `}
              </div>
            `;
          })}
        </div>
      `)}
    `;
  }

  private renderCard(config: TenantModelConfig) {
    const providerLabel = PROVIDER_TYPES.find((p) => p.value === config.providerType)?.label ?? config.providerType;
    const isShared = config.visibility === "shared";
    return html`
      <div class="model-card">
        <div class="model-card-header">
          <div>
            <div class="model-name">
              <span class="status-dot ${config.isActive ? "active" : "inactive"}"></span>
              ${config.providerName}
              ${isShared ? html`<span class="shared-badge">${t("platformModels.shared")}</span>` : nothing}
              ${!config.isActive ? html`<span style="font-size:0.7rem;padding:0.1rem 0.4rem;border-radius:4px;background:var(--danger-subtle);color:var(--danger);margin-left:0.4rem">${t("models.disable")}</span>` : nothing}
            </div>
            <div class="model-provider">${providerLabel} | ${config.apiProtocol}</div>
          </div>
        </div>
        <div class="model-meta">
          ${config.baseUrl ? html`<span>URL: ${config.baseUrl}</span>` : nothing}
          <span>${t("models.authMode")}: ${config.authMode}${config.hasApiKey ? ` (${t("models.authConfigured")})` : ""}</span>
        </div>
        <div class="model-tags">
          ${config.models.map((m) => html`
            <span class="model-tag ${m.reasoning ? "reasoning" : ""}">
              ${m.name} (${m.id})${this.renderTierBadge(m.tier)}
            </span>
          `)}
        </div>
        ${isShared ? nothing : html`
          <div class="model-actions">
            <button class="btn btn-outline btn-sm" @click=${() => this.startEdit(config)}>${t("models.edit")}</button>
            <button class="btn btn-danger btn-sm" @click=${() => this.handleDelete(config)}>${t("models.delete")}</button>
          </div>
        `}
      </div>
    `;
  }

  private renderAddModelModal() {
    const d = this.addModelDraft;
    const providerOptions = d.tier
      ? PROVIDERS_BY_TIER[d.tier]
          .map((pv) => PROVIDER_TYPES.find((pt) => pt.value === pv))
          .filter((pt): pt is (typeof PROVIDER_TYPES)[number] => pt !== undefined)
      : [];
    const needsApiKey = d.authMode === "api-key" || d.authMode === "token";
    return html`
      <div
        class="modal-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) this.closeAddModel();
        }}>
        <div class="modal-box">
          <h3>${this.modalMode === "edit" ? t("models.addForm.editTitle") : t("models.addForm.title")}</h3>
          ${this.modalMode === "edit"
            ? html`<div class="modal-hint">${t("models.addForm.editSubtitle")}</div>`
            : nothing}

          <div class="form-field">
            <label>${t("models.addForm.tierLabel")}</label>
            <div class="tier-pills">
              ${MODEL_TIERS.map((tier) => html`
                <button
                  type="button"
                  class="tier-pill tier-${tier} ${d.tier === tier ? "selected" : ""}"
                  @click=${() => this.onAddTierChange(tier)}>
                  ${tierLabel(tier)}
                </button>
              `)}
            </div>
          </div>

          ${d.tier ? html`
            <div class="form-field">
              <label>${t("models.addForm.providerLabel")}</label>
              <select
                .value=${d.provider}
                @change=${(e: Event) => this.onAddProviderChange((e.target as HTMLSelectElement).value)}>
                <option value="">—</option>
                ${providerOptions.map((opt) => html`
                  <option value=${opt.value} ?selected=${d.provider === opt.value}>${opt.label}</option>
                `)}
              </select>
            </div>
          ` : html`<div class="modal-hint">${t("models.addForm.pickTierFirst")}</div>`}

          ${d.provider ? html`
            <div class="form-field">
              <label>${t("models.addForm.providerNameLabel")}</label>
              <input
                type="text"
                .value=${d.providerName}
                @input=${(e: Event) => this.patchDraft({ providerName: (e.target as HTMLInputElement).value })} />
            </div>
            <div class="form-field">
              <label>${t("models.addForm.baseUrlLabel")}</label>
              <input
                type="text"
                .value=${d.baseUrl}
                @input=${(e: Event) => this.patchDraft({ baseUrl: (e.target as HTMLInputElement).value })} />
            </div>
            <div class="form-field">
              <label>${t("models.addForm.modelIdLabel")}</label>
              <input
                type="text"
                style="font-family:monospace"
                .value=${d.modelId}
                @input=${(e: Event) => {
                  const v = (e.target as HTMLInputElement).value;
                  this.patchDraft({ modelId: v, modelName: d.modelName || v });
                }} />
            </div>
            <div class="form-field">
              <label>${t("models.addForm.authModeLabel")}</label>
              <select
                .value=${d.authMode}
                @change=${(e: Event) =>
                  this.patchDraft({ authMode: (e.target as HTMLSelectElement).value as AddModelDraft["authMode"] })}>
                <option value="api-key" ?selected=${d.authMode === "api-key"}>API Key</option>
                <option value="token" ?selected=${d.authMode === "token"}>Token</option>
                <option value="none" ?selected=${d.authMode === "none"}>${t("models.authNone")}</option>
              </select>
            </div>
            ${needsApiKey ? html`
              <div class="form-field">
                <label>${t("models.addForm.apiKeyLabel")}${this.modalMode === "edit" ? html` <span class="modal-hint" style="display:inline">${t("models.addForm.apiKeyKeepHint")}</span>` : nothing}</label>
                <input
                  type="password"
                  placeholder=${this.modalMode === "edit" ? t("models.addForm.apiKeyEditPlaceholder") : ""}
                  .value=${d.apiKey}
                  @input=${(e: Event) => this.patchDraft({ apiKey: (e.target as HTMLInputElement).value })} />
              </div>
            ` : nothing}
          ` : nothing}

          ${this.addModelErrors.length > 0 ? html`
            <div class="modal-errors">
              ${this.addModelErrors.map((k) => html`<div>${t(k)}</div>`)}
            </div>
          ` : nothing}

          ${this.testResult ? html`
            <div class="test-result ${this.testResult.ok ? "ok" : "fail"}">
              ${this.testResult.ok
                ? t("models.addForm.testOk", { ms: String(this.testResult.durationMs) })
                : t("models.addForm.testFailed", {
                    status: String(this.testResult.status),
                    ms: String(this.testResult.durationMs),
                    msg: this.testResult.errorMessage ?? "",
                  })}
            </div>
          ` : nothing}

          <div class="modal-actions">
            <button
              class="btn btn-outline"
              type="button"
              style="margin-right:auto"
              ?disabled=${this.testingConnection || !this.addModelDraft.modelId || !this.addModelDraft.baseUrl}
              @click=${() => this.testConnection()}>
              ${this.testingConnection ? t("models.addForm.testing") : t("models.addForm.testConnection")}
            </button>
            <button class="btn btn-outline" type="button" @click=${() => this.closeAddModel()}>
              ${t("models.addForm.cancel")}
            </button>
            <button
              class="btn btn-primary"
              type="button"
              ?disabled=${this.saving}
              @click=${() => this.submitModal()}>
              ${this.saving
                ? t("models.saving")
                : this.modalMode === "edit"
                  ? t("models.addForm.submitEdit")
                  : t("models.addForm.submit")}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderForm() {
    return html`
      <div class="form-card">
        <h3>${this.editingId ? t("models.editTitle") : t("models.createTitle")}</h3>
        <form @submit=${this.handleSave}>
          <!-- Provider Type & Name -->
          <div class="form-row">
            <div class="form-field">
              <label>${t("models.providerType")}</label>
              <select
                ?disabled=${!!this.editingId}
                @change=${(e: Event) => this.onProviderTypeChange((e.target as HTMLSelectElement).value)}>
                ${PROVIDER_TYPES.map((p) => html`
                  <option value=${p.value} ?selected=${this.formProviderType === p.value}>${p.label}</option>
                `)}
              </select>
            </div>
            <div class="form-field">
              <label>${t("models.providerName")}</label>
              <input type="text" required .placeholder=${t("models.providerNamePlaceholder")}
                .value=${this.formProviderName}
                @input=${(e: InputEvent) => {
                  this.formProviderName = (e.target as HTMLInputElement).value;
                  this.providerNameManuallyEdited = true;
                }} />
              <div class="form-hint">${t("models.providerNameHint")}</div>
            </div>
          </div>

          <!-- Base URL & Protocol -->
          <div class="form-row">
            <div class="form-field">
              <label>${t("models.baseUrl")}</label>
              <input type="text" .placeholder=${t("models.baseUrlPlaceholder")}
                .value=${this.formBaseUrl}
                @input=${(e: InputEvent) => (this.formBaseUrl = (e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-field">
              <label>${t("models.apiProtocol")}</label>
              <select @change=${(e: Event) => (this.formApiProtocol = (e.target as HTMLSelectElement).value)}>
                ${API_PROTOCOLS.map((p) => html`
                  <option value=${p.value} ?selected=${this.formApiProtocol === p.value}>${p.label}</option>
                `)}
              </select>
            </div>
          </div>

          <!-- Auth -->
          <div class="form-row">
            <div class="form-field">
              <label>${t("models.authMode")}</label>
              <select @change=${(e: Event) => (this.formAuthMode = (e.target as HTMLSelectElement).value)}>
                <option value="api-key" ?selected=${this.formAuthMode === "api-key"}>API Key</option>
                <option value="token" ?selected=${this.formAuthMode === "token"}>Token</option>
                <option value="none" ?selected=${this.formAuthMode === "none"}>${t("models.authNone")}</option>
              </select>
            </div>
            ${this.formAuthMode === "api-key" || this.formAuthMode === "token" ? html`
              <div class="form-field">
                <label>${t("models.apiKey")}${this.editingId ? t("models.apiKeyKeepHint") : ""}</label>
                <input type="password" .placeholder=${t("models.apiKeyPlaceholder")}
                  .value=${this.formApiKey}
                  @input=${(e: InputEvent) => (this.formApiKey = (e.target as HTMLInputElement).value)} />
              </div>
            ` : nothing}
          </div>

          <!-- Models list -->
          <h4>${t("models.modelsCount", { count: String(this.formModels.length) })}</h4>
          ${this.formModels.length > 0 ? html`
            <table class="sub-models-table">
              <thead>
                <tr>
                  <th>${t("models.modelId")}</th>
                  <th>${t("models.modelName")}</th>
                  <th>${t("models.tier")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${this.formModels.map((m, idx) => html`
                  <tr>
                    <td style="font-family:monospace">${m.id}</td>
                    <td>${m.name}</td>
                    <td>${m.tier ? tierLabel(m.tier) : html`<span style="color:var(--muted)">${t("models.tierUnset")}</span>`}</td>
                    <td><button type="button" class="btn btn-danger btn-sm" @click=${() => this.removeModel(idx)}>${t("models.remove")}</button></td>
                  </tr>
                `)}
              </tbody>
            </table>
          ` : nothing}

          ${this.showModelForm ? html`
            <div class="sub-model-form">
              <div class="sub-model-row">
                <div class="form-field">
                  <label>${t("models.modelId")}</label>
                  <input type="text" .placeholder=${t("models.modelIdPlaceholder")}
                    .value=${this.subModelId}
                    @input=${(e: InputEvent) => (this.subModelId = (e.target as HTMLInputElement).value)} />
                </div>
                <div class="form-field">
                  <label>${t("models.displayName")}</label>
                  <input type="text" .placeholder=${t("models.displayNamePlaceholder")}
                    .value=${this.subModelName}
                    @input=${(e: InputEvent) => (this.subModelName = (e.target as HTMLInputElement).value)} />
                </div>
                <div class="form-field">
                  <label>${t("models.tier")}</label>
                  <select
                    .value=${this.subModelTier}
                    @change=${(e: Event) => (this.subModelTier = (e.target as HTMLSelectElement).value as ModelTierValue | "")}>
                    <option value="">${t("models.tierUnset")}</option>
                    ${MODEL_TIERS.map((tier) => html`
                      <option value=${tier} ?selected=${this.subModelTier === tier}>${tierLabel(tier)}</option>
                    `)}
                  </select>
                </div>
                <div style="display:flex;align-items:flex-end">
                  <button type="button" class="btn btn-primary btn-sm" @click=${() => this.addModel()}>${t("models.add")}</button>
                </div>
                <div style="display:flex;align-items:flex-end">
                  <button type="button" class="btn btn-outline btn-sm" @click=${() => (this.showModelForm = false)}>${t("models.cancel")}</button>
                </div>
              </div>
            </div>
          ` : html`
            <button type="button" class="btn btn-outline btn-sm" style="margin-top:0.5rem" @click=${() => this.startAddModel()}>${t("models.addModel")}</button>
          `}

          <!-- Submit -->
          <div style="display:flex;gap:0.5rem;margin-top:1.25rem">
            <button class="btn btn-primary" type="submit" ?disabled=${this.saving}>
              ${this.saving ? t("models.saving") : t("models.save")}
            </button>
            <button class="btn btn-outline" type="button" @click=${() => (this.showForm = false)}>${t("models.cancel")}</button>
          </div>
        </form>
      </div>
    `;
  }
}
