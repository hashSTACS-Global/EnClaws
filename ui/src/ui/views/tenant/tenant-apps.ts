/**
 * Tenant APP management view.
 *
 * Lists installed APPs, supports installing from a Git URL,
 * invoking pipelines, and uninstalling APPs.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { t, I18nController } from "../../../i18n/index.ts";
import { caretFix } from "../../shared-styles.ts";
import { tenantRpc } from "./rpc.ts";

interface AppPipelineEntry {
  name: string;
}

interface AppEntry {
  name: string;
  version: string;
  commit: string;
  installedAt: string;
  pipelines: string[];
  hasCredentials: boolean;
  hasWorkspace: boolean;
  workspaceRepo: string;
  gitUser: string;
  gitEmail: string;
  gitTokenMasked: string;
  feishuAppId: string;
  hasFeishuApp: boolean;
}

@customElement("tenant-apps-view")
export class TenantAppsView extends LitElement {
  private i18nCtrl = new I18nController(this);

  static styles = [caretFix, css`
    :host {
      display: block; padding: 1.5rem; color: var(--text);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    .subtitle { font-size: 0.8rem; color: var(--text-2); margin-top: 0.25rem; }

    .btn {
      padding: 0.45rem 0.9rem; border: none; border-radius: var(--radius-md);
      font-size: 0.85rem; cursor: pointer; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-primary { background: var(--accent); color: var(--accent-foreground); border: none; }
    .btn-outline { background: transparent; border: 1px solid var(--border); color: var(--text); }
    .btn-danger { background: var(--danger-subtle); color: var(--danger); border: none; }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.78rem; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }

    .error-msg {
      background: var(--danger-subtle); border: 1px solid var(--danger);
      border-radius: var(--radius-md); color: var(--danger);
      padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
      user-select: text; -webkit-user-select: text;
    }
    .success-msg {
      background: var(--ok-subtle); border: 1px solid var(--ok);
      border-radius: var(--radius-md); color: var(--ok);
      padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }

    /* Install form */
    .install-form {
      display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1.5rem;
      flex-wrap: wrap;
    }
    .install-form input {
      padding: 0.4rem 0.6rem; background: var(--input-bg);
      border: 1px solid var(--input-border); border-radius: var(--radius-md);
      color: var(--text); font-size: 0.85rem; outline: none; flex: 1; min-width: 280px;
    }
    .install-form input:focus { border-color: var(--accent); }
    .install-form input::placeholder { color: var(--text-2); }

    /* APP list */
    .app-list {
      display: flex; flex-direction: column;
      border-top: 1px solid var(--border);
    }
    .app-card {
      padding: 0.75rem 0.75rem 0.5rem;
      border-bottom: 1px solid var(--border);
    }
    .app-card:hover { background: var(--bg-hover); }
    .app-header {
      display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem;
    }
    .app-info { flex: 1; min-width: 0; }
    .app-name { font-size: 0.9rem; font-weight: 600; }
    .app-meta { display: flex; gap: 0.5rem; flex-wrap: wrap; margin-top: 0.3rem; }
    .chip {
      display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.45rem;
      border-radius: 4px; font-weight: 500;
      background: var(--border); color: var(--muted);
    }
    .chip-info { background: var(--accent); color: var(--accent-foreground); opacity: 0.8; }
    .app-actions { display: flex; gap: 0.4rem; flex-shrink: 0; align-items: center; }

    /* Pipeline list */
    .pipeline-section { margin-top: 0.5rem; }
    .pipeline-label { font-size: 0.78rem; color: var(--text-2); margin-bottom: 0.3rem; }
    .pipeline-chips {
      display: flex; gap: 0.3rem; flex-wrap: wrap;
    }
    .pipeline-chip {
      display: inline-block; font-size: 0.72rem; padding: 0.15rem 0.4rem;
      border-radius: 3px; background: var(--bg-hover); color: var(--text);
      border: 1px solid var(--border); cursor: default;
    }

    /* Configure panel */
    .configure-section {
      display: flex; gap: 0.4rem; flex-wrap: wrap; margin-top: 0.5rem;
      padding: 0.5rem; background: var(--bg-hover); border-radius: var(--radius-md);
    }
    .configure-section input {
      padding: 0.35rem 0.5rem; background: var(--input-bg);
      border: 1px solid var(--input-border); border-radius: var(--radius-md);
      color: var(--text); font-size: 0.8rem; outline: none; flex: 1; min-width: 180px;
    }
    .configure-section input:focus { border-color: var(--accent); }
    .chip-success { background: var(--ok-subtle); color: var(--ok); }
    .chip-warning { background: var(--warn-subtle); color: var(--warn); }

    .empty { text-align: center; padding: 3rem 1rem; color: var(--text-2); font-size: 0.85rem; }
    .loading { text-align: center; padding: 2rem; color: var(--text-2); }
  `];

  @property({ type: String }) gatewayUrl = "";

  @state() private _loading = false;
  @state() private _error = "";
  @state() private _success = "";
  @state() private _apps: AppEntry[] = [];
  @state() private _gitUrl = "";
  @state() private _workspaceRepo = "";
  @state() private _gitToken = "";
  @state() private _gitUser = "";
  @state() private _gitEmail = "";
  @state() private _feishuAppId = "";
  @state() private _feishuAppSecret = "";
  @state() private _installing = false;
  @state() private _uninstallingApp = "";
  @state() private _upgradingApp = "";
  @state() private _configuringApp = "";
  @state() private _cfgWorkspaceRepo = "";
  @state() private _cfgGitToken = "";
  @state() private _cfgGitUser = "";
  @state() private _cfgGitEmail = "";
  @state() private _cfgFeishuAppId = "";
  @state() private _cfgFeishuAppSecret = "";
  @state() private _cfgBusy = false;

  connectedCallback() {
    super.connectedCallback();
    this._load();
  }

  private async _load() {
    this._loading = true;
    this._error = "";
    try {
      const res = await tenantRpc("app.list", {}, this.gatewayUrl) as { apps: AppEntry[] };
      this._apps = res.apps ?? [];
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private async _install() {
    const gitUrl = this._gitUrl.trim();
    if (!gitUrl) return;
    this._installing = true;
    this._error = "";
    this._success = "";
    try {
      const installParams: Record<string, string> = { gitUrl };
      const wsRepo = this._workspaceRepo.trim();
      if (wsRepo) installParams.workspaceRepo = wsRepo;
      const token = this._gitToken.trim();
      if (token) installParams.gitToken = token;
      const user = this._gitUser.trim();
      if (user) installParams.gitUser = user;
      const email = this._gitEmail.trim();
      if (email) installParams.gitEmail = email;
      const fAppId = this._feishuAppId.trim();
      if (fAppId) installParams.feishuAppId = fAppId;
      const fAppSecret = this._feishuAppSecret.trim();
      if (fAppSecret) installParams.feishuAppSecret = fAppSecret;
      const res = await tenantRpc("app.install", installParams, this.gatewayUrl) as { name: string; version: string };
      this._success = t("tenantApps.installSuccess", { name: res.name, version: res.version });
      this._gitUrl = "";
      this._workspaceRepo = "";
      this._gitToken = "";
      this._gitUser = "";
      this._gitEmail = "";
      this._feishuAppId = "";
      this._feishuAppSecret = "";
      await this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._installing = false;
    }
  }

  private async _upgrade(appName: string) {
    this._upgradingApp = appName;
    this._error = "";
    this._success = "";
    try {
      const res = await tenantRpc("app.upgrade", { name: appName }, this.gatewayUrl) as { name: string; version: string; commit: string };
      this._success = t("tenantApps.upgradeSuccess", { name: res.name, commit: res.commit.slice(0, 7) });
      await this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._upgradingApp = "";
    }
  }

  private async _uninstall(appName: string) {
    this._uninstallingApp = appName;
    this._error = "";
    this._success = "";
    try {
      await tenantRpc("app.uninstall", { name: appName, purgeWorkspace: false }, this.gatewayUrl);
      this._success = t("tenantApps.uninstallSuccess", { name: appName });
      await this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._uninstallingApp = "";
    }
  }

  private _openConfigure(appName: string) {
    if (this._configuringApp === appName) {
      this._configuringApp = "";
      return;
    }
    this._configuringApp = appName;
    const app = this._apps.find((a) => a.name === appName);
    this._cfgWorkspaceRepo = app?.workspaceRepo ?? "";
    this._cfgGitToken = "";  // never prefill real token — show masked in placeholder
    this._cfgGitUser = app?.gitUser ?? "";
    this._cfgGitEmail = app?.gitEmail ?? "";
    this._cfgFeishuAppId = app?.feishuAppId ?? "";
    this._cfgFeishuAppSecret = "";  // never prefill secret
  }

  private async _saveConfigure() {
    this._cfgBusy = true;
    this._error = "";
    this._success = "";
    try {
      const params: Record<string, string> = { name: this._configuringApp };
      const ws = this._cfgWorkspaceRepo.trim();
      if (ws) params.workspaceRepo = ws;
      const token = this._cfgGitToken.trim();
      if (token) params.gitToken = token;
      const user = this._cfgGitUser.trim();
      if (user) params.gitUser = user;
      const email = this._cfgGitEmail.trim();
      if (email) params.gitEmail = email;
      const fAppId = this._cfgFeishuAppId.trim();
      if (fAppId) params.feishuAppId = fAppId;
      const fAppSecret = this._cfgFeishuAppSecret.trim();
      if (fAppSecret) params.feishuAppSecret = fAppSecret;
      await tenantRpc("app.configure", params, this.gatewayUrl);
      this._success = t("tenantApps.configureSuccess", { name: this._configuringApp });
      this._configuringApp = "";
      await this._load();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._cfgBusy = false;
    }
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") this._install();
  }

  render() {
    return html`
      <div class="header">
        <div>
          <h2>${t("tenantApps.title")}</h2>
          <div class="subtitle">${t("tenantApps.subtitle")}</div>
        </div>
        <button class="btn btn-outline btn-sm" @click=${this._load} ?disabled=${this._loading}>
          ${t("tenantApps.refresh")}
        </button>
      </div>

      ${this._error ? html`<div class="error-msg">${this._error}</div>` : nothing}
      ${this._success ? html`<div class="success-msg">${this._success}</div>` : nothing}

      <div class="install-form">
        <input
          type="text"
          placeholder=${t("tenantApps.gitUrlPlaceholder")}
          .value=${this._gitUrl}
          @input=${(e: InputEvent) => { this._gitUrl = (e.target as HTMLInputElement).value; }}
          @keydown=${this._onKeyDown}
          ?disabled=${this._installing}
        />
        <input
          type="text"
          placeholder=${t("tenantApps.workspaceRepoPlaceholder")}
          .value=${this._workspaceRepo}
          @input=${(e: InputEvent) => { this._workspaceRepo = (e.target as HTMLInputElement).value; }}
          @keydown=${this._onKeyDown}
          ?disabled=${this._installing}
        />
        <input
          type="password"
          placeholder=${t("tenantApps.gitTokenPlaceholder")}
          .value=${this._gitToken}
          @input=${(e: InputEvent) => { this._gitToken = (e.target as HTMLInputElement).value; }}
          ?disabled=${this._installing}
        />
        <input
          type="text"
          placeholder=${t("tenantApps.gitUserPlaceholder")}
          .value=${this._gitUser}
          @input=${(e: InputEvent) => { this._gitUser = (e.target as HTMLInputElement).value; }}
          ?disabled=${this._installing}
        />
        <input
          type="text"
          placeholder=${t("tenantApps.gitEmailPlaceholder")}
          .value=${this._gitEmail}
          @input=${(e: InputEvent) => { this._gitEmail = (e.target as HTMLInputElement).value; }}
          ?disabled=${this._installing}
        />
        <input
          type="text"
          placeholder=${t("tenantApps.feishuAppIdPlaceholder")}
          .value=${this._feishuAppId}
          @input=${(e: InputEvent) => { this._feishuAppId = (e.target as HTMLInputElement).value; }}
          ?disabled=${this._installing}
        />
        <input
          type="password"
          placeholder=${t("tenantApps.feishuAppSecretPlaceholder")}
          .value=${this._feishuAppSecret}
          @input=${(e: InputEvent) => { this._feishuAppSecret = (e.target as HTMLInputElement).value; }}
          ?disabled=${this._installing}
        />
        <button class="btn btn-primary" @click=${this._install}
                ?disabled=${this._installing || !this._gitUrl.trim()}>
          ${this._installing ? t("tenantApps.installing") : t("tenantApps.install")}
        </button>
      </div>

      ${this._loading ? html`<div class="loading">${t("tenantApps.loading")}</div>` : nothing}

      ${!this._loading && this._apps.length === 0
        ? html`<div class="empty">${t("tenantApps.empty")}</div>`
        : nothing}

      ${!this._loading && this._apps.length > 0
        ? html`
          <div class="app-list">
            ${this._apps.map((app) => html`
              <div class="app-card">
                <div class="app-header">
                  <div class="app-info">
                    <span class="app-name">${app.name}</span>
                    <div class="app-meta">
                      <span class="chip chip-info">v${app.version}</span>
                      <span class="chip">${app.commit ? app.commit.slice(0, 7) : "?"}</span>
                      <span class="chip">${t("tenantApps.pipelineCount", { count: String(app.pipelines.length) })}</span>
                      <span class="chip ${app.hasWorkspace ? "chip-success" : "chip-warning"}">
                        ${app.hasWorkspace ? t("tenantApps.workspaceReady") : t("tenantApps.workspaceMissing")}
                      </span>
                      <span class="chip ${app.hasCredentials ? "chip-success" : "chip-warning"}">
                        ${app.hasCredentials ? t("tenantApps.credentialsReady") : t("tenantApps.credentialsMissing")}
                      </span>
                      <span class="chip ${app.hasFeishuApp ? "chip-success" : "chip-warning"}">
                        ${app.hasFeishuApp ? t("tenantApps.feishuReady") : t("tenantApps.feishuMissing")}
                      </span>
                      ${app.installedAt
                        ? html`<span class="chip">${new Date(app.installedAt).toLocaleDateString()}</span>`
                        : nothing}
                    </div>
                  </div>
                  <div class="app-actions">
                    <button class="btn btn-outline btn-sm"
                            @click=${() => this._upgrade(app.name)}
                            ?disabled=${this._upgradingApp === app.name}>
                      ${this._upgradingApp === app.name ? t("tenantApps.upgrading") : t("tenantApps.upgrade")}
                    </button>
                    <button class="btn btn-outline btn-sm"
                            @click=${() => this._openConfigure(app.name)}>
                      ${t("tenantApps.configure")}
                    </button>
                    <button class="btn btn-danger btn-sm"
                            @click=${() => this._uninstall(app.name)}
                            ?disabled=${this._uninstallingApp === app.name}>
                      ${this._uninstallingApp === app.name ? t("tenantApps.uninstalling") : t("tenantApps.uninstall")}
                    </button>
                  </div>
                </div>
                ${this._configuringApp === app.name
                  ? html`
                    <div class="configure-section">
                      <input type="text" placeholder=${t("tenantApps.workspaceRepoPlaceholder")}
                             .value=${this._cfgWorkspaceRepo}
                             @input=${(e: InputEvent) => { this._cfgWorkspaceRepo = (e.target as HTMLInputElement).value; }}
                             ?disabled=${this._cfgBusy} />
                      <input type="password" placeholder=${app.gitTokenMasked || t("tenantApps.gitTokenPlaceholder")}
                             .value=${this._cfgGitToken}
                             @input=${(e: InputEvent) => { this._cfgGitToken = (e.target as HTMLInputElement).value; }}
                             ?disabled=${this._cfgBusy} />
                      <input type="text" placeholder=${t("tenantApps.gitUserPlaceholder")}
                             .value=${this._cfgGitUser}
                             @input=${(e: InputEvent) => { this._cfgGitUser = (e.target as HTMLInputElement).value; }}
                             ?disabled=${this._cfgBusy} />
                      <input type="text" placeholder=${t("tenantApps.gitEmailPlaceholder")}
                             .value=${this._cfgGitEmail}
                             @input=${(e: InputEvent) => { this._cfgGitEmail = (e.target as HTMLInputElement).value; }}
                             ?disabled=${this._cfgBusy} />
                      <input type="text" placeholder=${app.feishuAppId || t("tenantApps.feishuAppIdPlaceholder")}
                             .value=${this._cfgFeishuAppId}
                             @input=${(e: InputEvent) => { this._cfgFeishuAppId = (e.target as HTMLInputElement).value; }}
                             ?disabled=${this._cfgBusy} />
                      <input type="password" placeholder=${t("tenantApps.feishuAppSecretPlaceholder")}
                             .value=${this._cfgFeishuAppSecret}
                             @input=${(e: InputEvent) => { this._cfgFeishuAppSecret = (e.target as HTMLInputElement).value; }}
                             ?disabled=${this._cfgBusy} />
                      <button class="btn btn-primary btn-sm" @click=${this._saveConfigure} ?disabled=${this._cfgBusy}>
                        ${this._cfgBusy ? t("tenantApps.saving") : t("tenantApps.save")}
                      </button>
                    </div>`
                  : nothing}
                ${app.pipelines.length > 0
                  ? html`
                    <div class="pipeline-section">
                      <div class="pipeline-label">${t("tenantApps.pipelines")}</div>
                      <div class="pipeline-chips">
                        ${app.pipelines.map((p) => html`<span class="pipeline-chip">${p}</span>`)}
                      </div>
                    </div>`
                  : nothing}
              </div>
            `)}
          </div>`
        : nothing}
    `;
  }
}
