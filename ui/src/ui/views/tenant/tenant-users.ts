/**
 * Tenant user management view.
 *
 * Lists users, supports inviting new users, changing roles, and removing users.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { loadAuth } from "../../auth-store.ts";
import { tenantRpc } from "./rpc.ts";

interface TenantUser {
  id: string;
  email: string;
  displayName: string | null;
  role: string;
  status: string;
  lastLoginAt: string | null;
  createdAt: string;
}

@customElement("tenant-users-view")
export class TenantUsersView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 1.5rem;
      color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1.5rem;
    }
    h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    .btn {
      padding: 0.45rem 0.9rem;
      border: none;
      border-radius: var(--radius-md, 6px);
      font-size: 0.85rem;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary {
      background: var(--accent, #3b82f6);
      color: white;
    }
    .btn-danger {
      background: var(--bg-destructive, #7f1d1d);
      color: var(--text-destructive, #fca5a5);
    }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.85rem;
    }
    th, td {
      text-align: left;
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--border, #262626);
    }
    th {
      font-weight: 500;
      color: var(--text-secondary, #a3a3a3);
      font-size: 0.8rem;
    }
    .role-badge {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
      background: var(--border, #262626);
    }
    .role-badge.owner { background: #7c3aed33; color: #a78bfa; }
    .role-badge.admin { background: #2563eb33; color: #60a5fa; }
    .role-badge.member { background: #059669; color: #6ee7b7; }
    .role-badge.viewer { background: #525252; color: #a3a3a3; }
    .btn-warn {
      background: #78350f;
      color: #fbbf24;
    }
    .btn-success {
      background: #064e3b;
      color: #6ee7b7;
    }
    .status-badge {
      display: inline-block;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
      font-size: 0.75rem;
      font-weight: 500;
    }
    .status-badge.active { background: #059669; color: #6ee7b7; }
    .status-badge.suspended { background: #78350f; color: #fbbf24; }
    .status-badge.deleted { background: #7f1d1d; color: #fca5a5; }
    .actions { display: flex; gap: 0.4rem; }
    .error-msg {
      background: var(--bg-destructive, #2d1215);
      border: 1px solid var(--border-destructive, #7f1d1d);
      border-radius: var(--radius-md, 6px);
      color: var(--text-destructive, #fca5a5);
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      margin-bottom: 1rem;
    }
    .success-msg {
      background: #052e16;
      border: 1px solid #166534;
      border-radius: var(--radius-md, 6px);
      color: #86efac;
      padding: 0.5rem 0.75rem;
      font-size: 0.8rem;
      margin-bottom: 1rem;
    }
    .invite-form {
      background: var(--card, #141414);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px);
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .invite-form h3 {
      margin: 0 0 1rem;
      font-size: 0.95rem;
      font-weight: 600;
    }
    .form-row {
      display: flex;
      gap: 0.75rem;
      margin-bottom: 0.75rem;
      align-items: flex-end;
    }
    .form-field { flex: 1; }
    .form-field label {
      display: block;
      font-size: 0.8rem;
      margin-bottom: 0.3rem;
      color: var(--text-secondary, #a3a3a3);
    }
    .form-field input, .form-field select {
      width: 100%;
      padding: 0.45rem 0.65rem;
      background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px);
      color: var(--text, #e5e5e5);
      font-size: 0.85rem;
      outline: none;
      box-sizing: border-box;
    }
    .form-field input:focus, .form-field select:focus {
      border-color: var(--accent, #3b82f6);
    }
    .empty {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted, #525252);
      font-size: 0.85rem;
    }
    .loading { text-align: center; padding: 2rem; color: var(--text-muted, #525252); }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private users: TenantUser[] = [];
  @state() private loading = false;
  @state() private error = "";
  @state() private success = "";
  private msgTimer?: ReturnType<typeof setTimeout>;
  @state() private showInvite = false;
  @state() private inviteEmail = "";
  @state() private inviteRole = "member";
  @state() private inviteDisplayName = "";
  @state() private invitePassword = "";
  @state() private inviting = false;

  connectedCallback() {
    super.connectedCallback();
    this.loadUsers();
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

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

  private async loadUsers() {
    this.loading = true;
    this.error = "";
    try {
      const result = await this.rpc("tenant.users.list") as { users: TenantUser[] };
      this.users = result.users ?? [];
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "加载用户列表失败");
    } finally {
      this.loading = false;
    }
  }

  private async handleInvite(e: Event) {
    e.preventDefault();
    if (!this.inviteEmail || !this.invitePassword) return;
    this.inviting = true;
    this.error = "";
    this.success = "";
    try {
      await this.rpc("tenant.users.invite", {
        email: this.inviteEmail,
        password: this.invitePassword,
        role: this.inviteRole,
        displayName: this.inviteDisplayName || undefined,
      });
      this.showSuccess(`已成功邀请 ${this.inviteEmail}`);
      this.inviteEmail = "";
      this.invitePassword = "";
      this.inviteDisplayName = "";
      this.showInvite = false;
      await this.loadUsers();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "邀请失败");
    } finally {
      this.inviting = false;
    }
  }

  private async handleRoleChange(userId: string, newRole: string) {
    this.error = "";
    try {
      await this.rpc("tenant.users.update", { userId, role: newRole });
      await this.loadUsers();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "更新角色失败");
    }
  }

  private async handleToggleStatus(userId: string, displayName: string | null, email: string | null, currentStatus: string) {
    const label = displayName || email || userId;
    const newStatus = currentStatus === "active" ? "suspended" : "active";
    const action = newStatus === "suspended" ? "禁用" : "启用";
    if (!confirm(`确定要${action}用户 ${label} 吗？`)) return;
    this.error = "";
    try {
      await this.rpc("tenant.users.update", { userId, status: newStatus });
      this.showSuccess(`已${action} ${label}`);
      await this.loadUsers();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : `${action}失败`);
    }
  }

  render() {
    const currentAuth = loadAuth();
    const currentUserId = currentAuth?.user?.id;
    const currentRole = currentAuth?.user?.role;

    return html`
      <div class="header">
        <h2>用户管理</h2>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}
      ${this.success ? html`<div class="success-msg">${this.success}</div>` : nothing}

      ${this.loading ? html`<div class="loading">加载中...</div>` : this.users.length === 0 ? html`<div class="empty">暂无用户</div>` : html`
        <table>
          <thead>
            <tr>
              <th>邮箱</th>
              <th>姓名</th>
              <th>角色</th>
              <th>状态</th>
              <th>最后登录</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${this.users.map(user => html`
              <tr>
                <td>${user.email ?? "-"}</td>
                <td>${user.displayName ?? "-"}</td>
                <td>
                  <span class="role-badge ${user.role}">${this.roleLabel(user.role)}</span>
                </td>
                <td>
                  <span class="status-badge ${user.status}">${this.statusLabel(user.status)}</span>
                </td>
                <td>${user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString("zh-CN") : "-"}</td>
                <td>
                  <div class="actions">
                    ${user.id !== currentUserId && user.role !== "owner" ? html`
                      ${currentRole === "owner" ? html`
                        <select class="btn btn-sm"
                          .value=${user.role}
                          @change=${(e: Event) => this.handleRoleChange(user.id, (e.target as HTMLSelectElement).value)}>
                          <option value="admin" ?selected=${user.role === "admin"}>管理员</option>
                          <option value="member" ?selected=${user.role === "member"}>成员</option>
                          <option value="viewer" ?selected=${user.role === "viewer"}>只读</option>
                        </select>
                      ` : nothing}
                      ${user.status === "active" ? html`
                        <button class="btn btn-warn btn-sm"
                          @click=${() => this.handleToggleStatus(user.id, user.displayName, user.email, user.status)}>禁用</button>
                      ` : html`
                        <button class="btn btn-success btn-sm"
                          @click=${() => this.handleToggleStatus(user.id, user.displayName, user.email, user.status)}>启用</button>
                      `}
                    ` : nothing}
                  </div>
                </td>
              </tr>
            `)}
          </tbody>
        </table>
      `}
    `;
  }

  private roleLabel(role: string): string {
    const map: Record<string, string> = {
      owner: "所有者", admin: "管理员", member: "成员", viewer: "只读",
    };
    return map[role] ?? role;
  }

  private statusLabel(status: string): string {
    const map: Record<string, string> = {
      active: "正常", suspended: "已禁用", deleted: "已删除",
    };
    return map[status] ?? status;
  }
}
