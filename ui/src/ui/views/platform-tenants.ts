/**
 * Platform tenant management view — platform-admin only.
 *
 * Displays a paginated list of all tenants with plan/status badges.
 * Allows editing plan/quotas and suspending/unsuspending tenants.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { t, I18nController } from "../../i18n/index.ts";
import { tenantRpc } from "./tenant/rpc.ts";
import { caretFix } from "../shared-styles.ts";

// ── Types ──────────────────────────────────────────────────────────────

interface TenantRow {
  id: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  status: "active" | "suspended" | "deleted";
  quotas: {
    maxUsers: number;
    maxAgents: number;
    maxChannels: number;
    maxTokensPerMonth: number;
    maxCronJobs: number;
  };
  createdAt: string;
}

interface EditState {
  tenantId: string;
  name: string;
  plan: "free" | "pro" | "enterprise";
  quotas: {
    maxUsers: number;
    maxAgents: number;
    maxChannels: number;
    maxTokensPerMonth: number;
    maxCronJobs: number;
  };
}

// ── Component ──────────────────────────────────────────────────────────

@customElement("platform-tenants-view")
export class PlatformTenantsView extends LitElement {
  private i18nCtrl = new I18nController(this);

  @property() gatewayUrl = "";

  @state() private tenants: TenantRow[] = [];
  @state() private total = 0;
  @state() private page = 0;
  @state() private statusFilter: "all" | TenantRow["status"] = "all";
  @state() private loading = false;
  @state() private error = "";
  @state() private editState: EditState | null = null;
  @state() private editLoading = false;
  @state() private editError = "";
  @state() private confirmSuspend: string | null = null;
  /** Plan → default quotas map, fetched once via platform.plans.quotas. */
  private planQuotas: Record<"free" | "pro" | "enterprise", EditState["quotas"]> | null = null;

  /** Fallback used when platform.plans.quotas RPC is unavailable (e.g. older gateway). */
  private readonly FALLBACK_PLAN_QUOTAS: Record<"free" | "pro" | "enterprise", EditState["quotas"]> = {
    free:       { maxUsers: 10, maxAgents: 5,  maxChannels: 5,  maxTokensPerMonth: 20_000_000,  maxCronJobs: 5 },
    pro:        { maxUsers: 20, maxAgents: 20, maxChannels: 20, maxTokensPerMonth: 200_000_000, maxCronJobs: 20 },
    enterprise: { maxUsers: -1, maxAgents: -1, maxChannels: -1, maxTokensPerMonth: -1,          maxCronJobs: 50 },
  };

  private readonly PAGE_SIZE = 20;

  static styles = [caretFix, css`
    :host {
      display: block;
      padding: 1.5rem;
      color: var(--text);
      font-family: var(--font-sans, system-ui, sans-serif);
    }

    h2 { margin: 0 0 1.25rem; font-size: 1.25rem; font-weight: 600; }

    /* ── Toolbar ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .toolbar select {
      padding: 0.35rem 0.6rem;
      border: 1px solid var(--border, #ddd);
      border-radius: 6px;
      background: var(--surface, #fff);
      color: var(--text);
      font-size: 0.875rem;
    }

    /* ── Table ── */
    .table-wrap { overflow-x: auto; }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.875rem;
    }
    th {
      text-align: left;
      padding: 0.5rem 0.75rem;
      border-bottom: 2px solid var(--border, #ddd);
      font-weight: 600;
      white-space: nowrap;
    }
    td {
      padding: 0.6rem 0.75rem;
      border-bottom: 1px solid var(--border-subtle, #f0f0f0);
      vertical-align: middle;
    }
    tr:hover td { background: var(--surface-hover, #f9f9f9); }

    /* ── Badges ── */
    .badge {
      display: inline-block;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 500;
      text-transform: capitalize;
    }
    .badge-free     { background: #e5e7eb; color: #374151; }
    .badge-pro      { background: #dbeafe; color: #1d4ed8; }
    .badge-enterprise { background: #fef3c7; color: #92400e; }
    .badge-active   { background: #d1fae5; color: #065f46; }
    .badge-suspended { background: #fed7aa; color: #9a3412; }
    .badge-deleted  { background: #fee2e2; color: #991b1b; }

    /* ── Actions ── */
    .actions { display: flex; gap: 0.4rem; }
    button {
      padding: 0.3rem 0.7rem;
      border-radius: 5px;
      border: 1px solid var(--border, #ddd);
      background: var(--surface, #fff);
      color: var(--text);
      cursor: pointer;
      font-size: 0.8rem;
    }
    button:hover { background: var(--surface-hover, #f5f5f5); }
    button.danger { border-color: #f87171; color: #dc2626; }
    button.danger:hover { background: #fef2f2; }
    button.primary { background: var(--accent, #2563eb); color: #fff; border-color: transparent; }
    button.primary:hover { opacity: 0.9; }

    /* ── Pagination ── */
    .pagination {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      margin-top: 1rem;
      font-size: 0.875rem;
    }

    /* ── Modal ── */
    .modal-backdrop {
      position: fixed; inset: 0;
      background: rgba(0,0,0,0.35);
      display: flex; align-items: center; justify-content: center;
      z-index: 1000;
    }
    .modal {
      background: var(--surface, #fff);
      border-radius: 10px;
      padding: 1.5rem;
      width: 420px;
      max-width: 95vw;
      box-shadow: 0 8px 30px rgba(0,0,0,0.15);
    }
    .modal h3 { margin: 0 0 1rem; font-size: 1rem; font-weight: 600; }
    .field { margin-bottom: 0.75rem; }
    .field label { display: block; font-size: 0.8rem; font-weight: 500; margin-bottom: 0.3rem; }
    .field input, .field select {
      width: 100%; box-sizing: border-box;
      padding: 0.4rem 0.6rem;
      border: 1px solid var(--border, #ddd);
      border-radius: 6px;
      background: var(--surface, #fff);
      color: var(--text);
      font-size: 0.875rem;
    }
    .plan-options { display: flex; gap: 0.75rem; }
    .plan-option { display: flex; align-items: center; gap: 0.3rem; font-size: 0.875rem; }
    .quota-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; }
    .modal-footer { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 1rem; }
    .error-msg { color: #dc2626; font-size: 0.8rem; margin-top: 0.5rem; }

    .loading { color: var(--text-muted, #888); padding: 2rem; text-align: center; }
    .global-error { color: #dc2626; padding: 1rem; }
  `];

  connectedCallback() {
    super.connectedCallback();
    this.loadTenants();
    void this.loadPlanQuotas();
  }

  private async loadPlanQuotas() {
    try {
      this.planQuotas = await tenantRpc(
        "platform.plans.quotas",
        {},
        this.gatewayUrl,
      ) as Record<"free" | "pro" | "enterprise", EditState["quotas"]>;
    } catch (err) {
      // Gateway may not have the RPC yet (pre-upgrade); fall back to baked-in defaults
      // so the plan radio still resets quota inputs.
      console.warn("platform.plans.quotas failed; using fallback defaults:", err);
      this.planQuotas = this.FALLBACK_PLAN_QUOTAS;
    }
  }

  private async loadTenants() {
    this.loading = true;
    this.error = "";
    try {
      const result = await tenantRpc(
        "platform.tenants.list",
        {
          status: this.statusFilter === "all" ? undefined : this.statusFilter,
          limit: this.PAGE_SIZE,
          offset: this.page * this.PAGE_SIZE,
        },
        this.gatewayUrl,
      ) as { tenants: TenantRow[]; total: number };
      this.tenants = result.tenants;
      this.total = result.total;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "加载失败";
    } finally {
      this.loading = false;
    }
  }

  private onFilterChange(e: Event) {
    this.statusFilter = (e.target as HTMLSelectElement).value as typeof this.statusFilter;
    this.page = 0;
    this.loadTenants();
  }

  private async openEdit(tenantId: string) {
    this.editError = "";
    try {
      // Ensure plan-defaults are available before the modal opens so the first
      // plan-radio change has something to read. Falls back silently if it fails.
      if (!this.planQuotas) await this.loadPlanQuotas();
      const tenant = await tenantRpc("platform.tenants.get", { tenantId }, this.gatewayUrl) as TenantRow;
      this.editState = {
        tenantId: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        quotas: { ...tenant.quotas },
      };
    } catch (err) {
      this.error = err instanceof Error ? err.message : "加载失败";
    }
  }

  private closeEdit() {
    this.editState = null;
    this.editError = "";
  }

  private updateEditField(field: keyof EditState, value: unknown) {
    if (!this.editState) return;
    this.editState = { ...this.editState, [field]: value };
  }

  /**
   * Dedicated plan-change handler: resets the quota inputs to the selected
   * plan's defaults so admin always sees what they are opting into.
   * Admin can still manually override any quota before saving.
   */
  private selectPlan(planId: "free" | "pro" | "enterprise") {
    if (!this.editState) return;
    const defaults = (this.planQuotas ?? this.FALLBACK_PLAN_QUOTAS)[planId];
    this.editState = {
      ...this.editState,
      plan: planId,
      quotas: { ...(defaults ?? this.editState.quotas) },
    };
    this.requestUpdate();
  }

  private updateEditQuota(key: keyof EditState["quotas"], value: string) {
    if (!this.editState) return;
    const num = parseInt(value, 10);
    if (isNaN(num)) return;
    this.editState = { ...this.editState, quotas: { ...this.editState.quotas, [key]: num } };
  }

  private async submitEdit() {
    if (!this.editState) return;
    this.editLoading = true;
    this.editError = "";
    try {
      await tenantRpc(
        "platform.tenants.update",
        {
          tenantId: this.editState.tenantId,
          name: this.editState.name,
          plan: this.editState.plan,
          quotas: this.editState.quotas,
        },
        this.gatewayUrl,
      );
      this.closeEdit();
      await this.loadTenants();
    } catch (err) {
      this.editError = err instanceof Error ? err.message : "保存失败";
    } finally {
      this.editLoading = false;
    }
  }

  private async doSuspend(tenantId: string) {
    try {
      await tenantRpc("platform.tenants.suspend", { tenantId }, this.gatewayUrl);
      this.confirmSuspend = null;
      await this.loadTenants();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "操作失败";
    }
  }

  private async doUnsuspend(tenantId: string) {
    try {
      await tenantRpc("platform.tenants.unsuspend", { tenantId }, this.gatewayUrl);
      await this.loadTenants();
    } catch (err) {
      this.error = err instanceof Error ? err.message : "操作失败";
    }
  }

  private relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "今天";
    if (days === 1) return "昨天";
    if (days < 30) return `${days} 天前`;
    const months = Math.floor(days / 30);
    return `${months} 个月前`;
  }

  render() {
    return html`
      <h2>租户管理</h2>

      ${this.error ? html`<div class="global-error">${this.error}</div>` : nothing}

      <div class="toolbar">
        <label>状态筛选</label>
        <select @change=${this.onFilterChange}>
          <option value="all">全部</option>
          <option value="active">活跃</option>
          <option value="suspended">已暂停</option>
          <option value="deleted">已删除</option>
        </select>
      </div>

      ${this.loading
        ? html`<div class="loading">加载中…</div>`
        : html`
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>租户名</th>
                  <th>套餐</th>
                  <th>状态</th>
                  <th>最大用户</th>
                  <th>最大 Agent</th>
                  <th>创建时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${this.tenants.map(t => html`
                  <tr>
                    <td>${t.name}</td>
                    <td><span class="badge badge-${t.plan}">${t.plan}</span></td>
                    <td><span class="badge badge-${t.status}">${t.status}</span></td>
                    <td>${t.quotas.maxUsers}</td>
                    <td>${t.quotas.maxAgents}</td>
                    <td>${this.relativeTime(t.createdAt)}</td>
                    <td>
                      <div class="actions">
                        ${t.status !== "deleted" ? html`
                          <button @click=${() => this.openEdit(t.id)}>编辑</button>
                          ${t.status === "active"
                            ? html`<button class="danger" @click=${() => { this.confirmSuspend = t.id; }}>暂停</button>`
                            : html`<button @click=${() => this.doUnsuspend(t.id)}>恢复</button>`
                          }
                        ` : nothing}
                      </div>
                    </td>
                  </tr>
                `)}
                ${this.tenants.length === 0 ? html`
                  <tr><td colspan="7" style="text-align:center;color:var(--text-muted,#888);padding:2rem;">暂无租户</td></tr>
                ` : nothing}
              </tbody>
            </table>
          </div>

          <div class="pagination">
            <button ?disabled=${this.page === 0} @click=${() => { this.page--; this.loadTenants(); }}>上一页</button>
            <span>${this.page * this.PAGE_SIZE + 1}–${Math.min((this.page + 1) * this.PAGE_SIZE, this.total)} / ${this.total}</span>
            <button ?disabled=${(this.page + 1) * this.PAGE_SIZE >= this.total} @click=${() => { this.page++; this.loadTenants(); }}>下一页</button>
          </div>
        `
      }

      ${this.editState ? this.renderEditModal() : nothing}
      ${this.confirmSuspend ? this.renderConfirmModal() : nothing}
    `;
  }

  private renderEditModal() {
    const s = this.editState!;
    return html`
      <div class="modal-backdrop" @click=${(e: Event) => { if (e.target === e.currentTarget) this.closeEdit(); }}>
        <div class="modal">
          <h3>编辑租户：${s.name}</h3>

          <div class="field">
            <label>租户名称</label>
            <input type="text" .value=${s.name} @input=${(e: InputEvent) => this.updateEditField("name", (e.target as HTMLInputElement).value)} />
          </div>

          <div class="field">
            <label>套餐</label>
            <div class="plan-options">
              ${(["free", "pro", "enterprise"] as const).map(p => html`
                <label class="plan-option">
                  <input type="radio" name="plan" .value=${p} ?checked=${s.plan === p}
                    @click=${() => this.selectPlan(p)} />
                  ${p}
                </label>
              `)}
            </div>
          </div>

          <div class="field">
            <label>配额覆盖（留空使用套餐默认值）</label>
            <div class="quota-grid">
              <div>
                <label>最大用户数</label>
                <input type="number" .value=${s.quotas.maxUsers} @input=${(e: InputEvent) => this.updateEditQuota("maxUsers", (e.target as HTMLInputElement).value)} />
              </div>
              <div>
                <label>最大 Agent 数</label>
                <input type="number" .value=${s.quotas.maxAgents} @input=${(e: InputEvent) => this.updateEditQuota("maxAgents", (e.target as HTMLInputElement).value)} />
              </div>
              <div>
                <label>最大频道数</label>
                <input type="number" .value=${s.quotas.maxChannels} @input=${(e: InputEvent) => this.updateEditQuota("maxChannels", (e.target as HTMLInputElement).value)} />
              </div>
              <div>
                <label>月 Token 上限</label>
                <input type="number" .value=${s.quotas.maxTokensPerMonth} @input=${(e: InputEvent) => this.updateEditQuota("maxTokensPerMonth", (e.target as HTMLInputElement).value)} />
              </div>
              <div>
                <label>最大定时任务数</label>
                <input type="number" .value=${s.quotas.maxCronJobs} @input=${(e: InputEvent) => this.updateEditQuota("maxCronJobs", (e.target as HTMLInputElement).value)} placeholder="-1 = 无限制" />
              </div>
            </div>
          </div>

          ${this.editError ? html`<div class="error-msg">${this.editError}</div>` : nothing}

          <div class="modal-footer">
            <button @click=${this.closeEdit}>取消</button>
            <button class="primary" ?disabled=${this.editLoading} @click=${this.submitEdit}>
              ${this.editLoading ? "保存中…" : "保存"}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private renderConfirmModal() {
    const id = this.confirmSuspend!;
    const name = this.tenants.find(t => t.id === id)?.name ?? id;
    return html`
      <div class="modal-backdrop">
        <div class="modal">
          <h3>确认暂停</h3>
          <p>确定要暂停租户「${name}」吗？暂停后该租户将无法使用服务。</p>
          <div class="modal-footer">
            <button @click=${() => { this.confirmSuspend = null; }}>取消</button>
            <button class="danger" @click=${() => this.doSuspend(id)}>确认暂停</button>
          </div>
        </div>
      </div>
    `;
  }
}
