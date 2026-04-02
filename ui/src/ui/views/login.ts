/**
 * Login / Register view for multi-tenant mode.
 *
 * Renders as a full-page overlay when the user is not authenticated.
 * Supports both login (existing account) and register (new tenant + owner).
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { login, register, type AuthState } from "../auth-store.ts";
import { loadSettings, saveSettings } from "../storage.ts";
import { t, i18n, I18nController, SUPPORTED_LOCALES } from "../../i18n/index.ts";
import type { Locale } from "../../i18n/index.ts";
import type { ThemeMode } from "../theme.ts";
import { resolveTheme } from "../theme.ts";
import "../components/language-switcher.ts";

type AuthMode = "login" | "register";

/** Per-field error map. Keys are field identifiers, values are i18n error strings. */
type FieldErrors = Record<string, string>;

@customElement("enclaws-login")
export class EnClawsLogin extends LitElement {
  private i18nCtrl = new I18nController(this);

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: var(--bg, #0a0a0a);
      color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
      position: relative;
    }

    .top-toolbar {
      position: fixed;
      top: 1rem;
      right: 1rem;
      z-index: 200;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .lang-switcher {
      --text-color: var(--text, #e5e5e5);
      --surface-1: var(--card, #141414);
      --surface-2: rgba(255, 255, 255, 0.08);
      --border-color: var(--border, #262626);
      --primary-color: var(--accent, #3b82f6);
    }

    .theme-toggle {
      --theme-item: 28px;
      --theme-gap: 2px;
      --theme-pad: 4px;
      position: relative;
    }
    .theme-toggle__track {
      position: relative;
      display: grid;
      grid-template-columns: repeat(3, var(--theme-item));
      gap: var(--theme-gap);
      padding: var(--theme-pad);
      border-radius: 9999px;
      border: 1px solid var(--border, #262626);
      background: var(--secondary, #1a1a1a);
    }
    .theme-toggle__indicator {
      position: absolute;
      top: 50%;
      left: var(--theme-pad);
      width: var(--theme-item);
      height: var(--theme-item);
      border-radius: 9999px;
      transform: translateY(-50%) translateX(calc(var(--theme-index, 0) * (var(--theme-item) + var(--theme-gap))));
      background: var(--accent, #3b82f6);
      transition: transform 0.2s ease-out;
      z-index: 0;
    }
    .theme-toggle__button {
      height: var(--theme-item);
      width: var(--theme-item);
      display: grid;
      place-items: center;
      border: 0;
      border-radius: 9999px;
      background: transparent;
      color: var(--muted, #525252);
      cursor: pointer;
      position: relative;
      z-index: 1;
      transition: color 0.15s ease;
    }
    .theme-toggle__button:hover {
      color: var(--text, #e5e5e5);
    }
    .theme-toggle__button.active {
      color: var(--accent-foreground, #fff);
    }
    .theme-toggle__button.active .theme-icon {
      stroke: var(--accent-foreground, #fff);
    }
    .theme-icon {
      width: 14px;
      height: 14px;
      stroke: currentColor;
      fill: none;
      stroke-width: 1.5px;
      stroke-linecap: round;
      stroke-linejoin: round;
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

    .form-group input.has-error {
      border-color: var(--text-destructive, #ef4444);
    }

    .form-group input::placeholder {
      color: var(--text-muted, #525252);
    }

    .form-hint {
      font-size: 0.72rem;
      color: var(--text-hint, #8a8a8a);
      margin-top: 0.25rem;
    }

    .field-error {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      margin-top: 0.3rem;
      font-size: 0.75rem;
      color: var(--text-destructive, #ef4444);
    }

    .field-error svg {
      flex-shrink: 0;
      width: 14px;
      height: 14px;
    }

    .form-error {
      margin-bottom: 0.75rem;
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
  @state() private currentTheme: ThemeMode = loadSettings().theme ?? "system";
  /** Stores the raw server error message; translated at render time. */
  @state() private serverError = "";
  @state() private fieldErrors: FieldErrors = {};

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

  // Focus tracking for inline hints
  @state() private slugFocused = false;
  @state() private regPasswordFocused = false;

  private handleLocaleChange(e: CustomEvent<{ locale: string }>) {
    const loc = e.detail.locale;
    if (SUPPORTED_LOCALES.includes(loc as Locale)) {
      void i18n.setLocale(loc as Locale).then(() => {
        if (Object.keys(this.fieldErrors).length > 0) {
          this.fieldErrors = this.mode === "login" ? this.validateLoginForm() : this.validateRegisterForm();
        }
      });
      const settings = loadSettings();
      saveSettings({ ...settings, locale: loc });
    }
  }

  /** Map raw server error to i18n at render time so language switches take effect. */
  private translateServerError(raw: string): string {
    if (raw.includes("Invalid credentials")) return t("login.invalidCredentials");
    if (raw.includes("slug already in use")) return t("login.slugAlreadyInUse");
    if (raw.includes("已注册") || raw.includes("already registered") || raw.includes("duplicate key") || raw.includes("unique constraint")) return t("login.emailAlreadyRegistered");
    return raw;
  }

  private resolveGatewayUrl(): string {
    if (this.gatewayUrl) return this.gatewayUrl;
    const settings = loadSettings();
    return settings.gatewayUrl;
  }

  private validateEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  private validatePasswordStrength(pw: string): boolean {
    return pw.length >= 8 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^a-zA-Z0-9]/.test(pw);
  }

  private validateLoginForm(): FieldErrors {
    const errors: FieldErrors = {};
    if (!this.email) errors.email = t("login.errRequired", { field: t("login.email") });
    else if (!this.validateEmail(this.email)) errors.email = t("login.errEmailInvalid");
    if (!this.password) errors.password = t("login.errRequired", { field: t("login.password") });
    return errors;
  }

  private validateRegisterForm(): FieldErrors {
    const errors: FieldErrors = {};
    if (!this.regTenantName) errors.tenantName = t("login.errRequired", { field: t("login.tenantName") });
    if (!this.regTenantSlug) errors.tenantSlug = t("login.errRequired", { field: t("login.tenantSlug") });
    else if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*[a-zA-Z0-9]$/.test(this.regTenantSlug)) errors.tenantSlug = t("login.errSlugInvalid");
    if (!this.regEmail) errors.regEmail = t("login.errRequired", { field: t("login.email") });
    else if (!this.validateEmail(this.regEmail)) errors.regEmail = t("login.errEmailInvalid");
    if (!this.regPassword) errors.regPassword = t("login.errRequired", { field: t("login.password") });
    else if (!this.validatePasswordStrength(this.regPassword)) errors.regPassword = t("login.errPasswordWeak");
    return errors;
  }

  private renderFieldError(field: string) {
    const msg = this.fieldErrors[field];
    if (!msg) return nothing;
    return html`
      <div class="field-error">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 4.5a.75.75 0 0 1 1.5 0v3.25a.75.75 0 0 1-1.5 0V4.5ZM8 11.5A.875.875 0 1 1 8 9.75a.875.875 0 0 1 0 1.75Z"/>
        </svg>
        <span>${msg}</span>
      </div>
    `;
  }

  private renderFormError(msg: string) {
    return html`
      <div class="field-error form-error">
        <svg viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1ZM7.25 4.5a.75.75 0 0 1 1.5 0v3.25a.75.75 0 0 1-1.5 0V4.5ZM8 11.5A.875.875 0 1 1 8 9.75a.875.875 0 0 1 0 1.75Z"/>
        </svg>
        <span>${msg}</span>
      </div>
    `;
  }

  private hasError(field: string): boolean {
    return !!this.fieldErrors[field];
  }

  private clearFieldError(field: string) {
    if (this.fieldErrors[field]) {
      const next = { ...this.fieldErrors };
      delete next[field];
      this.fieldErrors = next;
    }
    if (this.serverError) this.serverError = "";
  }

  private async handleLogin(e: Event) {
    e.preventDefault();
    this.fieldErrors = {};
    this.serverError = "";

    const errors = this.validateLoginForm();
    if (Object.keys(errors).length > 0) {
      this.fieldErrors = errors;
      return;
    }

    this.loading = true;

    try {
      const auth = await login({
        gatewayUrl: this.resolveGatewayUrl(),
        email: this.email,
        password: this.password,
        tenantSlug: this.tenantSlug || undefined,
      });
      this.dispatchEvent(new CustomEvent("auth-success", { detail: auth, bubbles: true, composed: true }));
    } catch (err) {
      this.serverError = err instanceof Error ? err.message : t("login.loginFailed");
    } finally {
      this.loading = false;
    }
  }

  private async handleRegister(e: Event) {
    e.preventDefault();
    this.fieldErrors = {};
    this.serverError = "";

    const errors = this.validateRegisterForm();
    if (Object.keys(errors).length > 0) {
      this.fieldErrors = errors;
      return;
    }

    this.loading = true;

    try {
      const auth = await register({
        gatewayUrl: this.resolveGatewayUrl(),
        tenantName: this.regTenantName,
        tenantSlug: this.regTenantSlug,
        email: this.regEmail,
        password: this.regPassword,
        displayName: this.regDisplayName || undefined,
      });
      this.dispatchEvent(new CustomEvent("auth-success", { detail: { ...auth, isNewRegistration: true }, bubbles: true, composed: true }));
    } catch (err) {
      this.serverError = err instanceof Error ? err.message : "register_failed";
    } finally {
      this.loading = false;
    }
  }

  private switchMode(mode: AuthMode) {
    this.mode = mode;
    this.serverError = "";
    this.fieldErrors = {};
    this.email = "";
    this.password = "";
    this.tenantSlug = "";
    this.regTenantName = "";
    this.regTenantSlug = "";
    this.regEmail = "";
    this.regPassword = "";
    this.regDisplayName = "";
  }

  private applyTheme(next: ThemeMode, _e?: MouseEvent) {
    this.currentTheme = next;
    const settings = loadSettings();
    saveSettings({ ...settings, theme: next });
    const resolved = resolveTheme(next);
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
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
      <div class="top-toolbar">
        <div class="lang-switcher">
          <language-switcher
            .locale=${i18n.getLocale()}
            @locale-change=${this.handleLocaleChange}
          ></language-switcher>
        </div>
        <div class="theme-toggle" style="--theme-index: ${Math.max(0, ["system", "light", "dark"].indexOf(this.currentTheme))};">
          <div class="theme-toggle__track" role="group" aria-label="Theme">
            <span class="theme-toggle__indicator"></span>
            <button class="theme-toggle__button ${this.currentTheme === "system" ? "active" : ""}"
              @click=${(e: MouseEvent) => this.applyTheme("system", e)} aria-label="System" title="System">
              <svg class="theme-icon" viewBox="0 0 24 24"><rect width="20" height="14" x="2" y="3" rx="2"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
            </button>
            <button class="theme-toggle__button ${this.currentTheme === "light" ? "active" : ""}"
              @click=${(e: MouseEvent) => this.applyTheme("light", e)} aria-label="Light" title="Light">
              <svg class="theme-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
            </button>
            <button class="theme-toggle__button ${this.currentTheme === "dark" ? "active" : ""}"
              @click=${(e: MouseEvent) => this.applyTheme("dark", e)} aria-label="Dark" title="Dark">
              <svg class="theme-icon" viewBox="0 0 24 24"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>
            </button>
          </div>
        </div>
      </div>
      <div class="login-container">
        <div class="login-card">
          <div class="login-header">
            <img src="/favicon.svg" alt="EnClaws" />
            <h1>${this.mode === "login" ? t("login.title") : t("login.titleRegister")}</h1>
            <p>${this.mode === "login" ? t("login.subtitle") : t("login.subtitleRegister")}</p>
          </div>

          ${this.mode === "login" ? this.renderLoginForm() : this.renderRegisterForm()}

          <div class="mode-switch">
            ${this.mode === "login"
              ? html`${t("login.noAccount")}<a @click=${() => this.switchMode("register")}>${t("login.registerLink")}</a>`
              : html`${t("login.hasAccount")}<a @click=${() => this.switchMode("login")}>${t("login.backToLogin")}</a>`}
          </div>
        </div>
      </div>
    `;
  }

  private renderLoginForm() {
    return html`
      <form @submit=${this.handleLogin} novalidate>
        <div class="form-group">
          <label>${t("login.email")}</label>
          <input
            type="email"
            class=${this.hasError("email") ? "has-error" : ""}
            placeholder=${t("login.emailPlaceholder")}
            .value=${this.email}
            @input=${(e: InputEvent) => { this.email = (e.target as HTMLInputElement).value; this.clearFieldError("email"); }}
          />
          ${this.renderFieldError("email")}
        </div>
        <div class="form-group">
          <label>${t("login.password")}</label>
          <div class="secret-wrap">
            <input
              type="password"
              class=${this.hasError("password") ? "has-error" : ""}
              placeholder=${t("login.passwordPlaceholder")}
              .value=${this.password}
              @input=${(e: InputEvent) => { this.password = (e.target as HTMLInputElement).value; this.clearFieldError("password"); }}
            />
            <button type="button" class="eye-btn"
              @mousedown=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "text"; }}
              @mouseup=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
              @mouseleave=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          </div>
          ${this.renderFieldError("password")}
        </div>
        ${this.serverError ? this.renderFormError(this.translateServerError(this.serverError)) : nothing}
        <button class="btn-primary" type="submit" ?disabled=${this.loading}>
          ${this.loading ? t("login.loggingIn") : t("login.loginBtn")}
        </button>
      </form>
    `;
  }

  private renderRegisterForm() {
    return html`
      <form @submit=${this.handleRegister} novalidate>
        <div class="form-group">
          <label>${t("login.tenantName")}</label>
          <input
            type="text"
            class=${this.hasError("tenantName") ? "has-error" : ""}
            placeholder=${t("login.tenantNamePlaceholder")}
            .value=${this.regTenantName}
            @input=${(e: InputEvent) => { this.regTenantName = (e.target as HTMLInputElement).value; this.clearFieldError("tenantName"); }}
            @blur=${this.autoSlug}
          />
          ${this.renderFieldError("tenantName")}
        </div>
        <div class="form-group">
          <label>${t("login.tenantSlug")}</label>
          <input
            type="text"
            class=${this.hasError("tenantSlug") ? "has-error" : ""}
            placeholder=${t("login.tenantSlugPlaceholder")}
            .value=${this.regTenantSlug}
            @input=${(e: InputEvent) => {
              const raw = (e.target as HTMLInputElement).value;
              this.regTenantSlug = raw.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 128);
              this.clearFieldError("tenantSlug");
            }}
            @focus=${() => { this.slugFocused = true; }}
            @blur=${() => { this.slugFocused = false; this.autoSlug(); }}
          />
          ${this.slugFocused ? html`<div class="form-hint">${t("login.tenantSlugHint")}</div>` : this.renderFieldError("tenantSlug")}
        </div>

        <div class="divider"><span>${t("login.adminAccount")}</span></div>

        <div class="form-group">
          <label>${t("login.displayName")}</label>
          <input
            type="text"
            placeholder=${t("login.displayNamePlaceholder")}
            .value=${this.regDisplayName}
            @input=${(e: InputEvent) => (this.regDisplayName = (e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="form-group">
          <label>${t("login.email")}</label>
          <input
            type="email"
            class=${this.hasError("regEmail") ? "has-error" : ""}
            placeholder=${t("login.regEmailPlaceholder")}
            .value=${this.regEmail}
            @input=${(e: InputEvent) => { this.regEmail = (e.target as HTMLInputElement).value; this.clearFieldError("regEmail"); }}
          />
          ${this.renderFieldError("regEmail")}
        </div>
        <div class="form-group">
          <label>${t("login.password")}</label>
          <div class="secret-wrap">
            <input
              type="password"
              class=${this.hasError("regPassword") ? "has-error" : ""}
              placeholder=${t("login.regPasswordPlaceholder")}
              .value=${this.regPassword}
              @input=${(e: InputEvent) => { this.regPassword = (e.target as HTMLInputElement).value; this.clearFieldError("regPassword"); }}
              @focus=${() => { this.regPasswordFocused = true; }}
              @blur=${() => { this.regPasswordFocused = false; }}
            />
            <button type="button" class="eye-btn"
              @mousedown=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "text"; }}
              @mouseup=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
              @mouseleave=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
            ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
          </div>
          ${this.regPasswordFocused ? html`<div class="form-hint">${t("login.passwordHint")}</div>` : this.renderFieldError("regPassword")}
        </div>
        ${this.serverError ? this.renderFormError(this.translateServerError(this.serverError)) : nothing}
        <button class="btn-primary" type="submit" ?disabled=${this.loading}>
          ${this.loading ? t("login.registering") : t("login.registerBtn")}
        </button>
      </form>
    `;
  }
}
