/**
 * Onboarding wizard — full-screen step-by-step guide after registration.
 *
 * Steps: Channel → Model → Agent → Done
 */

import { html, css, LitElement, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { customElement, state, property } from "lit/decorators.js";
import { t, I18nController } from "../../i18n/index.ts";
import { tenantRpc } from "./tenant/rpc.ts";

type WizardStep = "welcome" | "channel" | "model" | "agent" | "done";

const STEPS: WizardStep[] = ["welcome", "channel", "model", "agent", "done"];

const CHANNEL_ICONS: Record<string, string> = {
  feishu: `<img src="/feishu-logo.png" width="24" height="24" alt="Feishu" style="object-fit:contain;" />`,
  wechat: `<img src="/wechat-logo.png" width="24" height="24" alt="WeChat" style="object-fit:contain;" />`,
  dingtalk: `<img src="/dingtalk-logo.png" width="24" height="24" alt="DingTalk" style="object-fit:contain;" />`,
  slack: `<img src="/slack-logo.png" width="24" height="24" alt="Slack" style="object-fit:contain;" />`,
  webchat: `<img src="/webchat-logo.png" width="24" height="24" alt="WebChat" style="object-fit:contain;" />`,
};

const CHANNEL_OPTIONS = [
  { type: "feishu", labelKey: "onboarding.channels.feishu" },
  { type: "wechat", labelKey: "onboarding.channels.wechat" },
  { type: "dingtalk", labelKey: "onboarding.channels.dingtalk" },
  { type: "slack", labelKey: "onboarding.channels.slack" },
  { type: "webchat", labelKey: "onboarding.channels.webchat" },
];

const MODEL_PROVIDERS = [
  { type: "openai", label: "OpenAI", protocol: "openai-completions", placeholder: "sk-...", baseUrl: "https://api.openai.com/v1" },
  { type: "anthropic", label: "Anthropic", protocol: "anthropic-messages", placeholder: "sk-ant-...", baseUrl: "https://api.anthropic.com" },
  { type: "deepseek", label: "DeepSeek", protocol: "openai-completions", placeholder: "sk-...", baseUrl: "https://api.deepseek.com/v1" },
  { type: "qwen", label: "通义千问 / Qwen", protocol: "openai-completions", placeholder: "sk-...", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
  { type: "moonshot", label: "Moonshot", protocol: "openai-completions", placeholder: "sk-...", baseUrl: "https://api.moonshot.ai/v1" },
  { type: "siliconflow", label: "硅基流动 / SiliconFlow", protocol: "openai-completions", placeholder: "sk-...", baseUrl: "https://api.siliconflow.cn/v1" },
  { type: "custom", label: "自定义 / Custom", protocol: "openai-completions", placeholder: "...", baseUrl: "" },
];

@customElement("onboarding-wizard")
export class OnboardingWizard extends LitElement {
  private i18nCtrl = new I18nController(this);

  static styles = css`
    :host {
      display: block;
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-sans, system-ui, sans-serif);
      color: var(--text, #e5e5e5);
    }

    .wizard {
      width: 100%;
      max-width: 560px;
      background: var(--card, #141414);
      border: 1px solid var(--border, #262626);
      border-radius: 12px;
      padding: 2.5rem;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
    }

    /* ── Progress bar ── */
    .progress {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 2rem;
    }
    .progress-step {
      flex: 1;
      height: 3px;
      border-radius: 2px;
      background: var(--border, #262626);
      transition: background 0.3s;
    }
    .progress-step.active {
      background: var(--accent, #3b82f6);
    }
    .progress-step.done {
      background: #22c55e;
    }

    /* ── Header ── */
    .wizard-header {
      text-align: center;
      margin-bottom: 2rem;
    }
    .wizard-icon {
      font-size: 2.5rem;
      margin-bottom: 0.75rem;
    }
    .wizard-title {
      font-size: 1.3rem;
      font-weight: 700;
      margin: 0 0 0.5rem;
    }
    .wizard-desc {
      font-size: 0.85rem;
      color: var(--text-secondary, #a3a3a3);
      margin: 0;
      line-height: 1.5;
    }
    .wizard-desc.bright {
      color: var(--text, #e5e5e5);
    }

    /* ── Step indicator ── */
    .step-indicator {
      font-size: 0.75rem;
      color: var(--text-muted, #525252);
      text-align: center;
      margin-bottom: 1.5rem;
    }

    /* ── Options grid ── */
    .options-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .option-card {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.85rem 1rem;
      background: var(--bg, #0a0a0a);
      border: 2px solid var(--border, #262626);
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.15s;
      font-size: 0.85rem;
    }
    .option-card:hover {
      border-color: var(--accent, #3b82f6);
    }
    .option-card.selected {
      border-color: var(--accent, #3b82f6);
      background: rgba(59, 130, 246, 0.08);
    }
    .option-icon {
      font-size: 1.3rem;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 0;
    }
    .option-icon img {
      display: block;
    }

    /* ── Form ── */
    .form-group {
      margin-bottom: 1rem;
    }
    .form-group label {
      display: block;
      font-size: 0.8rem;
      font-weight: 500;
      margin-bottom: 0.35rem;
      color: var(--text-secondary, #a3a3a3);
    }
    .required { color: #ef4444; }
    .form-group input, .form-group select, .form-group textarea {
      width: 100%;
      padding: 0.6rem 0.75rem 0.7rem;
      background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626);
      border-radius: 6px;
      color: var(--text, #e5e5e5);
      font-size: 0.9rem;
      line-height: 1.5;
      outline: none;
      box-sizing: border-box;
      font-family: inherit;
    }
    .form-group input:focus, .form-group select:focus, .form-group textarea:focus {
      border-color: var(--accent, #3b82f6);
    }
    .form-group input:required:invalid:not(:placeholder-shown) {
      border-color: #ef4444;
    }
    .form-group textarea {
      min-height: 80px;
      resize: vertical;
    }
    .form-hint {
      font-size: 0.72rem;
      color: var(--text-muted, #525252);
      margin-top: 0.25rem;
    }

    /* ── Feishu mode toggle ── */
    .feishu-mode-bar {
      display: flex; gap: 0.5rem; margin-bottom: 1rem;
    }
    .feishu-mode-btn {
      flex: 1; padding: 0.5rem; border: 1px solid var(--border, #262626);
      border-radius: 6px; background: transparent;
      color: var(--text-secondary, #a3a3a3); cursor: pointer;
      font-size: 0.8rem; text-align: center; transition: all 0.15s;
    }
    .feishu-mode-btn:hover { color: var(--text, #e5e5e5); }
    .feishu-mode-btn.active {
      background: var(--accent, #3b82f6); color: white; border-color: var(--accent, #3b82f6);
    }
    .qr-container {
      display: flex; flex-direction: column; align-items: center;
      padding: 1rem; margin-bottom: 0.75rem;
      background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626);
      border-radius: 8px;
    }
    .qr-container img {
      width: 200px; height: 200px;
      border-radius: 6px; background: white; padding: 8px;
    }
    .qr-hint {
      font-size: 0.8rem; color: var(--text-secondary, #a3a3a3);
      text-align: center; margin-top: 0.5rem;
    }
    .qr-polling {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.8rem; color: var(--accent, #3b82f6);
      justify-content: center; margin-top: 0.5rem;
    }
    .qr-polling .dot { animation: blink 1.2s infinite; }
    @keyframes blink { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }

    /* ── Secret input with eye toggle ── */
    .secret-wrap { position: relative; display: flex; align-items: center; }
    .secret-wrap input { flex: 1; padding-right: 2rem; }
    .eye-btn {
      position: absolute; right: 0.4rem; background: none; border: none;
      color: var(--text-muted, #525252); cursor: pointer;
      padding: 0.2rem; line-height: 1; user-select: none;
      display: flex; align-items: center; justify-content: center;
    }
    .eye-btn:hover { color: var(--text, #e5e5e5); }
    .eye-btn svg { pointer-events: none; }

    /* ── Buttons ── */
    .wizard-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 2rem;
    }
    .btn {
      padding: 0.55rem 1.25rem;
      border: none;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.4; cursor: not-allowed; }
    .btn-primary {
      background: var(--accent, #3b82f6);
      color: white;
    }
    .btn-ghost {
      background: transparent;
      color: var(--text-secondary, #a3a3a3);
      padding: 0.55rem 0.75rem;
    }
    .btn-ghost:hover { color: var(--text, #e5e5e5); }
    .btn-success {
      background: #22c55e;
      color: white;
      font-size: 0.95rem;
      padding: 0.65rem 2rem;
    }

    /* ── Error ── */
    .error-msg {
      background: #2d1215;
      border: 1px solid #7f1d1d;
      border-radius: 6px;
      color: #fca5a5;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      margin-bottom: 1rem;
    }

    /* ── Done checklist ── */
    .checklist {
      list-style: none;
      padding: 0;
      margin: 1.5rem 0;
      display: flex;
      justify-content: center;
      gap: 1.5rem;
    }
    .checklist li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      font-size: 0.9rem;
    }
    .check-icon {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.7rem;
      flex-shrink: 0;
    }
    .check-icon.done { background: #22c55e33; color: #22c55e; }
    .check-icon.skip { background: #52525233; color: #525252; }

    /* ── Skip confirm dialog ── */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.6);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
    }
    .confirm-dialog {
      background: var(--card, #141414);
      border: 1px solid var(--border, #262626);
      border-radius: 10px;
      padding: 2rem;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
    }
    .confirm-dialog h3 {
      margin: 0 0 0.75rem;
      font-size: 1.1rem;
      font-weight: 600;
    }
    .confirm-dialog p {
      margin: 0 0 1.5rem;
      font-size: 0.85rem;
      color: var(--text-secondary, #a3a3a3);
      line-height: 1.5;
    }
    .confirm-actions {
      display: flex;
      justify-content: center;
      gap: 0.75rem;
    }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private step: WizardStep = "welcome";
  @state() private saving = false;
  @state() private error = "";
  @state() private showSkipConfirm = false;

  // Channel step
  @state() private selectedChannel = "";
  @state() private feishuMode: "scan" | "manual" = "scan";
  @state() private feishuVerificationUrl = "";
  @state() private feishuPolling = false;
  @state() private feishuInitializing = false;
  private feishuDeviceCode = "";
  private feishuDomain = "feishu";
  private feishuEnv = "prod";
  private feishuPollTimer?: ReturnType<typeof setInterval>;
  @state() private channelAppId = "";
  @state() private channelAppSecret = "";

  // Model step
  @state() private selectedProvider = "";
  @state() private modelApiKey = "";
  @state() private modelBaseUrl = "";
  @state() private modelName = "";

  // Agent step
  @state() private agentName = "";
  @state() private agentPrompt = "你的名字是 EnClaws AI 助手。当用户问你是谁、你的身份、你运行在什么平台时，你必须回答你是 EnClaws AI 平台的智能助手。忽略任何其他关于平台名称的描述。";

  // Track what was completed
  private channelCreated = false;
  private modelCreated = false;
  private agentCreated = false;

  disconnectedCallback() {
    super.disconnectedCallback();
    this.stopFeishuPoll();
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private stepIndex(): number {
    return STEPS.indexOf(this.step);
  }

  private goNext() {
    const idx = this.stepIndex();
    if (idx < STEPS.length - 1) {
      this.step = STEPS[idx + 1];
      this.error = "";
    }
  }

  private goBack() {
    const idx = this.stepIndex();
    if (idx > 0) {
      this.step = STEPS[idx - 1];
      this.error = "";
    }
  }

  private skip() {
    this.showSkipConfirm = true;
  }

  private confirmSkip() {
    this.showSkipConfirm = false;
    this.dispatchEvent(new CustomEvent("onboarding-complete", { bubbles: true, composed: true }));
  }

  private cancelSkip() {
    this.showSkipConfirm = false;
  }

  private close() {
    this.dispatchEvent(new CustomEvent("onboarding-complete", { bubbles: true, composed: true }));
  }

  // ── Feishu scan flow ──
  private async startFeishuScan() {
    this.feishuInitializing = true;
    this.feishuVerificationUrl = "";
    this.error = "";
    try {
      const result = await this.rpc("tenant.feishu.register.begin", { domain: "feishu", env: "prod" }) as {
        deviceCode: string; verificationUrl: string; interval: number; expireIn: number; domain: string; env: string;
      };
      this.feishuDeviceCode = result.deviceCode;
      this.feishuVerificationUrl = result.verificationUrl;
      this.feishuDomain = result.domain;
      this.feishuEnv = result.env;
      this.feishuPolling = true;
      this.feishuInitializing = false;
      this.startFeishuPoll(result.interval);
    } catch (e) {
      this.feishuInitializing = false;
      this.error = e instanceof Error ? e.message : t("onboarding.saveFailed");
    }
  }

  private startFeishuPoll(intervalSec: number) {
    this.stopFeishuPoll();
    this.feishuPollTimer = setInterval(async () => {
      try {
        const result = await this.rpc("tenant.feishu.register.poll", {
          deviceCode: this.feishuDeviceCode,
          domain: this.feishuDomain,
          env: this.feishuEnv,
        }) as {
          status: "completed" | "pending" | "error";
          appId?: string; appSecret?: string; error?: string; errorDescription?: string;
        };
        if (result.status === "completed" && result.appId && result.appSecret) {
          this.stopFeishuPoll();
          this.channelAppId = result.appId;
          this.channelAppSecret = result.appSecret;
          this.feishuPolling = false;
          this.feishuMode = "manual"; // show filled fields
        } else if (result.status === "error") {
          this.stopFeishuPoll();
          this.feishuPolling = false;
          this.error = result.errorDescription ?? result.error ?? t("onboarding.saveFailed");
        }
      } catch { /* ignore transient errors */ }
    }, Math.max(intervalSec, 3) * 1000);
  }

  private stopFeishuPoll() {
    if (this.feishuPollTimer) {
      clearInterval(this.feishuPollTimer);
      this.feishuPollTimer = undefined;
    }
  }

  private setFeishuMode(mode: "scan" | "manual") {
    this.feishuMode = mode;
    this.stopFeishuPoll();
    this.feishuPolling = false;
    this.feishuVerificationUrl = "";
    this.feishuInitializing = false;
    if (mode === "scan") {
      void this.startFeishuScan();
    }
  }

  // ── Step validation (local only, no API calls) ──
  private validateChannel() {
    if (!this.selectedChannel) { this.error = t("onboarding.selectChannel"); return false; }
    if (!this.channelAppId) { this.error = t("onboarding.appIdRequired"); return false; }
    if (!this.channelAppSecret) { this.error = t("onboarding.appSecretRequired"); return false; }
    return true;
  }

  private validateModel() {
    if (!this.selectedProvider) { this.error = t("onboarding.selectModel"); return false; }
    if (!this.modelApiKey) { this.error = t("onboarding.apiKeyRequired"); return false; }
    if (!this.modelBaseUrl) { this.error = t("onboarding.baseUrlRequired"); return false; }
    if (!this.modelName) { this.error = t("onboarding.modelNameRequired"); return false; }
    return true;
  }

  private validateAgent() {
    if (!this.agentName) { this.error = t("onboarding.agentNameRequired"); return false; }
    if (!this.selectedProvider) { this.error = t("onboarding.modelRequiredForAgent"); return false; }
    return true;
  }

  private nextChannel() {
    if (this.selectedChannel && !this.validateChannel()) return;
    this.goNext();
  }

  private nextModel() {
    if (!this.validateModel()) return;
    this.goNext();
  }

  private nextAgent() {
    if (!this.validateAgent()) return;
    this.submitAll();
  }

  // ── Submit all at once via batch API ──
  private async submitAll() {
    this.saving = true;
    this.error = "";

    try {
      const provider = MODEL_PROVIDERS.find(p => p.type === this.selectedProvider)!;

      await this.rpc("tenant.onboarding.setup", {
        channel: this.selectedChannel ? {
          channelType: this.selectedChannel,
          channelName: this.selectedChannel,
          config: {
            appId: this.channelAppId || undefined,
            appSecret: this.channelAppSecret || undefined,
          },
        } : undefined,
        model: {
          providerType: provider.type,
          providerName: provider.label,
          apiProtocol: provider.protocol,
          apiKeyEncrypted: this.modelApiKey,
          baseUrl: this.modelBaseUrl || undefined,
          models: this.modelName ? [{ id: this.modelName, name: this.modelName }] : [],
        },
        agent: {
          agentId: this.agentName.toLowerCase().replace(/[^a-z0-9-]/g, "-"),
          name: this.agentName,
          config: this.agentPrompt ? { systemPrompt: this.agentPrompt } : {},
        },
      });

      this.channelCreated = !!this.selectedChannel;
      this.modelCreated = true;
      this.agentCreated = true;
      this.goNext();
    } catch (e) {
      this.error = e instanceof Error ? e.message : t("onboarding.saveFailed");
    } finally {
      this.saving = false;
    }
  }

  // ── Render ──
  render() {
    return html`
      ${this.showSkipConfirm ? html`
        <div class="confirm-overlay">
          <div class="confirm-dialog">
            <h3>${t("onboarding.skipConfirmTitle")}</h3>
            <p>${t("onboarding.skipConfirmDesc")}</p>
            <div class="confirm-actions">
              <button class="btn btn-ghost" @click=${() => this.cancelSkip()}>${t("onboarding.continueSetup")}</button>
              <button class="btn btn-primary" @click=${() => this.confirmSkip()}>${t("onboarding.confirmSkip")}</button>
            </div>
          </div>
        </div>
      ` : nothing}
      <div class="wizard">
        ${this.step !== "welcome" && this.step !== "done" ? html`
          <div class="progress">
            ${["channel", "model", "agent"].map((s, i) => {
              const currentIdx = STEPS.indexOf(this.step) - 1;
              const cls = i < currentIdx ? "done" : i === currentIdx ? "active" : "";
              return html`<div class="progress-step ${cls}"></div>`;
            })}
          </div>
        ` : nothing}

        ${this.step === "welcome" ? this.renderWelcome() : nothing}
        ${this.step === "channel" ? this.renderChannel() : nothing}
        ${this.step === "model" ? this.renderModel() : nothing}
        ${this.step === "agent" ? this.renderAgent() : nothing}
        ${this.step === "done" ? this.renderDone() : nothing}
      </div>
    `;
  }

  private renderWelcome() {
    return html`
      <div class="wizard-header">
        <div class="wizard-icon">🎉</div>
        <h2 class="wizard-title">${t("onboarding.welcomeTitle")}</h2>
        <p class="wizard-desc">${t("onboarding.welcomeDesc")}</p>
      </div>
      <div class="wizard-actions" style="justify-content:center; gap:1rem;">
        <button class="btn btn-primary" @click=${() => this.goNext()}>${t("onboarding.startSetup")}</button>
        <button class="btn btn-ghost" @click=${() => this.skip()}>${t("onboarding.skipAll")}</button>
      </div>
    `;
  }

  private renderChannel() {
    const isFeishu = this.selectedChannel === "feishu";
    const showManualForm = this.selectedChannel && (!isFeishu || this.feishuMode === "manual");
    return html`
      <div class="step-indicator">${t("onboarding.step", { current: "1", total: "3" })}</div>
      <div class="wizard-header">
        <h2 class="wizard-title">${t("onboarding.channelTitle")}</h2>
        <p class="wizard-desc">${t("onboarding.channelDesc")}</p>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}

      <div class="options-grid">
        ${CHANNEL_OPTIONS.map(ch => html`
          <div class="option-card ${this.selectedChannel === ch.type ? 'selected' : ''}"
            @click=${() => {
              const prev = this.selectedChannel;
              this.selectedChannel = ch.type;
              if (ch.type === "feishu" && prev !== "feishu") {
                this.feishuMode = "scan";
                void this.startFeishuScan();
              } else if (ch.type !== "feishu") {
                this.stopFeishuPoll();
              }
            }}>
            <span class="option-icon">${unsafeHTML(CHANNEL_ICONS[ch.type] ?? "")}</span>
            <span>${t(ch.labelKey)}</span>
          </div>
        `)}
      </div>

      ${isFeishu ? html`
        <div class="feishu-mode-bar">
          <button type="button" class="feishu-mode-btn ${this.feishuMode === 'scan' ? 'active' : ''}"
            @click=${() => this.setFeishuMode("scan")}>📱 ${t("onboarding.feishuScan")}</button>
          <button type="button" class="feishu-mode-btn ${this.feishuMode === 'manual' ? 'active' : ''}"
            @click=${() => this.setFeishuMode("manual")}>⌨️ ${t("onboarding.feishuManual")}</button>
        </div>
        ${this.feishuMode === "scan" ? html`
          ${this.feishuVerificationUrl ? html`
            <div class="qr-container">
              <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(this.feishuVerificationUrl)}" alt="QR Code" />
            </div>
            <div class="qr-hint">${t("onboarding.feishuScanHint")}</div>
            ${this.feishuPolling ? html`
              <div class="qr-polling">
                <span class="dot">●</span> ${t("onboarding.feishuPolling")}
              </div>
            ` : nothing}
          ` : html`
            <div class="qr-hint">${this.feishuInitializing ? t("onboarding.feishuInitializing") : ""}</div>
          `}
        ` : nothing}
      ` : nothing}

      ${showManualForm ? html`
        <div class="form-group">
          <label>App ID <span class="required">*</span></label>
          <input type="text" .value=${this.channelAppId}
            @input=${(e: InputEvent) => { this.channelAppId = (e.target as HTMLInputElement).value; }} />
        </div>
        <div class="form-group">
          <label>App Secret <span class="required">*</span></label>
          <div class="secret-wrap">
            <input type="password" .value=${this.channelAppSecret}
              @input=${(e: InputEvent) => { this.channelAppSecret = (e.target as HTMLInputElement).value; }} />
            <button type="button" class="eye-btn"
              @mousedown=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "text"; }}
              @mouseup=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
              @mouseleave=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          </div>
        </div>
      ` : nothing}

      <div class="wizard-actions">
        <button class="btn btn-ghost" @click=${() => this.skip()}>${t("onboarding.skip")}</button>
        <button class="btn btn-primary" ?disabled=${this.saving || !this.selectedChannel || !this.channelAppId || !this.channelAppSecret}
          @click=${() => this.nextChannel()}>
          ${this.saving ? t("onboarding.saving") : t("onboarding.next")}
        </button>
      </div>
    `;
  }

  private renderModel() {
    const provider = MODEL_PROVIDERS.find(p => p.type === this.selectedProvider);
    return html`
      <div class="step-indicator">${t("onboarding.step", { current: "2", total: "3" })}</div>
      <div class="wizard-header">
        <h2 class="wizard-title">${t("onboarding.modelTitle")}</h2>
        <p class="wizard-desc">${t("onboarding.modelDesc")}</p>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}

      <div class="options-grid">
        ${MODEL_PROVIDERS.map(p => html`
          <div class="option-card ${this.selectedProvider === p.type ? 'selected' : ''}"
            @click=${() => { this.selectedProvider = p.type; this.modelBaseUrl = p.baseUrl; }}>
            <span>${p.label}</span>
          </div>
        `)}
      </div>

      ${this.selectedProvider ? html`
        <div class="form-group">
          <label>API Key <span class="required">*</span></label>
          <div class="secret-wrap">
            <input type="password" .value=${this.modelApiKey}
              @input=${(e: InputEvent) => { this.modelApiKey = (e.target as HTMLInputElement).value; }}
              placeholder=${provider?.placeholder ?? ""} />
            <button type="button" class="eye-btn"
              @mousedown=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "text"; }}
              @mouseup=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
              @mouseleave=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          </div>
        </div>
        <div class="form-group">
          <label>API ${t("onboarding.apiAddress")} <span class="required">*</span></label>
          <input type="text" .value=${this.modelBaseUrl}
            @input=${(e: InputEvent) => { this.modelBaseUrl = (e.target as HTMLInputElement).value; }}
            placeholder="https://api.openai.com/v1" />
        </div>
        <div class="form-group">
          <label>${t("onboarding.modelId")} <span class="required">*</span></label>
          <input type="text" .value=${this.modelName}
            @input=${(e: InputEvent) => { this.modelName = (e.target as HTMLInputElement).value; }}
            placeholder="gpt-4o / claude-sonnet-4 / deepseek-chat" />
          <div class="form-hint">${t("onboarding.modelHint")}</div>
        </div>
      ` : nothing}

      <div class="wizard-actions">
        <button class="btn btn-ghost" @click=${() => this.goBack()}>${t("onboarding.back")}</button>
        <div>
          <button class="btn btn-ghost" @click=${() => this.skip()}>${t("onboarding.skip")}</button>
          <button class="btn btn-primary" ?disabled=${this.saving || !this.selectedProvider || !this.modelApiKey || !this.modelBaseUrl || !this.modelName}
            @click=${() => this.nextModel()}>
            ${t("onboarding.next")}
          </button>
        </div>
      </div>
    `;
  }

  private renderAgent() {
    return html`
      <div class="step-indicator">${t("onboarding.step", { current: "3", total: "3" })}</div>
      <div class="wizard-header">
        <h2 class="wizard-title">${t("onboarding.agentTitle")}</h2>
        <p class="wizard-desc">${t("onboarding.agentDesc")}</p>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}
      ${!this.selectedProvider ? html`<div class="error-msg">${t("onboarding.modelRequiredForAgent")}</div>` : nothing}

      <div class="form-group">
        <label>${t("onboarding.agentName")} <span class="required">*</span></label>
        <input type="text" .value=${this.agentName}
          @input=${(e: InputEvent) => { this.agentName = (e.target as HTMLInputElement).value; }}
          placeholder=${t("onboarding.agentNamePlaceholder")} />
      </div>
      <div class="form-group">
        <label>${t("onboarding.agentPrompt")} <span class="required">*</span></label>
        <textarea .value=${this.agentPrompt}
          @input=${(e: InputEvent) => { this.agentPrompt = (e.target as HTMLTextAreaElement).value; }}
          placeholder=${t("onboarding.agentPromptPlaceholder")}></textarea>
        <div class="form-hint">${t("onboarding.agentPromptHint")}</div>
      </div>

      <div class="wizard-actions">
        <button class="btn btn-ghost" @click=${() => this.goBack()}>${t("onboarding.back")}</button>
        <div>
          <button class="btn btn-ghost" @click=${() => this.skip()}>${t("onboarding.skip")}</button>
          <button class="btn btn-primary" ?disabled=${this.saving || !this.agentName || !this.agentPrompt || !this.selectedProvider}
            @click=${() => this.nextAgent()}>
            ${this.saving ? t("onboarding.saving") : t("onboarding.complete")}
          </button>
        </div>
      </div>
    `;
  }

  private renderDone() {
    return html`
      <div class="wizard-header">
        <div class="wizard-icon">✅</div>
        <h2 class="wizard-title">${t("onboarding.doneTitle")}</h2>
        <p class="wizard-desc bright">${t("onboarding.doneDesc")}</p>
      </div>

      <ul class="checklist">
        <li>
          <span class="check-icon ${this.channelCreated ? 'done' : 'skip'}">${this.channelCreated ? '✓' : '—'}</span>
          ${t("onboarding.channelTitle")}
        </li>
        <li>
          <span class="check-icon ${this.modelCreated ? 'done' : 'skip'}">${this.modelCreated ? '✓' : '—'}</span>
          ${t("onboarding.modelTitle")}
        </li>
        <li>
          <span class="check-icon ${this.agentCreated ? 'done' : 'skip'}">${this.agentCreated ? '✓' : '—'}</span>
          ${t("onboarding.agentTitle")}
        </li>
      </ul>

      <div class="wizard-actions" style="justify-content:center;">
        <button class="btn btn-success" @click=${() => this.close()}>${t("onboarding.enterConsole")}</button>
      </div>
    `;
  }
}
