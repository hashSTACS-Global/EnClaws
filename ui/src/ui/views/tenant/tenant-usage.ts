/**
 * Tenant usage dashboard view.
 *
 * Shows token usage summary, quota info, and monthly trends.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { tenantRpc } from "./rpc.ts";
import "../../components/date-picker.ts";

interface UsageSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  requestCount: number;
  periodStart: string;
  periodEnd: string;
}

interface QuotaInfo {
  monthlyTokenLimit: number | null;
  usedTokens: number;
  remainingTokens: number | null;
  usagePercent: number | null;
}

@customElement("tenant-usage-view")
export class TenantUsageView extends LitElement {
  static styles = css`
    :host {
      display: block; padding: 1.5rem; color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    .btn {
      padding: 0.45rem 0.9rem; border: none; border-radius: var(--radius-md, 6px);
      font-size: 0.85rem; cursor: pointer; transition: opacity 0.15s;
    }
    .btn:hover { opacity: 0.85; }
    .btn-outline { background: transparent; border: 1px solid var(--border, #262626); color: var(--text, #e5e5e5); }
    .stats-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem; margin-bottom: 1.5rem;
    }
    .stat-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 1.25rem;
    }
    .stat-label { font-size: 0.8rem; color: var(--text-secondary, #a3a3a3); margin-bottom: 0.35rem; }
    .stat-value { font-size: 1.5rem; font-weight: 700; }
    .stat-sub { font-size: 0.75rem; color: var(--text-muted, #525252); margin-top: 0.25rem; }
    .quota-bar {
      height: 8px; border-radius: 4px; background: var(--border, #262626);
      margin-top: 0.5rem; overflow: hidden;
    }
    .quota-fill {
      height: 100%; border-radius: 4px; transition: width 0.3s;
    }
    .quota-fill.low { background: #22c55e; }
    .quota-fill.mid { background: #eab308; }
    .quota-fill.high { background: #ef4444; }
    .section {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 1.25rem; margin-bottom: 1rem;
    }
    .section h3 { margin: 0 0 1rem; font-size: 0.95rem; font-weight: 600; }
    .error-msg {
      background: var(--bg-destructive, #2d1215); border: 1px solid var(--border-destructive, #7f1d1d);
      border-radius: var(--radius-md, 6px); color: var(--text-destructive, #fca5a5);
      padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .loading { text-align: center; padding: 2rem; color: var(--text-muted, #525252); }
    .period-selector {
      display: flex; gap: 0.5rem; align-items: center; margin-bottom: 1rem;
    }
    .period-selector label { font-size: 0.8rem; color: var(--text-secondary, #a3a3a3); }
    .period-selector input {
      padding: 0.35rem 0.5rem; background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626); border-radius: var(--radius-md, 6px);
      color: var(--text, #e5e5e5); font-size: 0.8rem; outline: none;
    }
    .period-selector input:focus { border-color: var(--accent, #3b82f6); }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private summary: UsageSummary | null = null;
  @state() private quota: QuotaInfo | null = null;
  @state() private loading = false;
  @state() private error = "";
  private msgTimer?: ReturnType<typeof setTimeout>;
  @state() private startDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  })();
  @state() private endDate = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  private showError(msg: string) {
    this.error = msg;
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.error = ""), 5000);
  }

  connectedCallback() {
    super.connectedCallback();
    this.loadData();
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private async loadData() {
    this.loading = true;
    this.error = "";
    try {
      const [summaryResult, quotaResult] = await Promise.all([
        this.rpc("tenant.usage.summary", {
          startDate: this.startDate,
          endDate: this.endDate,
        }).catch(() => null),
        this.rpc("tenant.usage.quota").catch(() => null),
      ]);
      this.summary = summaryResult as UsageSummary | null;
      this.quota = quotaResult as QuotaInfo | null;
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "加载使用数据失败");
    } finally {
      this.loading = false;
    }
  }

  private formatNumber(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
    return String(n);
  }

  private quotaClass(pct: number | null): string {
    if (pct === null) return "low";
    if (pct > 90) return "high";
    if (pct > 70) return "mid";
    return "low";
  }

  render() {
    if (this.loading) return html`<div class="loading">加载中...</div>`;

    return html`
      <div class="header">
        <h2>使用量统计</h2>
        <button class="btn btn-outline" @click=${() => this.loadData()}>刷新</button>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}

      <div class="period-selector">
        <label>统计区间:</label>
        <date-picker .value=${this.startDate} locale="zh-CN" .max=${this.endDate}
          @change=${(e: CustomEvent) => { this.startDate = e.detail.value; this.loadData(); }}></date-picker>
        <span style="color:var(--text-muted)">至</span>
        <date-picker .value=${this.endDate} locale="zh-CN" .min=${this.startDate}
          @change=${(e: CustomEvent) => { this.endDate = e.detail.value; this.loadData(); }}></date-picker>
      </div>

      ${this.quota ? html`
        <div class="section">
          <h3>配额使用</h3>
          <div class="stats-grid">
            <div class="stat-card">
              <div class="stat-label">月度配额</div>
              <div class="stat-value">${this.quota.monthlyTokenLimit ? this.formatNumber(this.quota.monthlyTokenLimit) : "无限制"}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">已使用</div>
              <div class="stat-value">${this.formatNumber(this.quota.usedTokens)}</div>
              ${this.quota.usagePercent !== null ? html`
                <div class="stat-sub">${this.quota.usagePercent.toFixed(1)}%</div>
                <div class="quota-bar">
                  <div class="quota-fill ${this.quotaClass(this.quota.usagePercent)}"
                    style="width:${Math.min(100, this.quota.usagePercent)}%"></div>
                </div>
              ` : nothing}
            </div>
            <div class="stat-card">
              <div class="stat-label">剩余</div>
              <div class="stat-value">${this.quota.remainingTokens !== null ? this.formatNumber(this.quota.remainingTokens) : "无限制"}</div>
            </div>
          </div>
        </div>
      ` : nothing}

      ${this.summary ? html`
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总 Token 数</div>
            <div class="stat-value">${this.formatNumber(this.summary.totalTokens)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">输入 Token</div>
            <div class="stat-value">${this.formatNumber(this.summary.totalInputTokens)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">输出 Token</div>
            <div class="stat-value">${this.formatNumber(this.summary.totalOutputTokens)}</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">请求次数</div>
            <div class="stat-value">${this.formatNumber(this.summary.requestCount)}</div>
          </div>
        </div>
      ` : html`
        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">总 Token 数</div>
            <div class="stat-value">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">输入 Token</div>
            <div class="stat-value">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">输出 Token</div>
            <div class="stat-value">-</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">请求次数</div>
            <div class="stat-value">-</div>
          </div>
        </div>
      `}
    `;
  }
}
