/**
 * Tenant overview dashboard — enterprise-level summary with charts.
 *
 * Mirrors the platform overview visual style (echarts) but scoped to a single tenant.
 * Layout:
 * 1. Tenant info bar (name, plan, status, slug, admin)
 * 2. Summary cards (4): Agents, Channels, Users, Token
 * 3. Token usage trend (echarts line chart, 7d/30d)
 * 4. Two-col: Model distribution pie + Agent token bar chart
 * 5. Two-col: Channel status + User activity
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { t, I18nController } from "../../../i18n/index.ts";
import { tenantRpc } from "./rpc.ts";
import { CHANNEL_ICON_MAP } from "../../../constants/channels.ts";
import * as echarts from "echarts";

// ── Types ──

interface TenantInfo {
  name: string; plan: string; status: string; slug: string; createdAt: string; admin: string;
}
interface Summary {
  tenant: TenantInfo;
  agents: { total: number; active: number; active30d: number };
  channels: { total: number; active: number; apps: number };
  models: { total: number; providers: number };
  users: { total: number; active30d: number; newThisWeek: number };
  tokens: { all: number; month: number; today: number; quota: number; lastMonth: number };
}
interface TrendItem { date: string; inputTokens: number; outputTokens: number }
interface RankItem { name: string; sub?: string; tokens: number }
interface RankData { users: RankItem[]; agents: RankItem[]; models: Array<{ model: string; tokens: number; percent: number }> }
interface LlmStats { turns: number; avgDurationMs: number; errorRate: number; modelDistribution: Array<{ model: string; count: number; percent: number }> }
interface ChannelDist { type: string; count: number }
interface RecentTrace { agentName: string; userName: string; model: string; tokens: number; createdAt: string }

// ── Component ──

@customElement("tenant-overview-view")
export class TenantOverviewView extends LitElement {
  private i18nCtrl = new I18nController(this);

  static styles = css`
    :host {
      display: block; padding: 1.5rem;
      color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    .page-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem; }
    .page-header h2 { margin: 0; font-size: 1.1rem; font-weight: 600; }
    .btn { padding: 0.45rem 0.9rem; border: none; border-radius: var(--radius-md, 6px); font-size: 0.85rem; cursor: pointer; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.85; }
    .btn-outline { background: transparent; border: 1px solid var(--border, #262626); color: var(--text, #e5e5e5); }

    /* ── Tenant bar ── */
    .tenant-bar {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 0.85rem 1.25rem; margin-bottom: 1rem;
      display: flex; flex-wrap: wrap; gap: 0.4rem 1.5rem; align-items: center; font-size: 0.82rem;
    }
    .tenant-name { font-size: 1rem; font-weight: 700; }
    .plan-badge { font-size: 0.7rem; padding: 0.1rem 0.45rem; border-radius: 9999px; background: rgba(59,130,246,0.15); color: var(--accent, #3b82f6); font-weight: 600; text-transform: uppercase; }
    .status-active { color: #22c55e; font-size: 0.75rem; }
    .bar-label { color: var(--text-muted, #525252); font-size: 0.75rem; }

    /* ── Summary cards ── */
    .summary-row { display: grid; grid-template-columns: repeat(5, 1fr); gap: 1rem; margin-bottom: 1.5rem; }
    .summary-card { background: var(--card, #141414); border: 1px solid var(--border, #262626); border-radius: var(--radius-lg, 8px); padding: 1.25rem; }
    .summary-label { font-size: 0.8rem; color: var(--text-secondary, #a3a3a3); margin-bottom: 0.35rem; }
    .summary-value { font-size: 1.6rem; font-weight: 700; }
    .summary-sub { font-size: 0.75rem; color: var(--text-muted, #525252); margin-top: 0.25rem; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; }
    .status-dot.ok { background: #22c55e; }

    /* ── Section card ── */
    .section { background: var(--card, #141414); border: 1px solid var(--border, #262626); border-radius: var(--radius-lg, 8px); padding: 1.25rem; margin-bottom: 1rem; }
    .section-title { font-size: 0.95rem; font-weight: 600; margin: 0 0 1rem; }
    .section-subtitle { font-size: 0.75rem; color: var(--text-muted, #525252); margin-left: 0.5rem; font-weight: 400; }

    /* ── Chart ── */
    .chart-container { width: 100%; height: 280px; }
    .chart-sm { width: 100%; height: 220px; }

    /* ── Two column ── */
    .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-bottom: 1rem; }

    /* ── Period tabs ── */
    .period-tabs { display: flex; gap: 0.25rem; }
    .period-tab { padding: 0.25rem 0.65rem; border: 1px solid var(--border, #262626); border-radius: 9999px; background: transparent; color: var(--text-muted, #525252); font-size: 0.72rem; cursor: pointer; }
    .period-tab.active { background: var(--accent, #3b82f6); border-color: var(--accent, #3b82f6); color: white; }

    /* ── Rank list (matches platform overview) ── */
    .rank-block-title { font-size: 0.82rem; font-weight: 600; margin: 0 0 0.5rem; }
    .rank-list { list-style: none; margin: 0; padding: 0; }
    .rank-item { display: flex; align-items: center; padding: 0.55rem 0; border-bottom: 1px solid var(--border, #1a1a1a); font-size: 0.85rem; }
    .rank-item:last-child { border-bottom: none; }
    .rank-index {
      width: 22px; height: 22px;
      display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; font-weight: 600; margin-right: 0.75rem; flex-shrink: 0;
    }
    .rank-index img { width: 22px; height: 22px; }
    .rank-index.other { border-radius: 50%; background: var(--border, #262626); color: var(--text-muted, #525252); }
    .rank-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .rank-sub { font-size: 0.75rem; color: var(--text-muted, #525252); margin-left: 0.25rem; }
    .rank-value { font-weight: 600; font-variant-numeric: tabular-nums; }
    .rank-bar-bg { display: block; width: 80px; height: 4px; background: rgba(255,255,255,0.06); border-radius: 2px; margin-left: 0.75rem; overflow: hidden; flex-shrink: 0; }
    .rank-bar-fill { display: block; height: 100%; border-radius: 2px; background: linear-gradient(90deg, #3b82f6, #60a5fa); transition: width 0.4s ease; }
    .rank-empty { text-align: center; padding: 2rem 0; color: var(--text-muted, #525252); font-size: 0.8rem; }
    .three-col { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 1rem; }
    .rank-block { background: var(--bg, #0a0a0a); border-radius: var(--radius-md, 6px); padding: 1rem; }

    /* ── LLM stats ── */
    .llm-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .llm-stats { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; }
    .llm-stat-card { background: var(--bg, #0a0a0a); border-radius: var(--radius-md, 6px); padding: 0.85rem; text-align: center; }
    .llm-stat-value { font-size: 1.3rem; font-weight: 700; }
    .llm-stat-value.error { color: #ef4444; }
    .llm-stat-label { font-size: 0.72rem; color: var(--text-muted, #525252); margin-top: 0.2rem; }

    /* ── Channel list ── */
    .channel-list { display: grid; gap: 0.5rem; }
    .channel-item { display: flex; align-items: center; gap: 0.75rem; padding: 0.55rem 0.75rem; background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626); border-radius: var(--radius-md, 6px); font-size: 0.82rem; }
    .channel-icon { width: 18px; height: 18px; flex-shrink: 0; }
    .channel-icon img { width: 100%; height: 100%; object-fit: contain; }
    .channel-letter { width: 18px; height: 18px; border-radius: 50%; background: var(--border, #262626); display: grid; place-items: center; font-size: 0.55rem; font-weight: 600; color: var(--text-secondary, #a3a3a3); }
    .channel-info { flex: 1; }
    .channel-meta { font-size: 0.72rem; color: var(--text-muted, #525252); }
    .conn-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .conn-dot.ok { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
    .conn-dot.partial { background: #eab308; }
    .conn-dot.off { background: #525252; }

    /* ── Recent activity ── */
    .activity-list { display: grid; gap: 0; max-height: 220px; overflow-y: auto; overflow-x: hidden; padding-right: 0.5rem; }
    .activity-item {
      display: flex; align-items: center; justify-content: space-between; gap: 0.75rem;
      padding: 0.5rem 0; border-bottom: 1px solid var(--border, #1a1a1a);
      font-size: 0.8rem;
    }
    .activity-item:last-child { border-bottom: none; }
    .activity-info { flex: 1; min-width: 0; }
    .activity-main { color: var(--text-secondary, #a3a3a3); word-break: break-all; }
    .activity-time { font-size: 0.72rem; color: var(--text-muted, #525252); flex-shrink: 0; white-space: nowrap; }

    .empty { text-align: center; padding: 2rem; color: var(--text-muted, #525252); font-size: 0.8rem; }
    .loading { text-align: center; padding: 3rem; color: var(--text-muted, #525252); }
  `;

  @property({ type: String }) gatewayUrl = "";

  @state() private loading = true;
  @state() private summary: Summary | null = null;
  @state() private trend: TrendItem[] = [];
  @state() private rank: RankData | null = null;
  @state() private llmStats: LlmStats | null = null;
  @state() private channelDist: ChannelDist[] = [];
  @state() private recentTraces: RecentTrace[] = [];
  @state() private period: "7d" | "30d" = "7d";
  @state() private rankPeriod: "all" | "month" | "today" = "all";
  @state() private llmPeriod: "all" | "month" | "today" = "all";

  private trendChart: echarts.ECharts | null = null;
  private llmPieChart: echarts.ECharts | null = null;
  private channelPieChart: echarts.ECharts | null = null;
  private resizeObserver: ResizeObserver | null = null;

  connectedCallback() {
    super.connectedCallback();
    void this.loadAll();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.trendChart?.dispose();
    this.llmPieChart?.dispose();
    this.channelPieChart?.dispose();
    this.resizeObserver?.disconnect();
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private async loadAll() {
    // Dispose chart instances before reload — DOM may change based on data
    this.trendChart?.dispose(); this.trendChart = null;
    this.llmPieChart?.dispose(); this.llmPieChart = null;
    this.channelPieChart?.dispose(); this.channelPieChart = null;
    this.loading = true;
    try {
      const [summary, trend, rank, llm, channelDist, traces] = await Promise.allSettled([
        this.rpc("tenant.overview.summary"),
        this.rpc("tenant.overview.trend", { period: this.period }),
        this.rpc("tenant.overview.rank", { period: this.rankPeriod }),
        this.rpc("tenant.overview.llm", { period: this.llmPeriod }),
        this.rpc("tenant.overview.channelDistribution"),
        this.rpc("tenant.overview.recentTraces"),
      ]);
      this.summary = summary.status === "fulfilled" ? summary.value as Summary : null;
      this.trend = trend.status === "fulfilled" ? (trend.value as { items: TrendItem[] }).items ?? [] : [];
      this.rank = rank.status === "fulfilled" ? rank.value as RankData : null;
      this.llmStats = llm.status === "fulfilled" ? llm.value as LlmStats : null;
      this.channelDist = channelDist.status === "fulfilled" ? (channelDist.value as { channels: ChannelDist[] }).channels ?? [] : [];
      this.recentTraces = traces.status === "fulfilled" ? (traces.value as { traces: RecentTrace[] }).traces ?? [] : [];
    } catch {
      // All APIs failed, summary stays null
    } finally {
      this.loading = false;
    }
  }

  private fmt(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
    return String(n);
  }

  private fmtTime(iso: string | null): string {
    if (!iso) return "-";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 60_000) return t("tenantOverview.justNow");
    if (diff < 3600_000) return t("tenantOverview.minutesAgo", { n: String(Math.floor(diff / 60_000)) });
    if (diff < 86400_000) return t("tenantOverview.hoursAgo", { n: String(Math.floor(diff / 3600_000)) });
    return new Date(iso).toLocaleDateString();
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("period")) { void this.loadTrend(); }
    if (changed.has("rankPeriod")) { void this.loadRank(); }
    if (changed.has("llmPeriod")) { void this.loadLlm(); }
    // Init charts if not yet created (e.g. after loading state clears)
    if (!this.trendChart) this.initTrendChart();
    if (!this.llmPieChart) this.initLlmPieChart();
    if (!this.channelPieChart) this.initChannelPieChart();
    this.updateTrendChart();
    this.updateLlmPieChart();
    this.updateChannelPieChart();
  }

  private async loadTrend() {
    try {
      this.trendChart?.dispose(); this.trendChart = null;
      const res = await this.rpc("tenant.overview.trend", { period: this.period });
      this.trend = ((res as any).items ?? []) as TrendItem[];
    } catch { this.trend = []; }
  }

  private async loadRank() {
    try {
      const res = await this.rpc("tenant.overview.rank", { period: this.rankPeriod });
      this.rank = res as RankData;
    } catch { this.rank = null; }
  }

  private async loadLlm() {
    try {
      this.llmPieChart?.dispose(); this.llmPieChart = null;
      const res = await this.rpc("tenant.overview.llm", { period: this.llmPeriod });
      this.llmStats = res as LlmStats;
    } catch { this.llmStats = null; }
  }

  // ── Trend line chart ──
  private initTrendChart() {
    const el = this.shadowRoot?.querySelector(".trend-chart") as HTMLElement | null;
    if (!el) return;
    this.trendChart = echarts.init(el, "dark");
    this.updateTrendChart();
    this.resizeObserver = new ResizeObserver(() => {
      this.trendChart?.resize();
      this.modelPieChart?.resize();
      this.agentBarChart?.resize();
    });
    this.resizeObserver.observe(el);
  }

  private updateTrendChart() {
    if (!this.trendChart || this.trend.length === 0) return;
    const data = this.trend;
    this.trendChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis", axisPointer: { type: "none" },
        backgroundColor: "#141414", borderColor: "#262626",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
      },
      legend: {
        data: [t("tenantOverview.inputToken"), t("tenantOverview.outputToken")],
        top: 0, textStyle: { color: "#a3a3a3", fontSize: 12 },
        icon: "circle", itemWidth: 10, itemHeight: 10, itemStyle: { borderWidth: 0 },
      },
      grid: { left: 12, right: 12, top: 36, bottom: 8, containLabel: true },
      xAxis: {
        type: "category", data: data.map(d => d.date), boundaryGap: false,
        axisLine: { lineStyle: { color: "#262626" } },
        axisLabel: { color: "#a3a3a3", fontSize: 12 }, axisTick: { show: false },
      },
      yAxis: {
        type: "value", splitLine: { show: false }, axisLine: { show: false },
        axisLabel: { color: "#a3a3a3", fontSize: 12, formatter: (v: number) => v >= 1000 ? (v / 1000).toFixed(0) + "K" : String(v) },
      },
      series: [
        {
          name: t("tenantOverview.inputToken"), type: "line", data: data.map(d => d.inputTokens),
          smooth: true, symbol: "circle", symbolSize: 6,
          itemStyle: { color: "#3b82f6" }, lineStyle: { width: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(59,130,246,0.25)" }, { offset: 1, color: "rgba(59,130,246,0.02)" },
          ])},
        },
        {
          name: t("tenantOverview.outputToken"), type: "line", data: data.map(d => d.outputTokens),
          smooth: true, symbol: "circle", symbolSize: 6,
          itemStyle: { color: "#22c55e" }, lineStyle: { width: 2 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: "rgba(34,197,94,0.25)" }, { offset: 1, color: "rgba(34,197,94,0.02)" },
          ])},
        },
      ],
    });
  }

  // ── LLM model distribution pie ──
  private initLlmPieChart() {
    const el = this.shadowRoot?.querySelector(".llm-pie-chart") as HTMLElement | null;
    if (!el) return;
    this.llmPieChart = echarts.init(el, "dark");
    this.updateLlmPieChart();
    this.resizeObserver?.observe(el);
  }

  private updateLlmPieChart() {
    if (!this.llmPieChart) return;
    const colors = ["#60a5fa", "#4ade80", "#facc15", "#a78bfa", "#fb923c"];
    const data = this.llmStats?.modelDistribution ?? [];
    this.llmPieChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item", backgroundColor: "#141414", borderColor: "#262626",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
        formatter: (p: any) => `${p.name}<br/>${t("tenantOverview.calls")}: ${p.value}<br/>${p.percent}%`,
      },
      legend: {
        orient: "vertical", right: 10, top: "center",
        textStyle: { color: "#a3a3a3", fontSize: 12 },
        icon: "circle", itemWidth: 10, itemHeight: 10, itemGap: 12, itemStyle: { borderWidth: 0 },
      },
      color: colors,
      series: [{
        type: "pie", radius: "70%", center: ["35%", "50%"],
        avoidLabelOverlap: true, itemStyle: { borderWidth: 0 },
        label: { show: false }, emphasis: { label: { show: false }, scaleSize: 6 },
        data: data.length > 0 ? data.map((m, i) => ({
          name: m.model, value: m.count, itemStyle: { color: colors[i % colors.length] },
        })) : [],
      }],
    }, true);
  }

  // ── Channel distribution pie ──
  private initChannelPieChart() {
    const el = this.shadowRoot?.querySelector(".channel-pie-chart") as HTMLElement | null;
    if (!el) return;
    this.channelPieChart = echarts.init(el, "dark");
    this.updateChannelPieChart();
    this.resizeObserver?.observe(el);
  }

  private updateChannelPieChart() {
    if (!this.channelPieChart) return;
    const colors = ["#60a5fa", "#4ade80", "#facc15", "#a78bfa", "#fb923c"];
    const data = this.channelDist;
    this.channelPieChart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item", backgroundColor: "#141414", borderColor: "#262626",
        textStyle: { color: "#e5e5e5", fontSize: 12 },
        formatter: (p: any) => `${p.name}<br/>${t("tenantOverview.count")}: ${p.value}<br/>${p.percent}%`,
      },
      legend: {
        orient: "vertical", right: 10, top: "center",
        textStyle: { color: "#a3a3a3", fontSize: 12 },
        icon: "circle", itemWidth: 10, itemHeight: 10, itemGap: 12, itemStyle: { borderWidth: 0 },
      },
      color: colors,
      series: [{
        type: "pie", radius: "70%", center: ["35%", "50%"],
        avoidLabelOverlap: true, itemStyle: { borderWidth: 0 },
        label: { show: false }, emphasis: { label: { show: false }, scaleSize: 6 },
        data: data.length > 0 ? data.map((c, i) => ({
          name: c.type, value: c.count, itemStyle: { color: colors[i % colors.length] },
        })) : [],
      }],
    }, true);
  }

  private rankClass(i: number): string {
    if (i === 0) return "top1";
    if (i === 1) return "top2";
    if (i === 2) return "top3";
    return "other";
  }

  private rankIcon(i: number) {
    const medals = ["/gold-medal.svg", "/silver-medal.svg", "/bronze-medal.svg"];
    return i < 3 ? html`<img src="${medals[i]}" alt="top${i + 1}">` : html`${i + 1}`;
  }

  private renderRankList(items: Array<{ name: string; sub?: string; tokens: number }>) {
    if (items.length === 0) return html`<div class="rank-empty">${t("tenantOverview.noData")}</div>`;
    const maxVal = items[0]?.tokens || 1;
    return html`
      <ul class="rank-list">
        ${items.slice(0, 5).map((item, i) => html`
          <li class="rank-item">
            <span class="rank-index ${this.rankClass(i)}">${this.rankIcon(i)}</span>
            <span class="rank-name">${item.name}${item.sub ? html`<span class="rank-sub">${item.sub}</span>` : nothing}</span>
            <span class="rank-value">${this.fmt(item.tokens)}</span>
            <span class="rank-bar-bg"><span class="rank-bar-fill" style="width:${Math.round((item.tokens / maxVal) * 100)}%"></span></span>
          </li>
        `)}
      </ul>
    `;
  }

  render() {
    if (this.loading) return html`<div class="loading">${t("tenantOverview.loading")}</div>`;
    if (!this.summary) return html`<div class="empty">${t("tenantOverview.noData")}</div>`;
    const s = this.summary;

    return html`
      <div class="page-header">
        <h2>${t("tenantOverview.title")}</h2>
        <button class="btn btn-outline" @click=${() => this.loadAll()}>${t("tenantOverview.refresh")}</button>
      </div>

      <!-- Summary cards (5 columns) -->
      ${(() => {
        const monthDiff = s.tokens.lastMonth > 0 ? (s.tokens.month - s.tokens.lastMonth) / s.tokens.lastMonth * 100 : 0;
        const monthDiffText = s.tokens.lastMonth > 0 ? `${monthDiff >= 0 ? "+" : ""}${monthDiff.toFixed(1)}%` : "-";
        const monthDiffColor = monthDiff < 0 ? "#ef4444" : "#22c55e";
        return html`
      <div class="summary-row">
        <div class="summary-card">
          <div class="summary-label">${t("tenantOverview.totalAgents")}</div>
          <div class="summary-value">${s.agents.total}</div>
          <div class="summary-sub">${t("tenantOverview.enabled")}: ${s.agents.active} / ${t("tenantOverview.active30d")}: ${s.agents.active30d}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">${t("tenantOverview.totalChannels")}</div>
          <div class="summary-value">${s.channels.total}</div>
          <div class="summary-sub">${t("tenantOverview.apps")}: ${s.channels.apps}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">${t("tenantOverview.totalModels")}</div>
          <div class="summary-value">${s.models.total}</div>
          <div class="summary-sub">${t("tenantOverview.providers")}: ${s.models.providers}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">${t("tenantOverview.totalUsers")}</div>
          <div class="summary-value">${s.users.total}</div>
          <div class="summary-sub">${t("tenantOverview.active30d")}: ${s.users.active30d}</div>
        </div>
        <div class="summary-card">
          <div class="summary-label">${t("tenantOverview.monthToken")} <span class="plan-badge">${s.tenant.plan}</span></div>
          <div class="summary-value">${this.fmt(s.tokens.month)}</div>
          <div class="summary-sub">${t("tenantOverview.vsLastMonth")}: <span style="color:${monthDiffColor}">${monthDiffText}</span></div>
        </div>
      </div>`;
      })()}

      <!-- Token trend -->
      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:0.5rem">
          <h3 class="section-title" style="margin:0">${t("tenantOverview.tokenTrend")}</h3>
          <div class="period-tabs">
            <button class="period-tab ${this.period === "7d" ? "active" : ""}" @click=${() => { this.period = "7d"; }}>${t("tenantOverview.last7d")}</button>
            <button class="period-tab ${this.period === "30d" ? "active" : ""}" @click=${() => { this.period = "30d"; }}>${t("tenantOverview.last30d")}</button>
          </div>
        </div>
        ${this.trend.length > 0
          ? html`<div class="trend-chart chart-container"></div>`
          : html`<div class="chart-container" style="display:grid;place-items:center;color:var(--text-muted,#525252);font-size:0.8rem">${t("tenantOverview.noData")}</div>`}
      </div>

      <!-- Token ranking (3 columns) -->
      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 class="section-title" style="margin:0">${t("tenantOverview.tokenRank")}</h3>
          <div class="period-tabs">
            <button class="period-tab ${this.rankPeriod === "all" ? "active" : ""}" @click=${() => { this.rankPeriod = "all"; }}>${t("tenantOverview.periodAll")}</button>
            <button class="period-tab ${this.rankPeriod === "month" ? "active" : ""}" @click=${() => { this.rankPeriod = "month"; }}>${t("tenantOverview.periodMonth")}</button>
            <button class="period-tab ${this.rankPeriod === "today" ? "active" : ""}" @click=${() => { this.rankPeriod = "today"; }}>${t("tenantOverview.periodToday")}</button>
          </div>
        </div>
        <div class="three-col">
          <div class="rank-block">
            <h4 class="rank-block-title">${t("tenantOverview.userRank")}</h4>
            ${this.renderRankList(this.rank?.users ?? [])}
          </div>
          <div class="rank-block">
            <h4 class="rank-block-title">${t("tenantOverview.agentRank")}</h4>
            ${this.renderRankList(this.rank?.agents ?? [])}
          </div>
          <div class="rank-block">
            <h4 class="rank-block-title">${t("tenantOverview.modelRank")}</h4>
            ${this.renderRankList((this.rank?.models ?? []).map(m => ({ name: m.model, sub: `${m.percent}%`, tokens: m.tokens })))}
          </div>
        </div>
      </div>

      <!-- LLM interaction overview (full width) -->
      <div class="section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
          <h3 class="section-title" style="margin:0">${t("tenantOverview.llmOverview")}</h3>
          <div class="period-tabs">
            <button class="period-tab ${this.llmPeriod === "all" ? "active" : ""}" @click=${() => { this.llmPeriod = "all"; }}>${t("tenantOverview.periodAll")}</button>
            <button class="period-tab ${this.llmPeriod === "month" ? "active" : ""}" @click=${() => { this.llmPeriod = "month"; }}>${t("tenantOverview.periodMonth")}</button>
            <button class="period-tab ${this.llmPeriod === "today" ? "active" : ""}" @click=${() => { this.llmPeriod = "today"; }}>${t("tenantOverview.periodToday")}</button>
          </div>
        </div>
        <div class="llm-layout">
          <div>
            <div class="llm-stats" style="grid-template-columns:repeat(2,1fr)">
              <div class="llm-stat-card">
                <div class="llm-stat-value">${this.llmStats?.turns ?? "-"}</div>
                <div class="llm-stat-label">${t("tenantOverview.conversationTurns")}</div>
              </div>
              <div class="llm-stat-card">
                <div class="llm-stat-value">${this.llmStats ? parseFloat((this.llmStats.avgDurationMs / 1000).toFixed(1)) + "s" : "-"}</div>
                <div class="llm-stat-label">${t("tenantOverview.avgResponse")}</div>
              </div>
              <div class="llm-stat-card">
                <div class="llm-stat-value error">${this.llmStats ? parseFloat(this.llmStats.errorRate.toFixed(1)) + "%" : "-"}</div>
                <div class="llm-stat-label">${t("tenantOverview.errorRate")}</div>
              </div>
              <div class="llm-stat-card">
                <div class="llm-stat-value">${this.llmStats?.modelDistribution?.length ?? "-"}</div>
                <div class="llm-stat-label">${t("tenantOverview.modelsInUse")}</div>
              </div>
            </div>
          </div>
          <div>
            ${(this.llmStats?.modelDistribution?.length ?? 0) > 0
              ? html`<div class="llm-pie-chart chart-sm"></div>`
              : html`<div class="chart-sm" style="display:grid;place-items:center;color:var(--text-muted,#525252);font-size:0.8rem">${t("tenantOverview.noData")}</div>`}
          </div>
        </div>
      </div>

      <!-- Channel distribution + Recent activity -->
      <div class="two-col">
        <div class="section">
          <h3 class="section-title">${t("tenantOverview.channelDist")}</h3>
          ${this.channelDist.length > 0
            ? html`<div class="channel-pie-chart chart-sm"></div>`
            : html`<div class="chart-sm" style="display:grid;place-items:center;color:var(--text-muted,#525252);font-size:0.8rem">${t("tenantOverview.noData")}</div>`}
        </div>
        <div class="section">
          <h3 class="section-title">${t("tenantOverview.recentActivity")}</h3>
          ${this.recentTraces.length > 0 ? html`
            <div class="activity-list">
              ${this.recentTraces.slice(0, 10).map(tr => html`
                <div class="activity-item">
                  <div class="activity-info">
                    <div class="activity-main">${tr.userName || "-"} ${t("tenantOverview.usedModel", { agent: tr.agentName || "-", model: tr.model || "-" })}，${t("tenantOverview.cost")} ${this.fmt(tr.tokens)} tokens</div>
                  </div>
                  <span class="activity-time">${this.fmtTime(tr.createdAt)}</span>
                </div>
              `)}
            </div>
          ` : html`<div class="empty">${t("tenantOverview.noData")}</div>`}
        </div>
      </div>
    `;
  }
}
