/**
 * AI Customer Service — Session records view.
 *
 * Lists all CS sessions for the tenant with visitor info, state, and timestamps.
 * Click a row to expand and view the message thread.
 *
 * AI 客服会话记录页面。
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { I18nController } from "../../../i18n/index.ts";
import { tenantRpc } from "./rpc.ts";
import { loadAuth } from "../../auth-store.ts";
import { caretFix } from "../../shared-styles.ts";

interface CSMessage {
  id: string;
  role: "customer" | "ai" | "boss" | "system";
  content: string;
  createdAt: string;
}

interface CSSession {
  id: string;
  visitorId: string;
  visitorName: string | null;
  state: "ai_active" | "human_active";
  channel: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  lastMessage: { role: string; content: string } | null;
}

const STATE_LABEL: Record<string, string> = {
  ai_active: "AI 处理中",
  human_active: "人工介入",
};

const STATE_COLOR: Record<string, string> = {
  ai_active: "#1a7f37",
  human_active: "#9a6700",
};

const CHANNEL_LABEL: Record<string, string> = {
  web_widget: "Web 窗口",
  feishu:     "飞书",
  wechat:     "微信",
  telegram:   "Telegram",
};

const ROLE_LABEL: Record<string, string> = {
  customer: "访客",
  ai: "🤖 AI",
  boss: "👔 人工",
  system: "系统",
};

@customElement("cs-sessions-view")
export class CSSessionsView extends LitElement {
  static styles = [
    caretFix,
    css`
      :host { display: block; }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }

      .toolbar h2 {
        margin: 0;
        font-size: 16px;
        font-weight: 600;
        flex: 1;
      }

      .btn {
        padding: 6px 14px;
        border-radius: 6px;
        font-size: 13px;
        cursor: pointer;
        border: 1px solid var(--color-border, #e1e4e8);
        background: var(--color-bg-secondary, #f6f8fa);
        font-weight: 500;
        white-space: nowrap;
      }

      .btn:hover { background: var(--color-bg-hover, #eaeef2); }

      .session-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 14px;
      }

      .session-table th {
        text-align: left;
        padding: 8px 12px;
        font-weight: 600;
        border-bottom: 2px solid var(--color-border, #e1e4e8);
        color: var(--color-text-secondary, #6a737d);
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      .session-table td {
        padding: 10px 12px;
        border-bottom: 1px solid var(--color-border, #e1e4e8);
        vertical-align: top;
      }

      .session-row { cursor: pointer; transition: background 0.1s; }
      .session-row:hover td { background: var(--color-bg-secondary, #f6f8fa); }
      .session-row.expanded td { background: var(--color-bg-secondary, #f6f8fa); }

      .visitor-name { font-weight: 500; }
      .visitor-id {
        font-size: 11px;
        font-family: monospace;
        color: var(--color-text-secondary, #6a737d);
        margin-top: 2px;
      }

      .channel-tag {
        display: inline-block;
        padding: 2px 7px;
        border-radius: 4px;
        font-size: 11px;
        font-weight: 500;
        background: var(--color-bg-secondary, #f6f8fa);
        border: 1px solid var(--color-border, #e1e4e8);
        color: var(--color-text-secondary, #6a737d);
      }

      .last-msg-preview {
        font-size: 12px;
        color: var(--color-text-secondary, #6a737d);
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        max-width: 200px;
        line-height: 1.4;
        margin-top: 3px;
      }

      .state-badge {
        display: inline-block;
        padding: 2px 8px;
        border-radius: 12px;
        font-size: 11px;
        font-weight: 600;
        border: 1px solid currentColor;
      }

      .date-cell {
        font-size: 12px;
        color: var(--color-text-secondary, #6a737d);
        white-space: nowrap;
      }

      .expand-icon {
        font-size: 11px;
        color: var(--color-text-secondary, #6a737d);
        transition: transform 0.15s;
      }

      .expand-icon.open { transform: rotate(90deg); display: inline-block; }

      /* Message thread panel */
      .thread-row td {
        padding: 0;
        background: var(--color-bg, #fff);
        border-bottom: 2px solid var(--color-border, #e1e4e8);
      }

      .thread-panel {
        padding: 16px 20px;
        max-height: 400px;
        overflow-y: auto;
      }

      .msg {
        margin-bottom: 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .msg-header {
        font-size: 11px;
        font-weight: 600;
        color: var(--color-text-secondary, #6a737d);
      }

      .msg-content {
        background: var(--color-bg-secondary, #f6f8fa);
        border-radius: 6px;
        padding: 8px 12px;
        font-size: 13px;
        line-height: 1.5;
        max-width: 80%;
      }

      .msg.customer .msg-content {
        background: var(--color-accent-muted, #ddf4ff);
      }

      .msg-loading {
        color: var(--color-text-secondary, #6a737d);
        font-size: 13px;
        padding: 8px 0;
      }

      .empty-state {
        text-align: center;
        padding: 40px 20px;
        color: var(--color-text-secondary, #6a737d);
        font-size: 14px;
      }

      .loading {
        text-align: center;
        padding: 32px;
        color: var(--color-text-secondary, #6a737d);
        font-size: 14px;
      }

      .error-msg {
        color: var(--color-danger, #cf222e);
        font-size: 13px;
        margin-top: 8px;
      }

      .load-more {
        margin-top: 16px;
        text-align: center;
      }
    `,
  ];

  @state() private sessions: CSSession[] = [];
  @state() private loading = false;
  @state() private error: string | null = null;
  @state() private expandedId: string | null = null;
  @state() private messages: Record<string, CSMessage[]> = {};
  @state() private messagesLoading: string | null = null;
  @state() private offset = 0;
  @state() private hasMore = true;
  /** Tab toggle: "sessions" (default list) vs "badcase" (low-confidence replies). */
  /** 视图切换：会话列表 / 低置信问题（Badcase）列表。 */
  @state() private activeTab: "sessions" | "badcase" = "sessions";
  @state() private badcaseEntries: Array<{
    aiMessage: { id: string; content: string; createdAt: string | Date; confidence: { verdict: string; score: number } | null };
    customerMessage: { content: string } | null;
    visitorName: string | null;
  }> = [];
  @state() private badcaseLoading = false;

  private readonly PAGE_SIZE = 30;
  private _i18n = new I18nController(this);

  private get tenantId(): string | undefined {
    return loadAuth()?.user?.tenantId;
  }

  connectedCallback() {
    super.connectedCallback();
    void this._loadSessions(true);
  }

  private async _loadSessions(reset = false) {
    const tenantId = this.tenantId;
    if (!tenantId) return;
    if (reset) { this.offset = 0; this.sessions = []; }
    this.loading = true;
    this.error = null;
    try {
      const result = await tenantRpc("cs.sessions.list", {
        tenantId,
        limit: this.PAGE_SIZE,
        offset: this.offset,
      }) as { sessions: CSSession[] };
      const newSessions = result.sessions ?? [];
      this.sessions = reset ? newSessions : [...this.sessions, ...newSessions];
      this.hasMore = newSessions.length === this.PAGE_SIZE;
      this.offset += newSessions.length;
    } catch (err) {
      this.error = err instanceof Error ? err.message : "加载失败";
    } finally {
      this.loading = false;
    }
  }

  private async _toggleSession(sessionId: string) {
    if (this.expandedId === sessionId) {
      this.expandedId = null;
      return;
    }
    this.expandedId = sessionId;
    if (!this.messages[sessionId]) {
      await this._loadMessages(sessionId);
    }
  }

  private async _loadMessages(sessionId: string) {
    this.messagesLoading = sessionId;
    try {
      const result = await tenantRpc("cs.session.messages", { sessionId, limit: 100 }) as { messages: CSMessage[] };
      this.messages = { ...this.messages, [sessionId]: result.messages ?? [] };
    } catch (err) {
      this.messages = { ...this.messages, [sessionId]: [] };
    } finally {
      this.messagesLoading = null;
    }
  }

  /**
   * Load low-confidence AI replies (Badcase queue).
   * 加载低置信 AI 回复（运营 Badcase 队列）。
   */
  private async _loadBadcases() {
    const tenantId = this.tenantId;
    if (!tenantId) return;
    this.badcaseLoading = true;
    this.error = null;
    try {
      const result = (await tenantRpc("cs.admin.listLowConfidence", {
        tenantId,
        limit: 50,
      })) as { entries: CSSessionsView["badcaseEntries"] };
      this.badcaseEntries = result.entries ?? [];
    } catch (err) {
      this.error = err instanceof Error ? err.message : "加载失败";
    } finally {
      this.badcaseLoading = false;
    }
  }

  private _switchTab(tab: "sessions" | "badcase") {
    this.activeTab = tab;
    if (tab === "badcase" && this.badcaseEntries.length === 0) {
      void this._loadBadcases();
    }
  }

  private _formatDate(iso: string): string {
    try {
      return new Date(iso).toLocaleString("zh-CN", { hour12: false });
    } catch {
      return iso;
    }
  }

  private _renderThread(session: CSSession) {
    const msgs = this.messages[session.id];
    return html`
      <tr class="thread-row">
        <td colspan="7">
          <div class="thread-panel">
            ${this.messagesLoading === session.id
              ? html`<p class="msg-loading">加载消息中…</p>`
              : msgs?.length
                ? msgs.map((m) => html`
                    <div class="msg ${m.role}">
                      <div class="msg-header">
                        ${ROLE_LABEL[m.role] ?? m.role}
                        · ${this._formatDate(m.createdAt)}
                      </div>
                      <div class="msg-content">${m.content}</div>
                    </div>
                  `)
                : html`<p class="msg-loading">暂无消息记录</p>`
            }
          </div>
        </td>
      </tr>
    `;
  }

  render() {
    return html`
      <div class="toolbar">
        <h2>AI 客服</h2>
        <div style="display:flex;gap:8px;margin-left:16px">
          <button
            class="btn ${this.activeTab === "sessions" ? "btn-primary" : ""}"
            style="${this.activeTab === "sessions" ? "background:#0969da;color:#fff" : ""}"
            @click=${() => this._switchTab("sessions")}
          >会话记录</button>
          <button
            class="btn ${this.activeTab === "badcase" ? "btn-primary" : ""}"
            style="${this.activeTab === "badcase" ? "background:#cf222e;color:#fff" : ""}"
            @click=${() => this._switchTab("badcase")}
          >低置信问题 ${this.badcaseEntries.length > 0 ? html`<span style="background:rgba(255,255,255,0.3);padding:1px 6px;border-radius:8px;font-size:11px;margin-left:4px">${this.badcaseEntries.length}</span>` : nothing}</button>
        </div>
        <div style="flex:1"></div>
        <button class="btn" @click=${() => this.activeTab === "sessions" ? this._loadSessions(true) : this._loadBadcases()}>刷新</button>
      </div>

      ${this.error ? html`<p class="error-msg">${this.error}</p>` : nothing}

      ${this.activeTab === "badcase" ? this._renderBadcaseTab() : this._renderSessionsTab()}
    `;
  }

  private _renderBadcaseTab() {
    if (this.badcaseLoading) {
      return html`<div class="loading">加载中…</div>`;
    }
    if (this.badcaseEntries.length === 0) {
      return html`<div class="empty-state">暂无低置信问题（AI 回答质量良好 ✓）</div>`;
    }
    return html`
      <div style="padding:8px 0">
        <p style="color:#6a737d;font-size:12px;margin:8px 0 16px">
          这里展示置信度门控触发兜底或转人工的 AI 回复。可据此补充知识库或调整 prompt。
        </p>
        ${this.badcaseEntries.map((entry) => {
          const verdict = entry.aiMessage.confidence?.verdict ?? "unknown";
          const score = entry.aiMessage.confidence?.score?.toFixed(2) ?? "—";
          const verdictColor = verdict === "suspect_badcase" ? "#cf222e" : "#bf8700";
          const verdictLabel = verdict === "knowledge_gap" ? "知识盲区" : verdict === "suspect_badcase" ? "可疑错误" : verdict;
          return html`
            <div style="border:1px solid #e1e4e8;border-radius:6px;padding:12px;margin-bottom:10px;background:#fff">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <div style="display:flex;gap:8px;align-items:center">
                  <span style="background:${verdictColor};color:#fff;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">${verdictLabel}</span>
                  <span style="color:#6a737d;font-size:12px">score: ${score}</span>
                  <span style="color:#6a737d;font-size:12px">访客: ${entry.visitorName ?? "匿名"}</span>
                </div>
                <span style="color:#6a737d;font-size:11px">${this._formatDate(typeof entry.aiMessage.createdAt === "string" ? entry.aiMessage.createdAt : entry.aiMessage.createdAt.toISOString())}</span>
              </div>
              ${entry.customerMessage ? html`
                <div style="margin:6px 0">
                  <span style="color:#6a737d;font-size:12px">问：</span>
                  <span style="color:#24292f">${entry.customerMessage.content}</span>
                </div>
              ` : nothing}
              <div style="margin:6px 0">
                <span style="color:#6a737d;font-size:12px">答：</span>
                <span style="color:#24292f">${entry.aiMessage.content}</span>
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }

  private _renderSessionsTab() {
    return html`
      ${this.loading && this.sessions.length === 0
        ? html`<div class="loading">加载中…</div>`
        : !this.error && this.sessions.length === 0
          ? html`<div class="empty-state">暂无客服会话记录</div>`
          : this.sessions.length > 0 ? html`
            <table class="session-table">
              <thead>
                <tr>
                  <th></th>
                  <th>访客</th>
                  <th>渠道</th>
                  <th>状态</th>
                  <th>最后发言</th>
                  <th>发起时间</th>
                  <th>最近活动</th>
                </tr>
              </thead>
              <tbody>
                ${this.sessions.map((s) => {
                  const lastRole = s.lastMessage?.role ?? null;
                  const needsAttention = !s.closedAt && lastRole === "customer";
                  return html`
                  <tr
                    class="session-row ${this.expandedId === s.id ? "expanded" : ""}"
                    @click=${() => this._toggleSession(s.id)}
                  >
                    <td>
                      <span class="expand-icon ${this.expandedId === s.id ? "open" : ""}">▶</span>
                    </td>
                    <td>
                      <div class="visitor-name">${s.visitorName ?? "匿名访客"}</div>
                      <div class="visitor-id">${s.visitorId.slice(0, 16)}…</div>
                    </td>
                    <td>
                      <span class="channel-tag">
                        ${CHANNEL_LABEL[s.channel] ?? s.channel}
                      </span>
                    </td>
                    <td>
                      <span
                        class="state-badge"
                        style="color: ${STATE_COLOR[s.state] ?? "#555"}"
                      >${STATE_LABEL[s.state] ?? s.state}</span>
                      ${s.closedAt ? html`<br><span style="font-size:11px;color:#6a737d">已关闭</span>` : nothing}
                    </td>
                    <td>
                      ${s.lastMessage ? html`
                        ${needsAttention
                          ? html`<span style="color:#cf222e;font-size:11px;font-weight:600">● 待回复</span>`
                          : html`<span style="color:#6a737d;font-size:11px">● 已回复</span>`
                        }
                        <div class="last-msg-preview">${s.lastMessage.content}</div>
                      ` : html`<span style="font-size:11px;color:#aaa">—</span>`}
                    </td>
                    <td class="date-cell">${this._formatDate(s.createdAt)}</td>
                    <td class="date-cell">${this._formatDate(s.updatedAt)}</td>
                  </tr>
                  ${this.expandedId === s.id ? this._renderThread(s) : nothing}
                `;})}

              </tbody>
            </table>

            ${this.hasMore
              ? html`
                <div class="load-more">
                  <button class="btn" ?disabled=${this.loading} @click=${() => this._loadSessions(false)}>
                    ${this.loading ? "加载中…" : "加载更多"}
                  </button>
                </div>`
              : nothing
            }
          ` : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cs-sessions-view": CSSessionsView;
  }
}
