/**
 * Tenant model management view.
 *
 * Create, edit, and delete LLM provider/model configs scoped to the current tenant.
 * Supports different provider types with dynamic form fields.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { tenantRpc } from "./rpc.ts";
import { t } from "../../../i18n/index.ts";
import { I18nController } from "../../../i18n/lib/lit-controller.ts";

interface ModelDefinition {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
  cost?: { input: number; output: number; cacheRead: number; cacheWrite: number };
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
  isActive: boolean;
  createdAt: string;
}

const PROVIDER_TYPES = [
  { value: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", defaultProtocol: "openai-completions" },
  { value: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com", defaultProtocol: "anthropic-messages" },
  { value: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", defaultProtocol: "openai-completions" },
  { value: "qwen", label: "Qwen (通义千问)", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultProtocol: "openai-completions" },
  { value: "zhipu", label: "ZAI (智谱)", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultProtocol: "openai-completions" },
  { value: "moonshot", label: "Moonshot (月之暗面)", defaultBaseUrl: "https://api.moonshot.ai/v1", defaultProtocol: "openai-completions" },
  { value: "minimax", label: "MiniMax", defaultBaseUrl: "https://api.minimax.chat/v1", defaultProtocol: "openai-completions" },
  { value: "siliconflow", label: "SiliconFlow (硅基流动)", defaultBaseUrl: "https://api.siliconflow.cn/v1", defaultProtocol: "openai-completions" },
  { value: "google", label: "Google Gemini", defaultBaseUrl: "", defaultProtocol: "google-generative-ai" },
  { value: "bedrock", label: "AWS Bedrock", defaultBaseUrl: "", defaultProtocol: "bedrock-converse-stream" },
  { value: "ollama", label: "Ollama", defaultBaseUrl: "http://localhost:11434", defaultProtocol: "ollama" },
  { value: "openrouter", label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", defaultProtocol: "openai-completions" },
  { value: "custom", label: "Custom", defaultBaseUrl: "", defaultProtocol: "openai-completions" },
] as const;

const API_PROTOCOLS = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "ollama", label: "Ollama" },
] as const;

@customElement("tenant-models-view")
export class TenantModelsView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 1.5rem;
      color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    h3 { margin: 0 0 1rem; font-size: 0.95rem; font-weight: 600; }
    h4 { margin: 0.75rem 0 0.5rem; font-size: 0.85rem; font-weight: 600; color: var(--text-secondary, #a3a3a3); }
    .btn {
      padding: 0.45rem 0.9rem; border: none; border-radius: var(--radius-md, 6px);
      font-size: 0.85rem; cursor: pointer; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent, #3b82f6); color: white; }
    .btn-danger { background: var(--bg-destructive, #7f1d1d); color: var(--text-destructive, #fca5a5); }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
    .btn-outline { background: transparent; border: 1px solid var(--border, #262626); color: var(--text, #e5e5e5); }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 1rem;
    }
    .model-card {
      background: var(--card, #141414);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px);
      padding: 1.25rem;
    }
    .model-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 0.75rem; }
    .model-name { font-size: 0.95rem; font-weight: 600; }
    .model-provider { font-size: 0.75rem; color: var(--text-muted, #525252); margin-top: 0.15rem; }
    .model-meta { font-size: 0.8rem; color: var(--text-secondary, #a3a3a3); margin-bottom: 0.5rem; }
    .model-meta span { margin-right: 1rem; }
    .model-tags { display: flex; flex-wrap: wrap; gap: 0.3rem; margin-top: 0.5rem; }
    .model-tag {
      font-size: 0.72rem; padding: 0.15rem 0.5rem;
      background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626);
      border-radius: 999px; color: var(--text-secondary, #a3a3a3);
    }
    .model-tag.reasoning { border-color: #854d0e; color: #fbbf24; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.3rem; }
    .status-dot.active { background: #22c55e; }
    .status-dot.inactive { background: #525252; }
    .model-actions { display: flex; gap: 0.4rem; margin-top: 0.75rem; }
    .error-msg {
      background: var(--bg-destructive, #2d1215); border: 1px solid var(--border-destructive, #7f1d1d);
      border-radius: var(--radius-md, 6px); color: var(--text-destructive, #fca5a5);
      padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .success-msg {
      background: #052e16; border: 1px solid #166534; border-radius: var(--radius-md, 6px);
      color: #86efac; padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .form-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 1.25rem; margin-bottom: 1.5rem;
    }
    .form-row { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; }
    .form-field { flex: 1; }
    .form-field label { display: block; font-size: 0.8rem; margin-bottom: 0.3rem; color: var(--text-secondary, #a3a3a3); }
    .form-field input, .form-field textarea, .form-field select {
      width: 100%; padding: 0.45rem 0.65rem; background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626); border-radius: var(--radius-md, 6px);
      color: var(--text, #e5e5e5); font-size: 0.85rem; outline: none; box-sizing: border-box;
    }
    .form-field input:focus, .form-field select:focus { border-color: var(--accent, #3b82f6); }
    .form-hint { font-size: 0.72rem; color: var(--text-muted, #525252); margin-top: 0.25rem; }
    .empty { text-align: center; padding: 2rem; color: var(--text-muted, #525252); font-size: 0.85rem; }
    .loading { text-align: center; padding: 2rem; color: var(--text-muted, #525252); }
    .sub-models-table { width: 100%; border-collapse: collapse; font-size: 0.8rem; margin-top: 0.5rem; }
    .sub-models-table th, .sub-models-table td {
      text-align: left; padding: 0.4rem 0.5rem;
      border-bottom: 1px solid var(--border, #262626);
    }
    .sub-models-table th { color: var(--text-secondary, #a3a3a3); font-weight: 500; }
    .sub-model-form { background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626); border-radius: var(--radius-md, 6px); padding: 0.75rem; margin-top: 0.5rem; }
    .sub-model-row { display: flex; gap: 0.5rem; margin-bottom: 0.5rem; align-items: flex-end; }
    .sub-model-row .form-field { flex: 1; }
    .sub-model-row .form-field label { font-size: 0.72rem; }
    .sub-model-row .form-field input { font-size: 0.8rem; padding: 0.35rem 0.5rem; }
  `;

  private i18nController = new I18nController(this);

  @property({ type: String }) gatewayUrl = "";
  @state() private configs: TenantModelConfig[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";
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

  private showError(msg: string) {
    this.error = msg;
    this.success = "";
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.error = ""), 5000);
  }

  private showSuccess(msg: string) {
    this.success = msg;
    this.error = "";
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.success = ""), 5000);
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadConfigs();
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private async loadConfigs() {
    this.loading = true;
    this.error = "";
    try {
      const result = await this.rpc("tenant.models.list") as { models: TenantModelConfig[] };
      this.configs = result.models;
    } catch (err) {
      this.showError(err instanceof Error ? err.message : t("models.loadFailed"));
    } finally {
      this.loading = false;
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
    this.showModelForm = true;
  }

  private addModel() {
    if (!this.subModelId || !this.subModelName) return;
    if (this.formModels.some((m) => m.id === this.subModelId)) {
      this.showError(t("models.duplicateModelId"));
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
      },
    ];
    this.showModelForm = false;
  }

  private removeModel(idx: number) {
    this.formModels = this.formModels.filter((_, i) => i !== idx);
  }

  private async handleSave(e: Event) {
    e.preventDefault();
    if (!this.formProviderType || !this.formProviderName) return;
    if (this.formModels.length === 0) {
      this.showError(t("models.needOneModel"));
      return;
    }

    this.saving = true;
    this.error = "";
    this.success = "";

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
        this.showSuccess(t("models.configUpdated"));
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
        this.showSuccess(t("models.configCreated"));
      }
      this.showForm = false;
      await this.loadConfigs();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : t("models.saveFailed"));
    } finally {
      this.saving = false;
    }
  }

  private async handleDelete(config: TenantModelConfig) {
    if (!confirm(t("models.confirmDelete", { name: config.providerName }))) return;
    this.error = "";
    try {
      await this.rpc("tenant.models.delete", { id: config.id });
      this.showSuccess(t("models.configDeleted", { name: config.providerName }));
      await this.loadConfigs();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : t("models.deleteFailed"));
    }
  }

  private async handleToggle(config: TenantModelConfig) {
    try {
      await this.rpc("tenant.models.update", { id: config.id, isActive: !config.isActive });
      await this.loadConfigs();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : t("models.toggleFailed"));
    }
  }

  render() {
    return html`
      <div class="header">
        <h2>${t("models.title")}</h2>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-outline" @click=${() => this.loadConfigs()}>${t("models.refresh")}</button>
          <button class="btn btn-primary" @click=${() => this.showForm ? (this.showForm = false) : this.startCreate()}>
            ${this.showForm ? t("models.cancel") : t("models.addProvider")}
          </button>
        </div>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}
      ${this.success ? html`<div class="success-msg">${this.success}</div>` : nothing}

      ${this.showForm ? this.renderForm() : nothing}

      ${this.loading
        ? html`<div class="loading">${t("models.loading")}</div>`
        : this.configs.length === 0
          ? html`<div class="empty">${t("models.empty")}</div>`
          : html`
            <div class="card-grid">
              ${this.configs.map((c) => this.renderCard(c))}
            </div>
          `}
    `;
  }

  private renderCard(config: TenantModelConfig) {
    const providerLabel = PROVIDER_TYPES.find((p) => p.value === config.providerType)?.label ?? config.providerType;
    return html`
      <div class="model-card">
        <div class="model-card-header">
          <div>
            <div class="model-name">
              <span class="status-dot ${config.isActive ? "active" : "inactive"}"></span>
              ${config.providerName}
              ${!config.isActive ? html`<span style="font-size:0.7rem;padding:0.1rem 0.4rem;border-radius:4px;background:#2d1215;color:#fca5a5;margin-left:0.4rem">禁用</span>` : nothing}
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
            <span class="model-tag ${m.reasoning ? "reasoning" : ""}">${m.name} (${m.id})</span>
          `)}
        </div>
        <div class="model-actions">
          <button class="btn btn-outline btn-sm" @click=${() => this.startEdit(config)}>${t("models.edit")}</button>
          <button class="btn btn-outline btn-sm" @click=${() => this.handleToggle(config)}>
            ${config.isActive ? t("models.disable") : t("models.enable")}
          </button>
          <button class="btn btn-danger btn-sm" @click=${() => this.handleDelete(config)}>${t("models.delete")}</button>
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
              <input type="text" placeholder="https://api.openai.com/v1"
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
                <option value="oauth" ?selected=${this.formAuthMode === "oauth"}>OAuth</option>
                <option value="token" ?selected=${this.formAuthMode === "token"}>Token</option>
                <option value="none" ?selected=${this.formAuthMode === "none"}>${t("models.authNone")}</option>
              </select>
            </div>
            ${this.formAuthMode === "api-key" || this.formAuthMode === "token" ? html`
              <div class="form-field">
                <label>${t("models.apiKey")}${this.editingId ? t("models.apiKeyKeepHint") : ""}</label>
                <input type="password" placeholder="sk-..."
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
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${this.formModels.map((m, idx) => html`
                  <tr>
                    <td style="font-family:monospace">${m.id}</td>
                    <td>${m.name}</td>
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
                  <input type="text" required placeholder="gpt-4o"
                    .value=${this.subModelId}
                    @input=${(e: InputEvent) => (this.subModelId = (e.target as HTMLInputElement).value)} />
                </div>
                <div class="form-field">
                  <label>${t("models.displayName")}</label>
                  <input type="text" required placeholder="GPT-4o"
                    .value=${this.subModelName}
                    @input=${(e: InputEvent) => (this.subModelName = (e.target as HTMLInputElement).value)} />
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
