/**
 * Login / Register view for multi-tenant mode.
 *
 * Renders as a full-page overlay when the user is not authenticated.
 * Supports both login (existing account) and register (new tenant + owner).
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { login, register, type AuthState } from "../auth-store.ts";
import { loadSettings } from "../storage.ts";

type AuthMode = "login" | "register";

@customElement("openclaw-login")
export class OpenClawLogin extends LitElement {
  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg, #0a0a0a);
      color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
    }

    .login-container {
      width: 100%;
      max-width: 420px;
      padding: 2rem;
    }

    .login-card {
      background: var(--card, #141414);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px);
      padding: 2rem;
      box-shadow: var(--shadow-lg, 0 10px 30px rgba(0, 0, 0, 0.3));
    }

    .login-header {
      text-align: center;
      margin-bottom: 1.5rem;
    }

    .login-header img {
      width: 48px;
      height: 48px;
      margin-bottom: 0.75rem;
    }

    .login-header h1 {
      font-size: 1.25rem;
      font-weight: 600;
      margin: 0 0 0.25rem;
    }

    .login-header p {
      font-size: 0.85rem;
      color: var(--text-muted, #737373);
      margin: 0;
    }

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

    .form-group input {
      width: 100%;
      padding: 0.55rem 0.75rem;
      background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px);
      color: var(--text, #e5e5e5);
      font-size: 0.9rem;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }

    .form-group input:focus {
      border-color: var(--accent, #3b82f6);
    }

    .form-group input::placeholder {
      color: var(--text-muted, #525252);
    }

    .form-hint {
      font-size: 0.72rem;
      color: var(--text-muted, #525252);
      margin-top: 0.25rem;
    }

    .btn-primary {
      display: block;
      width: 100%;
      padding: 0.6rem;
      background: var(--accent, #3b82f6);
      color: white;
      border: none;
      border-radius: var(--radius-md, 6px);
      font-size: 0.9rem;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }

    .btn-primary:hover {
      opacity: 0.9;
    }

    .btn-primary:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .mode-switch {
      text-align: center;
      margin-top: 1rem;
      font-size: 0.8rem;
      color: var(--text-muted, #737373);
    }

    .mode-switch a {
      color: var(--accent, #3b82f6);
      cursor: pointer;
      text-decoration: none;
    }

    .mode-switch a:hover {
      text-decoration: underline;
    }

    .error-msg {
      background: var(--bg-destructive, #2d1215);
      border: 1px solid var(--border-destructive, #7f1d1d);
      border-radius: var(--radius-md, 6px);
      color: var(--text-destructive, #fca5a5);
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      margin-bottom: 1rem;
    }

    .divider {
      display: flex;
      align-items: center;
      margin: 1.25rem 0;
      font-size: 0.75rem;
      color: var(--text-muted, #525252);
    }

    .divider::before,
    .divider::after {
      content: "";
      flex: 1;
      border-top: 1px solid var(--border, #262626);
    }

    .divider span {
      padding: 0 0.75rem;
    }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private mode: AuthMode = "login";
  @state() private loading = false;
  @state() private error = "";

  // Login fields
  @state() private email = "";
  @state() private password = "";
  @state() private tenantSlug = "";

  // Register fields
  @state() private regTenantName = "";
  @state() private regTenantSlug = "";
  @state() private regEmail = "";
  @state() private regPassword = "";
  @state() private regDisplayName = "";

  private resolveGatewayUrl(): string {
    if (this.gatewayUrl) return this.gatewayUrl;
    const settings = loadSettings();
    return settings.gatewayUrl;
  }

  private async handleLogin(e: Event) {
    e.preventDefault();
    if (!this.email || !this.password) return;

    this.loading = true;
    this.error = "";

    try {
      const auth = await login({
        gatewayUrl: this.resolveGatewayUrl(),
        email: this.email,
        password: this.password,
        tenantSlug: this.tenantSlug || undefined,
      });
      this.dispatchEvent(new CustomEvent("auth-success", { detail: auth, bubbles: true, composed: true }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : "登录失败";
    } finally {
      this.loading = false;
    }
  }

  private async handleRegister(e: Event) {
    e.preventDefault();
    if (!this.regTenantName || !this.regTenantSlug || !this.regEmail || !this.regPassword) return;

    this.loading = true;
    this.error = "";

    try {
      const auth = await register({
        gatewayUrl: this.resolveGatewayUrl(),
        tenantName: this.regTenantName,
        tenantSlug: this.regTenantSlug,
        email: this.regEmail,
        password: this.regPassword,
        displayName: this.regDisplayName || undefined,
      });
      this.dispatchEvent(new CustomEvent("auth-success", { detail: auth, bubbles: true, composed: true }));
    } catch (err) {
      this.error = err instanceof Error ? err.message : "注册失败";
    } finally {
      this.loading = false;
    }
  }

  private switchMode(mode: AuthMode) {
    this.mode = mode;
    this.error = "";
  }

  private autoSlug() {
    if (!this.regTenantSlug && this.regTenantName) {
      this.regTenantSlug = this.regTenantName
        .replace(/[^a-zA-Z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);
    }
  }

  render() {
    return html`
      <div class="login-container">
        <div class="login-card">
          <div class="login-header">
            <img src="/favicon.svg" alt="OpenClaw" />
            <h1>${this.mode === "login" ? "登录 Enterprise Claw" : "注册 Enterprise Claw"}</h1>
            <p>${this.mode === "login" ? "使用您的企业账号登录" : "创建您的企业空间"}</p>
          </div>

          ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}

          ${this.mode === "login" ? this.renderLoginForm() : this.renderRegisterForm()}

          <div class="mode-switch">
            ${this.mode === "login"
              ? html`还没有账号？<a @click=${() => this.switchMode("register")}>注册 Enterprise Claw</a>`
              : html`已有账号？<a @click=${() => this.switchMode("login")}>返回登录</a>`}
          </div>
        </div>
      </div>
    `;
  }

  private renderLoginForm() {
    return html`
      <form @submit=${this.handleLogin}>
        <div class="form-group">
          <label>邮箱</label>
          <input
            type="email"
            placeholder="your@email.com"
            .value=${this.email}
            @input=${(e: InputEvent) => (this.email = (e.target as HTMLInputElement).value)}
            required
          />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input
            type="password"
            placeholder="输入密码"
            .value=${this.password}
            @input=${(e: InputEvent) => (this.password = (e.target as HTMLInputElement).value)}
            required
          />
        </div>
        <button class="btn-primary" type="submit" ?disabled=${this.loading}>
          ${this.loading ? "登录中..." : "登录"}
        </button>
      </form>
    `;
  }

  private renderRegisterForm() {
    return html`
      <form @submit=${this.handleRegister}>
        <div class="form-group">
          <label>企业名称</label>
          <input
            type="text"
            placeholder="我的公司"
            .value=${this.regTenantName}
            @input=${(e: InputEvent) => {
              this.regTenantName = (e.target as HTMLInputElement).value;
            }}
            @blur=${this.autoSlug}
            required
          />
        </div>
        <div class="form-group">
          <label>企业标识 (URL)</label>
          <input
            type="text"
            placeholder="my-company"
            .value=${this.regTenantSlug}
            @input=${(e: InputEvent) => {
              const raw = (e.target as HTMLInputElement).value;
              this.regTenantSlug = raw
                .replace(/[^a-zA-Z0-9-]/g, "")
                .slice(0, 128);
            }}
            pattern="[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]"
            required
          />
          <div class="form-hint">仅限大小写英文字母、数字和连字符</div>
        </div>

        <div class="divider"><span>管理员账号</span></div>

        <div class="form-group">
          <label>姓名</label>
          <input
            type="text"
            placeholder="张三"
            .value=${this.regDisplayName}
            @input=${(e: InputEvent) => (this.regDisplayName = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-group">
          <label>邮箱</label>
          <input
            type="email"
            placeholder="admin@company.com"
            .value=${this.regEmail}
            @input=${(e: InputEvent) => (this.regEmail = (e.target as HTMLInputElement).value)}
            required
          />
        </div>
        <div class="form-group">
          <label>密码</label>
          <input
            type="password"
            placeholder="至少 8 位"
            .value=${this.regPassword}
            @input=${(e: InputEvent) => (this.regPassword = (e.target as HTMLInputElement).value)}
            minlength="8"
            required
          />
        </div>
        <button class="btn-primary" type="submit" ?disabled=${this.loading}>
          ${this.loading ? "注册中..." : "创建企业空间"}
        </button>
      </form>
    `;
  }
}
