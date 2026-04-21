/**
 * Graphic captcha input used on login / register / forgot-password
 * forms in multi-tenant mode.
 *
 * The component issues `captcha.challenge` on first render (and on
 * every `refresh()` call or click of the SVG), renders the returned
 * SVG, and exposes the user's answer via the `value` getter.
 *
 * Parents read `.captchaId` + `.value` before submitting the form, and
 * call `refresh()` after any auth failure so a single challenge cannot
 * be reused across attempts.
 */

import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { requestCaptchaChallenge } from "../auth-store.ts";
import { t, I18nController } from "../../i18n/index.ts";

@customElement("captcha-field")
export class CaptchaField extends LitElement {
  // Subscribe to locale changes so labels re-render on language switch.
  private i18nCtrl = new I18nController(this);

  @property({ type: String, attribute: "gateway-url" }) gatewayUrl = "";
  @property({ type: String }) error = "";

  @state() private svg = "";
  @state() private challengeId = "";
  @state() private expiresAt = 0;
  @state() private loading = false;
  @state() private answer = "";
  @state() private loadError = "";

  private expiryTimer?: ReturnType<typeof setTimeout>;

  static styles = css`
    :host { display: block; }
    .row {
      display: flex;
      align-items: stretch;
      gap: 10px;
    }
    .image-btn {
      width: 128px;
      height: 44px;
      padding: 0;
      border: 1px solid var(--border, #d0d7de);
      border-radius: 8px;
      background: #f4f6f8;
      cursor: pointer;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      flex: 0 0 auto;
    }
    .image-btn:hover { border-color: #0891b2; }
    .image-btn svg { width: 100%; height: 100%; }
    .placeholder {
      font-size: 12px;
      color: #6a737d;
    }
    input {
      flex: 1 1 auto;
      padding: 0 12px;
      height: 44px;
      border: 1px solid var(--border, #d0d7de);
      border-radius: 8px;
      font-size: 14px;
      font-family: inherit;
      letter-spacing: 2px;
      text-transform: uppercase;
      background: var(--surface, #fff);
      color: var(--text, #111);
      box-sizing: border-box;
    }
    input:focus {
      outline: none;
      border-color: #0891b2;
      box-shadow: 0 0 0 3px rgba(8,145,178,0.15);
    }
    input.has-error {
      border-color: #d73a49;
    }
    .error {
      margin-top: 6px;
      color: #d73a49;
      font-size: 12px;
    }
  `;

  connectedCallback(): void {
    super.connectedCallback();
    void this.refresh();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this.expiryTimer) {clearTimeout(this.expiryTimer);}
  }

  /** Current user-entered answer. */
  get value(): string {
    return this.answer.trim();
  }

  /** Current challenge id — undefined until the first load resolves. */
  get captchaId(): string {
    return this.challengeId;
  }

  /** Fetch a new challenge and clear the answer field. */
  async refresh(): Promise<void> {
    if (!this.gatewayUrl) {
      this.loadError = t("captcha.loadFailed");
      return;
    }
    this.loading = true;
    this.loadError = "";
    this.answer = "";
    try {
      const c = await requestCaptchaChallenge(this.gatewayUrl);
      this.challengeId = c.id;
      this.svg = c.svg;
      this.expiresAt = c.expiresAt;
      this.dispatchEvent(new CustomEvent("captcha-ready", {
        detail: { id: c.id, expiresAt: c.expiresAt },
        bubbles: true,
        composed: true,
      }));
      this.scheduleAutoRefresh();
    } catch (err) {
      this.loadError = err instanceof Error ? err.message : t("captcha.loadFailed");
    } finally {
      this.loading = false;
    }
  }

  private scheduleAutoRefresh(): void {
    if (this.expiryTimer) {clearTimeout(this.expiryTimer);}
    const msUntilExpiry = this.expiresAt - Date.now() - 5_000;
    if (msUntilExpiry <= 0) {return;}
    this.expiryTimer = setTimeout(() => {
      void this.refresh();
    }, msUntilExpiry);
  }

  private onInput(e: Event): void {
    this.answer = (e.target as HTMLInputElement).value;
    this.dispatchEvent(new CustomEvent("captcha-input", {
      detail: { value: this.answer },
      bubbles: true,
      composed: true,
    }));
  }

  protected render() {
    void this.i18nCtrl; // subscribe to locale changes
    const errorText = this.error || this.loadError;
    return html`
      <div class="row">
        <button
          type="button"
          class="image-btn"
          @click=${() => { void this.refresh(); }}
          title=${t("captcha.refreshHint")}
          aria-label=${t("captcha.refreshAria")}
          ?disabled=${this.loading}
        >
          ${this.svg
            ? html`<span .innerHTML=${this.svg}></span>`
            : html`<span class="placeholder">${this.loading ? t("captcha.loading") : t("captcha.clickToLoad")}</span>`}
        </button>
        <input
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="8"
          class=${errorText ? "has-error" : ""}
          placeholder=${t("captcha.placeholder")}
          .value=${this.answer}
          @input=${this.onInput}
        />
      </div>
      ${errorText ? html`<div class="error">${errorText}</div>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "captcha-field": CaptchaField;
  }
}
