/**
 * AI Customer Service floating chat widget.
 *
 * A Lit Web Component that renders a floating chat bubble in the bottom-right
 * corner of the page. Clicking opens a chat panel that connects to the CS
 * backend via cs.widget.connect / cs.widget.send RPC.
 *
 * Visitor identity: anonymous UUID stored in localStorage (key: ec_cs_visitor_id).
 * Tenant: derived from the currently logged-in admin user's tenantId.
 *
 * AI 客服悬浮聊天 Widget。
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { tenantRpc, tenantRpcStream } from "../views/tenant/rpc.ts";
import { loadAuth } from "../auth-store.ts";
import { generateUUID } from "../uuid.ts";

const VISITOR_ID_KEY = "ec_cs_visitor_id";
const VISITOR_TOKEN_KEY = "ec_cs_visitor_token";

interface CSMsg {
  id: string;
  role: "customer" | "ai" | "boss" | "system";
  text: string;
  roleLabel: string;
  pending?: boolean;
  /** true while the LLM is streaming this message (shows typewriter cursor). */
  streaming?: boolean;
  /** Matches cs-delta event streamId so partial replies can update the right bubble. */
  streamId?: string;
  /**
   * Clarification option buttons (knowledge_gap + ambiguous path).
   * Clicking sends the option text as a new customer message.
   * 模糊追问选项按钮（知识盲区 + 问题不明确时），点击即发送对应选项文本。
   */
  clarifyOptions?: string[];
}

function getOrCreateVisitorId(): string {
  let id = localStorage.getItem(VISITOR_ID_KEY);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(VISITOR_ID_KEY, id);
  }
  return id;
}

