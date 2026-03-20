/**
 * Tenant settings view — manage enterprise name, slug, and identity prompt.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { tenantRpc } from "./rpc.ts";

@customElement("tenant-settings-view")
export class TenantSettingsView extends LitElement {
  static styles = css`
    :host {
      display: block;
      padding: 1.5rem;
      color: var(--text, #e5e5e5);
      font-family: var(--font-sans, system-ui, sans-serif);
    }
    h2 { margin: 0 0 1.5rem; font-size: 1.1rem; font-weight: 600; }
    .card {
      background: var(--card, #141414);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px);
      padding: 1.25rem;
      margin-bottom: 1.5rem;
    }
    .form-field {
      margin-bottom: 1rem;
    }
    .form-field label {
      display: block;
      font-size: 0.8rem;
      margin-bottom: 0.3rem;
      color: var(--text-secondary, #a3a3a3);
    }
    .form-field input, .form-field textarea {
      width: 100%;
      padding: 0.45rem 0.65rem;
      background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px);
      color: var(--text, #e5e5e5);
      font-size: 0.85rem;
      outline: none;
      box-sizing: border-box;
      font-family: inherit;
    }
    .form-field input:focus, .form-field textarea:focus {
      border-color: var(--accent, #3b82f6);
    }
    .form-field textarea {
      min-height: 120px;
      resize: vertical;
    }
    .form-field .hint {
      font-size: 0.75rem;
      color: var(--text-muted, #525252);
      margin-top: 0.25rem;
    }
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
    .loading { text-align: center; padding: 2rem; color: var(--text-muted, #525252); }
    .actions { margin-top: 1rem; }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private loading = false;
  @state() private saving = false;
  @state() private error = "";
  @state() private success = "";
  private msgTimer?: ReturnType<typeof setTimeout>;
  @state() private name = "";
  @state() private slug = "";
  @state() private identityPrompt = "";
  @state() private memoryContent = "";
  @state() private memorySaving = false;
  @state() private memorySuccess = "";

  connectedCallback() {
    super.connectedCallback();
    this.loadSettings();
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

  private async loadSettings() {
    this.loading = true;
    this.error = "";
    try {
      const result = await this.rpc("tenant.settings.get") as {
        name: string;
        slug: string;
        identityPrompt: string;
      };
      this.name = result.name ?? "";
      this.slug = result.slug ?? "";
      this.identityPrompt = result.identityPrompt ?? "";
      // Load memory content
      try {
        const memResult = await this.rpc("tenant.memory.get") as { content: string };
        this.memoryContent = memResult.content ?? "";
      } catch {
        // Memory may not be available yet
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "加载设置失败");
    } finally {
      this.loading = false;
    }
  }

  private async handleSave(e: Event) {
    e.preventDefault();
    if (!this.name.trim()) {
      this.showError("企业名称不能为空");
      return;
    }
    if (!this.slug.trim()) {
      this.showError("企业标识不能为空");
      return;
    }
    this.saving = true;
    this.error = "";
    this.success = "";
    try {
      await this.rpc("tenant.settings.update", {
        name: this.name.trim(),
        slug: this.slug.trim(),
        identityPrompt: this.identityPrompt,
      });
      this.showSuccess("设置已保存");
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "保存失败");
    } finally {
      this.saving = false;
    }
  }

  private async handleMemorySave() {
    this.memorySaving = true;
    this.error = "";
    this.memorySuccess = "";
    try {
      await this.rpc("tenant.memory.update", { content: this.memoryContent });
      this.showSuccess("企业记忆已保存");
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "保存企业记忆失败");
    } finally {
      this.memorySaving = false;
    }
  }

  render() {
    if (this.loading) {
      return html`<div class="loading">加载中...</div>`;
    }

    return html`
      <h2>企业设置</h2>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}
      ${this.success ? html`<div class="success-msg">${this.success}</div>` : nothing}

      <form @submit=${this.handleSave}>
        <div class="card">
          <div class="form-field">
            <label>企业名称</label>
            <input type="text" required
              .value=${this.name}
              @input=${(e: InputEvent) => (this.name = (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>企业标识 (slug)</label>
            <input type="text" required pattern="[a-z0-9][a-z0-9_-]*[a-z0-9]"
              .value=${this.slug}
              @input=${(e: InputEvent) => (this.slug = (e.target as HTMLInputElement).value)} />
            <div class="hint">小写字母、数字、连字符和下划线</div>
          </div>
          <div class="form-field">
            <label>企业身份描述</label>
            <textarea
              placeholder="描述企业的身份特征，例如：我们是XX科技有限公司，主营XX业务..."
              .value=${this.identityPrompt}
              @input=${(e: InputEvent) => (this.identityPrompt = (e.target as HTMLTextAreaElement).value)}
            ></textarea>
            <div class="hint">该内容将作为所有 AI 助手的企业上下文注入到系统提示中</div>
          </div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="submit" ?disabled=${this.saving}>
            ${this.saving ? "保存中..." : "保存设置"}
          </button>
        </div>
      </form>

      ${/* 企业记忆配置入口暂时隐藏，后端功能保留 */ false ? html`
      <h2>企业记忆</h2>
      ${this.memorySuccess ? html`<div class="success-msg">${this.memorySuccess}</div>` : nothing}
      <div class="card">
        <div class="form-field">
          <label>MEMORY.md</label>
          <textarea
            style="min-height: 200px; font-family: monospace; font-size: 0.8rem;"
            placeholder="AI 助手会在对话中自动记录重要的企业信息到此处。&#10;你也可以手动编辑维护。&#10;&#10;格式示例：&#10;# Enterprise Memory&#10;&#10;- 公司主营业务为XX&#10;- 技术栈使用 React + Node.js&#10;- 合作方接口文档在 wiki.example.com"
            .value=${this.memoryContent}
            @input=${(e: InputEvent) => (this.memoryContent = (e.target as HTMLTextAreaElement).value)}
          ></textarea>
          <div class="hint">该内容由 AI 助手自动维护，也可手动编辑。将作为企业上下文注入到所有 AI 对话中。</div>
        </div>
        <div class="actions">
          <button class="btn btn-primary" type="button" ?disabled=${this.memorySaving}
            @click=${this.handleMemorySave}>
            ${this.memorySaving ? "保存中..." : "保存记忆"}
          </button>
        </div>
      </div>
      ` : nothing}
    `;
  }
}