@customElement("cs-widget")
export class CSWidget extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 9999;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    /* Bubble button */
    .bubble {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: var(--cs-bubble-bg, #0969da);
      color: #fff;
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: transform 0.15s, box-shadow 0.15s;
      outline: none;
    }

    .bubble:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 16px rgba(0,0,0,0.25);
    }

    /* Unread badge */
    .unread-badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #cf222e;
      color: #fff;
      border-radius: 50%;
      width: 18px;
      height: 18px;
      font-size: 11px;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    /* Chat panel */
    .panel {
      position: absolute;
      bottom: 64px;
      right: 0;
      width: 340px;
      height: 480px;
      background: var(--cs-panel-bg, #fff);
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.18);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid var(--color-border, #e1e4e8);
      animation: slideUp 0.18s ease-out;
    }

    @keyframes slideUp {
      from { opacity: 0; transform: translateY(12px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .panel-header {
      background: var(--cs-header-bg, #0969da);
      color: #fff;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .panel-header .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
    }

    .panel-header .title { font-weight: 600; font-size: 14px; flex: 1; }
    .panel-header .subtitle { font-size: 11px; opacity: 0.8; }

    .close-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.8);
      cursor: pointer;
      font-size: 18px;
      line-height: 1;
      padding: 0 4px;
    }

    .close-btn:hover { color: #fff; }

    /* Messages area */
    .messages {
      flex: 1;
      overflow-y: auto;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .msg-wrap {
      display: flex;
      flex-direction: column;
      gap: 3px;
    }

    .msg-wrap.customer { align-items: flex-end; }
    .msg-wrap.ai, .msg-wrap.boss, .msg-wrap.system { align-items: flex-start; }

    .msg-role {
      font-size: 11px;
      color: var(--color-text-secondary, #6a737d);
      font-weight: 500;
      padding: 0 4px;
    }

    .msg-bubble {
      max-width: 80%;
      padding: 8px 12px;
      border-radius: 12px;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-word;
    }

    .msg-wrap.customer .msg-bubble {
      background: var(--cs-header-bg, #0969da);
      color: #fff;
      border-bottom-right-radius: 4px;
    }

    .msg-wrap.ai .msg-bubble,
    .msg-wrap.boss .msg-bubble {
      background: var(--color-bg-secondary, #f6f8fa);
      color: var(--color-text, #1c1c1e);
      border: 1px solid var(--color-border, #e1e4e8);
      border-bottom-left-radius: 4px;
    }

    .msg-wrap.system .msg-bubble {
      background: none;
      color: var(--color-text-secondary, #6a737d);
      font-size: 12px;
      text-align: center;
      border: none;
    }

    .msg-bubble.pending { opacity: 0.6; }

    /* Typing indicator */
    .typing-dot {
      display: inline-flex;
      gap: 4px;
      padding: 8px 12px;
      background: var(--color-bg-secondary, #f6f8fa);
      border: 1px solid var(--color-border, #e1e4e8);
      border-radius: 12px;
      border-bottom-left-radius: 4px;
    }

    .typing-dot span {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--color-text-secondary, #6a737d);
      animation: typing 1.2s infinite;
    }

    .typing-dot span:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot span:nth-child(3) { animation-delay: 0.4s; }

    @keyframes typing {
      0%, 60%, 100% { opacity: 0.3; transform: scale(0.85); }
      30% { opacity: 1; transform: scale(1); }
    }

    /* Streaming typewriter cursor */
    .stream-cursor {
      display: inline-block;
      width: 2px;
      height: 0.9em;
      background: currentColor;
      margin-left: 2px;
      vertical-align: text-bottom;
      animation: blink 1s step-end infinite;
    }

    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }

    /* Clarification option buttons (knowledge_gap + ambiguous) */
    .clarify-options {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }

    .clarify-btn {
      background: var(--cs-panel-bg, #fff);
      border: 1px solid var(--cs-header-bg, #0969da);
      color: var(--cs-header-bg, #0969da);
      border-radius: 6px;
      padding: 4px 10px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.12s, color 0.12s;
      font-family: inherit;
    }

    .clarify-btn:hover {
      background: var(--cs-header-bg, #0969da);
      color: #fff;
    }

    /* Input area */
    .input-area {
      border-top: 1px solid var(--color-border, #e1e4e8);
      padding: 10px 12px;
      display: flex;
      gap: 8px;
      align-items: flex-end;
      flex-shrink: 0;
      background: var(--cs-panel-bg, #fff);
    }

    .input-area textarea {
      flex: 1;
      border: 1px solid var(--color-border, #e1e4e8);
      border-radius: 8px;
      padding: 8px 10px;
      font-size: 13px;
      font-family: inherit;
      resize: none;
      max-height: 96px;
      min-height: 36px;
      line-height: 1.4;
      outline: none;
      background: var(--color-bg, #fff);
      color: var(--color-text, #1c1c1e);
    }

    .input-area textarea:focus {
      border-color: var(--cs-header-bg, #0969da);
    }

    .send-btn {
      background: var(--cs-header-bg, #0969da);
      color: #fff;
      border: none;
      border-radius: 8px;
      width: 36px;
      height: 36px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      font-size: 16px;
      transition: opacity 0.15s;
    }

    .send-btn:hover { opacity: 0.85; }
    .send-btn:disabled { opacity: 0.4; cursor: not-allowed; }

    .connect-error {
      margin: 12px 14px;
      padding: 10px 12px;
      background: #fff0f0;
      border: 1px solid #ffc1c1;
      border-radius: 6px;
      font-size: 12px;
      color: #cf222e;
      text-align: center;
    }

    .connecting {
      margin: auto;
      text-align: center;
      color: var(--color-text-secondary, #6a737d);
      font-size: 13px;
    }
  `;

  @property({ type: Boolean }) open = false;

  /** For external embed: override tenantId instead of reading from loadAuth(). */
  @property({ attribute: "tenant-id" }) tenantIdOverride?: string;

  /** Channel label, forwarded to cs.widget.connect. Default: "default". */
  @property() channel = "default";

  /** For external embed: WebSocket gateway URL override. */
  @property({ attribute: "gateway-url" }) gatewayUrlOverride?: string;

  @state() private messages: CSMsg[] = [];
  @state() private inputText = "";
  @state() private sending = false;
  @state() private connecting = false;
  @state() private connectError: string | null = null;
  @state() private sessionId: string | null = null;
  @state() private unread = 0;

  private _visitorId = getOrCreateVisitorId();
  /** HMAC token issued by server on connect, stored in localStorage for subsequent requests. */
  private _visitorToken: string | null = localStorage.getItem(VISITOR_TOKEN_KEY);
  /** Cancel function for the active streaming RPC connection, if any. */
  private _cancelStream: (() => void) | null = null;

  private get tenantId(): string | undefined {
    // Priority: explicit attribute → logged-in user → server-injected meta tag (for guest access).
    // Using <meta name="ec-cs-tenant-id"> instead of inline script to comply with CSP script-src 'self'.
    // 优先级：显式属性 → 登录用户 → 服务端注入的 <meta> 标签（CSP 兼容，支持游客使用）。
    return (
      this.tenantIdOverride ??
      loadAuth()?.user?.tenantId ??
      (typeof document !== "undefined"
        ? (document.querySelector('meta[name="ec-cs-tenant-id"]') as HTMLMetaElement | null)?.content || undefined
        : undefined)
    );
  }

  private async _connect() {
    const tenantId = this.tenantId;
    if (!tenantId) {
      this.connectError = "未检测到租户，请先登录";
      return;
    }
    this.connecting = true;
    this.connectError = null;
    try {
      const result = await tenantRpc("cs.widget.connect", {
        tenantId,
        visitorId: this._visitorId,
        channel: this.channel,
      }) as { sessionId: string; token?: string; messages: Array<{ id: string; role: string; content: string }> };

      // Persist the server-issued token for authenticating future requests.
      // 持久化服务端下发的 token，用于后续请求鉴权。
      if (result.token) {
        this._visitorToken = result.token;
        localStorage.setItem(VISITOR_TOKEN_KEY, result.token);
      }

      this.sessionId = result.sessionId;
      // Load history
      this.messages = (result.messages ?? []).map((m) => ({
        id: m.id,
        role: m.role as CSMsg["role"],
        text: m.content,
        roleLabel: this._roleLabel(m.role as CSMsg["role"]),
      }));
      this._scrollToBottom();
    } catch (_err) {
      this.connectError = "客服服务暂时不可用，请稍后再试";
    } finally {
      this.connecting = false;
    }
  }

  private _roleLabel(role: CSMsg["role"]): string {
    const labels: Record<string, string> = {
      customer: "我",
      ai: "🤖 AI 助手",
      boss: "👔 人工客服",
      system: "系统",
    };
    return labels[role] ?? role;
  }

  private async _togglePanel() {
    this.open = !this.open;
    if (this.open) {
      this.unread = 0;
      if (!this.sessionId && !this.connecting) {
        await this._connect();
      }
      await this.updateComplete;
      this._scrollToBottom();
    }
  }

  private _sendMessage() {
    const text = this.inputText.trim();
    // Allow sending even without sessionId — session is created lazily on first message.
    // 允许在 sessionId 为空时发送，session 由后端在首条消息时按需创建。
    if (!text || this.sending) return;
    const tenantId = this.tenantId;
    if (!tenantId) return;

    this.messages = [
      ...this.messages,
      { id: `tmp-${Date.now()}`, role: "customer", text, roleLabel: "我" },
    ];
    this.inputText = "";
    this.sending = true;
    this._scrollToBottom();

    const typingId = `typing-${Date.now()}`;
    this.messages = [
      ...this.messages,
      { id: typingId, role: "ai", text: "", roleLabel: "🤖 AI 助手", pending: true },
    ];
    this._scrollToBottom();

    // Cancel any in-progress stream before starting a new one.
    // 发新消息前取消上一个未完成的流式连接。
    this._cancelStream?.();
    this._cancelStream = tenantRpcStream(
      "cs.widget.send",
      {
        tenantId,
        visitorId: this._visitorId,
        ...(this._visitorToken ? { token: this._visitorToken } : {}),
        text,
      },
      {
        onAck: (ack) => {
          const p = ack as Record<string, unknown>;
          if (p?.sessionId && !this.sessionId) this.sessionId = p.sessionId as string;

          if (p?.streamId) {
            // Streaming mode: tag the typing bubble with streamId so cs-delta events
            // can update the right message. 流式模式：给等待气泡打上 streamId 标签。
            this.messages = this.messages.map((m) =>
              m.id === typingId
                ? { ...m, streamId: p.streamId as string, streaming: true }
                : m,
            );
          } else {
            // Direct fallback (no connId on server): payload has the full reply.
            // 直接回复模式（服务端无 connId）：ACK 即包含完整回复。
            const role = ((p?.role as string) ?? "ai") as CSMsg["role"];
            this.messages = [
              ...this.messages.filter((m) => m.id !== typingId),
              {
                id: (p?.messageId as string) ?? `ai-${Date.now()}`,
                role,
                text: (p?.text as string) ?? "",
                roleLabel: (p?.roleLabel as string) ?? "🤖 AI 助手",
                clarifyOptions: p?.clarifyOptions as string[] | undefined,
              },
            ];
            if (!this.open) this.unread++;
            this.sending = false;
            this._scrollToBottom();
          }
        },
        onEvent: (event, rawPayload) => {
          if (event === "cs-delta") {
            const delta = rawPayload as {
              streamId: string;
              text?: string;
              done: boolean;
              messageId?: string;
              roleLabel?: string;
              error?: boolean;
            };

            if (delta.error) {
              this.messages = [
                ...this.messages.filter(
                  (m) => m.streamId !== delta.streamId && m.id !== typingId,
                ),
                { id: `err-${Date.now()}`, role: "system", text: "AI 回复失败，请重试", roleLabel: "系统" },
              ];
              this.sending = false;
              this._scrollToBottom();
              return true; // close WS
            }

            if (delta.done) {
              // Final frame: replace streaming bubble with completed message.
              // 最终帧：将流式气泡替换为完整消息。
              this.messages = this.messages.map((m) =>
                m.streamId === delta.streamId || m.id === typingId
                  ? {
                      id: delta.messageId ?? m.id,
                      role: "ai" as CSMsg["role"],
                      text: delta.text ?? m.text,
                      roleLabel: delta.roleLabel ?? m.roleLabel,
                      streaming: false,
                      clarifyOptions: (delta as any).clarifyOptions as string[] | undefined,
                    }
                  : m,
              );
              if (!this.open) this.unread++;
              this.sending = false;
              this._scrollToBottom();
              return true; // close WS
            }

            // Partial chunk: update accumulated text, switch from typing dots to text.
            // 片段帧：更新累积文本，从等待动画切换为文字显示。
            this.messages = this.messages.map((m) =>
              m.streamId === delta.streamId || m.id === typingId
                ? { ...m, text: delta.text ?? m.text, pending: false, streaming: true }
                : m,
            );
            this._scrollToBottom();
            return false;
          }

          if (event === "error" || event === "timeout") {
            this.messages = [
              ...this.messages.filter((m) => m.id !== typingId && !m.streamId),
              { id: `err-${Date.now()}`, role: "system", text: "发送失败，请重试", roleLabel: "系统" },
            ];
            this.sending = false;
            this._scrollToBottom();
            return true;
          }
          return false;
        },
        timeoutMs: 60_000,
      },
    );
  }

  /**
   * Send a clarification option as a new customer message.
   * Removes the option buttons once one is selected.
   * 发送澄清选项，选择后移除该消息的选项按钮（避免重复点击）。
   */
  private _sendClarifyOption(msgId: string, option: string) {
    // Remove clarify buttons from the source message to prevent double-send.
    this.messages = this.messages.map((m) =>
      m.id === msgId ? { ...m, clarifyOptions: undefined } : m,
    );
    this.inputText = option;
    this._sendMessage();
  }

  private _onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void this._sendMessage();
    }
  }

  private _scrollToBottom() {
    requestAnimationFrame(() => {
      const el = this.shadowRoot?.querySelector(".messages");
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private _renderMessage(msg: CSMsg) {
    // Show typing dots only while pending and no text yet (before first chunk).
    // 仅在 pending 且尚无文本时显示等待动画（首个片段到达前）。
    if (msg.pending && !msg.text) {
      return html`
        <div class="msg-wrap ai">
          <div class="msg-role">${msg.roleLabel}</div>
          <div class="typing-dot">
            <span></span><span></span><span></span>
          </div>
        </div>
      `;
    }
    if (msg.role === "system" && !msg.text) return nothing;
    return html`
      <div class="msg-wrap ${msg.role}">
        ${msg.role !== "customer" ? html`<div class="msg-role">${msg.roleLabel}</div>` : nothing}
        <div class="msg-bubble">
          ${msg.text}${msg.streaming ? html`<span class="stream-cursor"></span>` : nothing}
        </div>
        ${msg.clarifyOptions && msg.clarifyOptions.length > 0
          ? html`
            <div class="clarify-options">
              ${msg.clarifyOptions.map((opt) => html`
                <button
                  class="clarify-btn"
                  ?disabled=${this.sending}
                  @click=${() => this._sendClarifyOption(msg.id, opt)}
                >${opt}</button>
              `)}
            </div>`
          : nothing}
        ${msg.role === "customer" ? html`<div class="msg-role">${msg.roleLabel}</div>` : nothing}
      </div>
    `;
  }

  render() {
    return html`
      <div style="position:relative">
        <!-- Bubble toggle button -->
        <button class="bubble" @click=${this._togglePanel} title="AI 客服">
          ${this.open ? "✕" : "💬"}
        </button>
        ${this.unread > 0 && !this.open
          ? html`<div class="unread-badge">${this.unread}</div>`
          : nothing}

        <!-- Chat panel -->
        ${this.open ? html`
          <div class="panel">
            <div class="panel-header">
              <div class="avatar">🤖</div>
              <div>
                <div class="title">AI 客服助手</div>
                <div class="subtitle">有问必答，随时为您服务</div>
              </div>
              <button class="close-btn" @click=${this._togglePanel}>✕</button>
            </div>

            ${this.connectError
              ? html`<div class="connect-error">${this.connectError}</div>`
              : this.connecting
                ? html`<div class="messages"><div class="connecting">连接中…</div></div>`
                : html`
                  <div class="messages">
                    ${this.messages.length === 0
                      ? html`
                        <div class="msg-wrap ai">
                          <div class="msg-role">🤖 AI 助手</div>
                          <div class="msg-bubble">你好！我是 AI 客服助手，有什么可以帮您的吗？</div>
                        </div>`
                      : this.messages.map((m) => this._renderMessage(m))
                    }
                  </div>
                  <div class="input-area">
                    <textarea
                      rows="1"
                      placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
                      .value=${this.inputText}
                      @input=${(e: Event) => { this.inputText = (e.target as HTMLTextAreaElement).value; }}
                      @keydown=${this._onKeyDown}
                      ?disabled=${this.sending}
                    ></textarea>
                    <button
                      class="send-btn"
                      ?disabled=${!this.inputText.trim() || this.sending}
                      @click=${this._sendMessage}
                    >↑</button>
                  </div>
                `
            }
          </div>
        ` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "cs-widget": CSWidget;
  }
}
