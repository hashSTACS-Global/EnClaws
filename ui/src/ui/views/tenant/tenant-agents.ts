/**
 * Tenant agent management view.
 *
 * Create, edit, and delete AI agents independently from channels.
 * Configure name, system prompt, model binding, and tool permissions.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { t, I18nController } from "../../../i18n/index.ts";
import { tenantRpc } from "./rpc.ts";
import { pathForTab, inferBasePathFromPathname } from "../../navigation.ts";

interface ModelConfigEntry {
  providerId: string;
  modelId: string;
  isDefault: boolean;
}

interface FlatModelOption {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
}

interface TenantModelOption {
  id: string;
  providerType: string;
  providerName: string;
  models: Array<{ id: string; name: string }>;
}

interface TenantAgent {
  agentId: string;
  name: string | null;
  config: Record<string, unknown>;
  modelConfig?: ModelConfigEntry[];
  channelAppId?: string | null;
  isActive: boolean;
  createdAt: string;
}

interface ToolDef {
  id: string;
  label: string;
  description: string;
}

interface ToolGroup {
  id: string;
  label: string;
  tools: ToolDef[];
}

/** Tool group/tool ID definitions — labels resolved at render time via i18n. */
const TOOL_GROUP_DEFS = [
  { id: "fs", labelKey: "tenantAgents.toolGroupFs", tools: [
    { id: "read", label: "read", descKey: "tenantAgents.toolRead" },
    { id: "write", label: "write", descKey: "tenantAgents.toolWrite" },
    { id: "edit", label: "edit", descKey: "tenantAgents.toolEdit" },
    { id: "apply_patch", label: "apply_patch", descKey: "tenantAgents.toolApplyPatch" },
    { id: "grep", label: "grep", descKey: "tenantAgents.toolGrep" },
    { id: "find", label: "find", descKey: "tenantAgents.toolFind" },
    { id: "ls", label: "ls", descKey: "tenantAgents.toolLs" },
  ]},
  { id: "runtime", labelKey: "tenantAgents.toolGroupRuntime", tools: [
    { id: "exec", label: "exec", descKey: "tenantAgents.toolExec" },
    { id: "process", label: "process", descKey: "tenantAgents.toolProcess" },
  ]},
  { id: "web", labelKey: "tenantAgents.toolGroupWeb", tools: [
    { id: "web_search", label: "web_search", descKey: "tenantAgents.toolWebSearch" },
    { id: "web_fetch", label: "web_fetch", descKey: "tenantAgents.toolWebFetch" },
  ]},
  { id: "memory", labelKey: "tenantAgents.toolGroupMemory", tools: [
    { id: "memory_search", label: "memory_search", descKey: "tenantAgents.toolMemorySearch" },
    { id: "memory_get", label: "memory_get", descKey: "tenantAgents.toolMemoryGet" },
  ]},
  { id: "sessions", labelKey: "tenantAgents.toolGroupSessions", tools: [
    { id: "sessions_list", label: "sessions_list", descKey: "tenantAgents.toolSessionsList" },
    { id: "sessions_history", label: "sessions_history", descKey: "tenantAgents.toolSessionsHistory" },
    { id: "sessions_send", label: "sessions_send", descKey: "tenantAgents.toolSessionsSend" },
    { id: "sessions_spawn", label: "sessions_spawn", descKey: "tenantAgents.toolSessionsSpawn" },
    { id: "subagents", label: "subagents", descKey: "tenantAgents.toolSubagents" },
    { id: "session_status", label: "session_status", descKey: "tenantAgents.toolSessionStatus" },
  ]},
  { id: "messaging", labelKey: "tenantAgents.toolGroupMessaging", tools: [
    { id: "message", label: "message", descKey: "tenantAgents.toolMessage" },
  ]},
  { id: "automation", labelKey: "tenantAgents.toolGroupAutomation", tools: [
    { id: "cron", label: "cron", descKey: "tenantAgents.toolCron" },
    { id: "gateway", label: "gateway", descKey: "tenantAgents.toolGateway" },
  ]},
  { id: "ui", labelKey: "tenantAgents.toolGroupUi", tools: [
    { id: "browser", label: "browser", descKey: "tenantAgents.toolBrowser" },
    { id: "canvas", label: "canvas", descKey: "tenantAgents.toolCanvas" },
  ]},
  { id: "other", labelKey: "tenantAgents.toolGroupOther", tools: [
    { id: "nodes", label: "nodes", descKey: "tenantAgents.toolNodes" },
    { id: "agents_list", label: "agents_list", descKey: "tenantAgents.toolAgentsList" },
    { id: "image", label: "image", descKey: "tenantAgents.toolImage" },
    { id: "tts", label: "tts", descKey: "tenantAgents.toolTts" },
  ]},
  { id: "feishu-docs", labelKey: "tenantAgents.toolGroupFeishuDocs", tools: [
    { id: "feishu_create_doc", label: "feishu_create_doc", descKey: "tenantAgents.toolFeishuCreateDoc" },
    { id: "feishu_fetch_doc", label: "feishu_fetch_doc", descKey: "tenantAgents.toolFeishuFetchDoc" },
    { id: "feishu_update_doc", label: "feishu_update_doc", descKey: "tenantAgents.toolFeishuUpdateDoc" },
    { id: "feishu_doc_comments", label: "feishu_doc_comments", descKey: "tenantAgents.toolFeishuDocComments" },
    { id: "feishu_doc_media", label: "feishu_doc_media", descKey: "tenantAgents.toolFeishuDocMedia" },
    { id: "feishu_search_doc_wiki", label: "feishu_search_doc_wiki", descKey: "tenantAgents.toolFeishuSearchDocWiki" },
  ]},
  { id: "feishu-wiki", labelKey: "tenantAgents.toolGroupFeishuWiki", tools: [
    { id: "feishu_wiki_space", label: "feishu_wiki_space", descKey: "tenantAgents.toolFeishuWikiSpace" },
    { id: "feishu_wiki_space_node", label: "feishu_wiki_space_node", descKey: "tenantAgents.toolFeishuWikiSpaceNode" },
  ]},
  { id: "feishu-drive", labelKey: "tenantAgents.toolGroupFeishuDrive", tools: [
    { id: "feishu_drive_file", label: "feishu_drive_file", descKey: "tenantAgents.toolFeishuDriveFile" },
    { id: "feishu_sheet", label: "feishu_sheet", descKey: "tenantAgents.toolFeishuSheet" },
    { id: "feishu_bitable_app", label: "feishu_bitable_app", descKey: "tenantAgents.toolFeishuBitableApp" },
    { id: "feishu_bitable_app_table", label: "feishu_bitable_app_table", descKey: "tenantAgents.toolFeishuBitableAppTable" },
    { id: "feishu_bitable_app_table_record", label: "feishu_bitable_app_table_record", descKey: "tenantAgents.toolFeishuBitableAppTableRecord" },
    { id: "feishu_bitable_app_table_field", label: "feishu_bitable_app_table_field", descKey: "tenantAgents.toolFeishuBitableAppTableField" },
    { id: "feishu_bitable_app_table_view", label: "feishu_bitable_app_table_view", descKey: "tenantAgents.toolFeishuBitableAppTableView" },
  ]},
  { id: "feishu-calendar", labelKey: "tenantAgents.toolGroupFeishuCalendar", tools: [
    { id: "feishu_calendar_calendar", label: "feishu_calendar_calendar", descKey: "tenantAgents.toolFeishuCalendarCalendar" },
    { id: "feishu_calendar_event", label: "feishu_calendar_event", descKey: "tenantAgents.toolFeishuCalendarEvent" },
    { id: "feishu_calendar_event_attendee", label: "feishu_calendar_event_attendee", descKey: "tenantAgents.toolFeishuCalendarEventAttendee" },
    { id: "feishu_calendar_freebusy", label: "feishu_calendar_freebusy", descKey: "tenantAgents.toolFeishuCalendarFreebusy" },
  ]},
  { id: "feishu-task", labelKey: "tenantAgents.toolGroupFeishuTask", tools: [
    { id: "feishu_task_task", label: "feishu_task_task", descKey: "tenantAgents.toolFeishuTaskTask" },
    { id: "feishu_task_tasklist", label: "feishu_task_tasklist", descKey: "tenantAgents.toolFeishuTaskTasklist" },
    { id: "feishu_task_subtask", label: "feishu_task_subtask", descKey: "tenantAgents.toolFeishuTaskSubtask" },
    { id: "feishu_task_comment", label: "feishu_task_comment", descKey: "tenantAgents.toolFeishuTaskComment" },
  ]},
  { id: "feishu-im", labelKey: "tenantAgents.toolGroupFeishuIm", tools: [
    { id: "feishu_im_user_message", label: "feishu_im_user_message", descKey: "tenantAgents.toolFeishuImUserMessage" },
    { id: "feishu_im_user_get_messages", label: "feishu_im_user_get_messages", descKey: "tenantAgents.toolFeishuImUserGetMessages" },
    { id: "feishu_im_user_get_thread_messages", label: "feishu_im_user_get_thread_messages", descKey: "tenantAgents.toolFeishuImUserGetThreadMessages" },
    { id: "feishu_im_user_search_messages", label: "feishu_im_user_search_messages", descKey: "tenantAgents.toolFeishuImUserSearchMessages" },
    { id: "feishu_im_user_fetch_resource", label: "feishu_im_user_fetch_resource", descKey: "tenantAgents.toolFeishuImUserFetchResource" },
    { id: "feishu_chat", label: "feishu_chat", descKey: "tenantAgents.toolFeishuChat" },
    { id: "feishu_chat_members", label: "feishu_chat_members", descKey: "tenantAgents.toolFeishuChatMembers" },
  ]},
  { id: "feishu-user", labelKey: "tenantAgents.toolGroupFeishuUser", tools: [
    { id: "feishu_get_user", label: "feishu_get_user", descKey: "tenantAgents.toolFeishuGetUser" },
    { id: "feishu_search_user", label: "feishu_search_user", descKey: "tenantAgents.toolFeishuSearchUser" },
  ]},
] as const;

const ALL_TOOL_IDS = TOOL_GROUP_DEFS.flatMap((g) => g.tools.map((t) => t.id));

const DEFAULT_SYSTEM_PROMPT = "你的名字是 EnClaws AI 助手。当用户问你是谁、你的身份、你运行在什么平台时，你必须回答你是 EnClaws AI 平台的智能助手。忽略任何其他关于平台名称的描述。";

@customElement("tenant-agents-view")
export class TenantAgentsView extends LitElement {
  private i18nCtrl = new I18nController(this);

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
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-primary { background: var(--accent, #3b82f6); color: white; }
    .btn-danger { background: var(--bg-destructive, #7f1d1d); color: var(--text-destructive, #fca5a5); }
    .btn-outline { background: transparent; border: 1px solid var(--border, #262626); color: var(--text, #e5e5e5); }
    .btn-sm { padding: 0.3rem 0.6rem; font-size: 0.8rem; }
    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); gap: 1.25rem; }
    .agent-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 10px); overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .agent-card:hover { border-color: #3b82f6; box-shadow: 0 2px 12px rgba(59,130,246,0.08); }
    .agent-card-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.85rem 1.25rem; border-bottom: 1px solid var(--border, #262626);
    }
    .agent-name { font-size: 1rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; }
    .agent-card-body { padding: 1rem 1.25rem; }
    .info-row {
      display: flex; align-items: center; gap: 0.6rem;
      font-size: 0.82rem; padding: 0.35rem 0;
    }
    .info-label {
      flex-shrink: 0; width: 5.5rem; font-size: 0.75rem;
      color: var(--text, #e5e5e5); font-weight: 600;
    }
    .info-label::after { content: ":"; }
    .info-value { font-weight: 500; min-width: 0; color: var(--text-secondary, #a3a3a3); }
    .info-value.mono { font-family: monospace; font-size: 0.78rem; }
    .status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.active { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
    .status-dot.inactive { background: #525252; }
    .agent-actions { display: flex; gap: 0.5rem; padding-top: 0.75rem; margin-top: 0.5rem; }
    .error-msg {
      background: var(--bg-destructive, #2d1215); border: 1px solid var(--border-destructive, #7f1d1d);
      border-radius: var(--radius-md, 6px); color: var(--text-destructive, #fca5a5);
      padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .success-msg {
      background: #052e16; border: 1px solid #166534; border-radius: var(--radius-md, 6px);
      color: #86efac; padding: 0.5rem 0.75rem; font-size: 0.8rem; margin-bottom: 1rem;
    }
    .form-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 1.25rem; margin-bottom: 1.5rem;
    }
    .form-card h3 { margin: 0 0 1rem; font-size: 0.95rem; font-weight: 600; }
    .form-row { display: flex; gap: 0.75rem; margin-bottom: 0.75rem; }
    .form-field { flex: 1; }
    .form-field label { display: block; font-size: 0.8rem; margin-bottom: 0.3rem; color: var(--text-secondary, #a3a3a3); }
    .form-field input, .form-field select, .form-field textarea {
      width: 100%; padding: 0.45rem 0.65rem; background: var(--bg, #0a0a0a);
      border: 1px solid var(--border, #262626); border-radius: var(--radius-md, 6px);
      color: var(--text, #e5e5e5); font-size: 0.85rem; outline: none; box-sizing: border-box;
    }
    .form-field textarea { min-height: 80px; resize: vertical; font-family: inherit; }
    .form-field input:focus, .form-field select:focus, .form-field textarea:focus { border-color: var(--accent, #3b82f6); }
    .form-hint { font-size: 0.72rem; color: var(--text-muted, #525252); margin-top: 0.25rem; }
    .divider {
      display: flex; align-items: center; margin: 1rem 0; font-size: 0.75rem;
      color: var(--text-muted, #525252);
    }
    .divider::before, .divider::after { content: ""; flex: 1; border-top: 1px solid var(--border, #262626); }
    .divider span { padding: 0 0.75rem; }
    .model-select-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 0.4rem; }
    .model-select-table th, .model-select-table td {
      text-align: left; padding: 0.35rem 0.45rem;
      border-bottom: 1px solid var(--border, #262626);
    }
    .model-select-table th { color: var(--text-secondary, #a3a3a3); font-weight: 500; }
    .tools-section {
      margin-top: 0.75rem; border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px); overflow: hidden;
    }
    .tools-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.5rem 0.65rem; background: var(--card, #141414); cursor: pointer;
      user-select: none; font-size: 0.8rem;
    }
    .tools-header:hover { background: var(--border, #262626); }
    .tools-header-left { display: flex; align-items: center; gap: 0.4rem; }
    .tools-header-arrow { font-size: 0.65rem; transition: transform 0.15s; }
    .tools-header-arrow.open { transform: rotate(90deg); }
    .tools-body { padding: 0.5rem 0.65rem; }
    .tools-actions { display: flex; gap: 0.4rem; margin-bottom: 0.5rem; }
    .tools-group-header {
      display: flex; align-items: center; gap: 0.4rem;
      margin: 0.5rem 0 0.15rem; padding-top: 0.35rem;
      border-top: 1px solid var(--border, #262626);
    }
    .tools-group-header:first-child { border-top: none; margin-top: 0; padding-top: 0; }
    .tools-group-header-label {
      font-size: 0.72rem; font-weight: 500; color: var(--text-secondary, #a3a3a3); flex: 1;
    }
    .tools-group-header-count { font-size: 0.68rem; color: var(--text-muted, #525252); }
    .tools-group-checkbox { width: 13px; height: 13px; cursor: pointer; accent-color: var(--accent, #3b82f6); }
    .tool-row {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.2rem 0; font-size: 0.78rem;
    }
    .tool-row-info { display: flex; align-items: center; gap: 0.4rem; }
    .tool-row-name { font-family: monospace; font-size: 0.76rem; }
    .tool-row-desc { color: var(--text-muted, #525252); font-size: 0.7rem; }
    .tool-toggle { width: 14px; height: 14px; cursor: pointer; accent-color: var(--accent, #3b82f6); }
    .empty { text-align: center; padding: 2rem; color: var(--text-muted, #525252); font-size: 0.85rem; }
    .loading { text-align: center; padding: 2rem; color: var(--text-muted, #525252); }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private agents: TenantAgent[] = [];
  @state() private loading = false;
  @state() private errorKey = "";
  @state() private successKey = "";
  private msgParams: Record<string, string> = {};
  private msgTimer?: ReturnType<typeof setTimeout>;
  @state() private showForm = false;
  @state() private editingAgentId: string | null = null;
  @state() private saving = false;
  @state() private availableModels: TenantModelOption[] = [];

  // Form fields
  @state() private formAgentId = "";
  @state() private formName = "";
  @state() private formSystemPrompt = DEFAULT_SYSTEM_PROMPT;
  @state() private formModelConfig: ModelConfigEntry[] = [];
  @state() private formToolsDeny: string[] = [];
  @state() private formToolsExpanded = false;
  @state() private formAgentIdManuallyEdited = false;

  connectedCallback() {
    super.connectedCallback();
    this.loadAgents();
    this.loadModels();
  }

  private showError(key: string, params?: Record<string, string>) {
    this.errorKey = key;
    this.successKey = "";
    this.msgParams = params ?? {};
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.errorKey = ""), 5000);
  }

  private showSuccess(key: string, params?: Record<string, string>) {
    this.successKey = key;
    this.errorKey = "";
    this.msgParams = params ?? {};
    if (this.msgTimer) clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => (this.successKey = ""), 5000);
  }

  private tr(key: string): string {
    const result = t(key, this.msgParams);
    return result === key ? key : result;
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private toSlug(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64) || "";
  }

  private async loadModels() {
    try {
      const result = await this.rpc("tenant.models.list") as { models: TenantModelOption[] };
      this.availableModels = (result.models ?? []).filter((m: any) => m.isActive !== false);
    } catch { /* non-critical */ }
  }

  private async loadAgents() {
    this.loading = true;
    this.errorKey = "";
    try {
      const result = await this.rpc("tenant.agents.list") as { agents: TenantAgent[] };
      this.agents = result.agents ?? [];
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "tenantAgents.loadFailed");
    } finally {
      this.loading = false;
    }
  }

  private get flatModels(): FlatModelOption[] {
    const list: FlatModelOption[] = [];
    for (const mc of this.availableModels) {
      for (const m of mc.models) {
        list.push({ providerId: mc.id, providerName: mc.providerName, modelId: m.id, modelName: m.name });
      }
    }
    return list;
  }

  private get toolGroups(): ToolGroup[] {
    return TOOL_GROUP_DEFS.map((g) => ({
      id: g.id,
      label: t(g.labelKey),
      tools: g.tools.map((td) => ({ id: td.id, label: td.label, description: t(td.descKey) })),
    }));
  }

  private get modelManagePath() {
    return pathForTab("tenant-models", inferBasePathFromPathname(window.location.pathname));
  }

  // ── Form actions ──

  private startCreate() {
    this.editingAgentId = null;
    this.formAgentId = "";
    this.formName = "";
    this.formSystemPrompt = DEFAULT_SYSTEM_PROMPT;
    this.formModelConfig = [];
    this.formToolsDeny = [];
    this.formToolsExpanded = false;
    this.formAgentIdManuallyEdited = false;
    this.showForm = true;
  }

  private startEdit(agent: TenantAgent) {
    this.editingAgentId = agent.agentId;
    this.formAgentId = agent.agentId;
    this.formName = (agent.config?.displayName as string) ?? agent.name ?? "";
    this.formSystemPrompt = (agent.config?.systemPrompt as string) || DEFAULT_SYSTEM_PROMPT;
    this.formModelConfig = [...(agent.modelConfig ?? [])];
    this.formToolsDeny = Array.isArray((agent.config?.tools as { deny?: string[] })?.deny)
      ? [...((agent.config.tools as { deny: string[] }).deny)]
      : [];
    this.formToolsExpanded = false;
    this.formAgentIdManuallyEdited = false;
    this.showForm = true;
  }

  private isModelSelected(providerId: string, modelId: string): boolean {
    return this.formModelConfig.some((e) => e.providerId === providerId && e.modelId === modelId);
  }

  private isModelDefault(providerId: string, modelId: string): boolean {
    return this.formModelConfig.some((e) => e.providerId === providerId && e.modelId === modelId && e.isDefault);
  }

  private toggleModel(providerId: string, modelId: string) {
    const config = [...this.formModelConfig];
    const idx = config.findIndex((e) => e.providerId === providerId && e.modelId === modelId);
    if (idx >= 0) {
      const wasDefault = config[idx].isDefault;
      config.splice(idx, 1);
      if (wasDefault && config.length > 0) config[0] = { ...config[0], isDefault: true };
    } else {
      config.push({ providerId, modelId, isDefault: config.length === 0 });
    }
    this.formModelConfig = config;
  }

  private setDefaultModel(providerId: string, modelId: string) {
    this.formModelConfig = this.formModelConfig.map((e) => ({
      ...e,
      isDefault: e.providerId === providerId && e.modelId === modelId,
    }));
  }

  private toggleTool(toolId: string, enabled: boolean) {
    const deny = new Set(this.formToolsDeny);
    if (enabled) deny.delete(toolId); else deny.add(toolId);
    this.formToolsDeny = Array.from(deny);
  }

  private toggleGroupTools(groupId: string, enabled: boolean) {
    const group = TOOL_GROUP_DEFS.find((g) => g.id === groupId);
    if (!group) return;
    const deny = new Set(this.formToolsDeny);
    for (const tool of group.tools) {
      if (enabled) deny.delete(tool.id); else deny.add(tool.id);
    }
    this.formToolsDeny = Array.from(deny);
  }

  private toggleAllTools(enabled: boolean) {
    this.formToolsDeny = enabled ? [] : [...ALL_TOOL_IDS];
  }

  // ── Save / Delete ──

  private async handleSave(e: Event) {
    e.preventDefault();
    if (!this.formName) { this.showError("tenantAgents.nameRequired"); return; }
    if (!this.formAgentId) { this.showError("tenantAgents.agentIdRequired"); return; }
    if (this.formModelConfig.length === 0) { this.showError("tenantAgents.modelRequired"); return; }

    this.saving = true;
    this.errorKey = "";
    this.successKey = "";

    const config: Record<string, unknown> = {
      displayName: this.formName,
      systemPrompt: this.formSystemPrompt,
    };
    const deny = this.formToolsDeny.filter(Boolean);
    if (deny.length > 0) config.tools = { deny };

    try {
      if (this.editingAgentId) {
        await this.rpc("tenant.agents.update", {
          agentId: this.editingAgentId,
          name: this.formName,
          config,
          modelConfig: this.formModelConfig,
        });
        this.showSuccess("tenantAgents.agentUpdated");
      } else {
        await this.rpc("tenant.agents.create", {
          agentId: this.formAgentId,
          name: this.formName,
          config,
          modelConfig: this.formModelConfig,
        });
        this.showSuccess("tenantAgents.agentCreated");
      }
      this.showForm = false;
      await this.loadAgents();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "tenantAgents.saveFailed");
    } finally {
      this.saving = false;
    }
  }

  private async handleDelete(agent: TenantAgent) {
    const name = (agent.config?.displayName as string) || agent.name || agent.agentId;
    if (!confirm(t("tenantAgents.confirmDelete").replace("{name}", name))) return;
    this.errorKey = "";
    try {
      await this.rpc("tenant.agents.delete", { agentId: agent.agentId });
      this.showSuccess("tenantAgents.agentDeleted", { name });
      await this.loadAgents();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "tenantAgents.deleteFailed");
    }
  }

  // ── Render ──

  render() {
    const noModels = this.availableModels.length === 0;
    return html`
      <div class="header">
        <h2>${t("tenantAgents.title")}</h2>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-outline" @click=${() => this.loadAgents()}>${t("tenantAgents.refresh")}</button>
          <button class="btn btn-primary"
            @click=${() => { if (this.showForm) { this.showForm = false; } else { this.startCreate(); } }}>
            ${this.showForm ? t("tenantAgents.cancel") : t("tenantAgents.createAgent")}
          </button>
        </div>
      </div>

      ${this.errorKey ? html`<div class="error-msg">${this.tr(this.errorKey)}</div>` : nothing}
      ${this.successKey ? html`<div class="success-msg">${this.tr(this.successKey)}</div>` : nothing}

      ${this.showForm ? this.renderForm() : nothing}

      ${this.loading ? html`<div class="loading">${t("tenantAgents.loading")}</div>`
        : this.agents.length === 0
          ? html`<div class="empty">${noModels
              ? html`${t("tenantAgents.emptyNoModels").split(t("tenantAgents.addModelLink"))[0]}<a href=${this.modelManagePath} style="color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer">${t("tenantAgents.addModelLink")}</a>`
              : t("tenantAgents.empty")}</div>`
          : html`<div class="card-grid">${this.agents.map((a) => this.renderAgentCard(a))}</div>`
      }
    `;
  }

  private renderAgentCard(agent: TenantAgent) {
    const displayName = (agent.config?.displayName as string) || agent.name || agent.agentId;
    const denySet = new Set(Array.isArray((agent.config?.tools as { deny?: string[] })?.deny)
      ? (agent.config.tools as { deny: string[] }).deny : []);
    const toolsEnabled = ALL_TOOL_IDS.filter((id) => !denySet.has(id)).length;
    const modelCount = agent.modelConfig?.length ?? 0;
    const defaultModel = agent.modelConfig?.find((m) => m.isDefault);
    const defaultModelName = defaultModel
      ? this.flatModels.find((m) => m.providerId === defaultModel.providerId && m.modelId === defaultModel.modelId)?.modelName ?? defaultModel.modelId
      : "-";

    return html`
      <div class="agent-card">
        <div class="agent-card-header">
          <div class="agent-name">
            <span class="status-dot ${agent.isActive ? "active" : "inactive"}"></span>
            ${displayName}
          </div>
        </div>
        <div class="agent-card-body">
          <div class="info-row">
            <span class="info-label">Agent ID</span>
            <span class="info-value mono">${agent.agentId}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${t("tenantAgents.model")}</span>
            <span class="info-value">${defaultModelName}${modelCount > 1 ? ` (+${modelCount - 1})` : ""}</span>
          </div>
          <div class="info-row">
            <span class="info-label">${t("tenantAgents.tools")}</span>
            <span class="info-value">${toolsEnabled}/${ALL_TOOL_IDS.length} ${t("tenantAgents.enabled")}</span>
          </div>
          <div class="agent-actions">
            <button class="btn btn-outline btn-sm" @click=${() => this.startEdit(agent)}>${t("tenantAgents.edit")}</button>
            <button class="btn btn-danger btn-sm" @click=${() => this.handleDelete(agent)}>${t("tenantAgents.delete")}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderForm() {
    const isEditing = !!this.editingAgentId;
    return html`
      <div class="form-card">
        <h3>${isEditing ? t("tenantAgents.editAgent") : t("tenantAgents.createAgent")}</h3>
        <form @submit=${this.handleSave}>
          <div class="form-row">
            <div class="form-field">
              <label>${t("tenantAgents.agentDisplayName")}</label>
              <input type="text" .placeholder=${t("tenantAgents.agentDisplayNamePlaceholder")}
                .value=${this.formName}
                @input=${(e: InputEvent) => {
                  this.formName = (e.target as HTMLInputElement).value;
                  if (!isEditing && !this.formAgentIdManuallyEdited) {
                    this.formAgentId = this.toSlug(this.formName);
                  }
                }} />
            </div>
            <div class="form-field">
              <label>Agent ID</label>
              <input type="text" .placeholder=${t("tenantAgents.agentIdPlaceholder")} ?disabled=${isEditing}
                pattern="^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$"
                .title=${t("tenantAgents.agentIdPattern")}
                .value=${this.formAgentId}
                @input=${(e: InputEvent) => {
                  this.formAgentId = (e.target as HTMLInputElement).value;
                  this.formAgentIdManuallyEdited = true;
                }} />
              <div class="form-hint">
                ${isEditing ? t("tenantAgents.agentIdReadonly") : t("tenantAgents.agentIdHint")}
              </div>
            </div>
          </div>

          <div class="divider"><span>${t("tenantAgents.modelBinding")}</span></div>

          <div class="form-field" style="margin-bottom:0.75rem">
            <label>${t("tenantAgents.modelBinding")} <span style="color:var(--text-muted,#525252);font-weight:400">${t("tenantAgents.modelBindingHint")}</span></label>
            ${this.flatModels.length === 0 ? html`
              <div class="form-hint" style="padding:0.3rem 0">${t("tenantAgents.noModelsAvailable").split(t("tenantAgents.addModelLink"))[0]}<a href=${this.modelManagePath} style="color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer">${t("tenantAgents.addModelLink")}</a></div>
            ` : html`
              <table class="model-select-table">
                <thead>
                  <tr>
                    <th style="width:2rem"></th>
                    <th>${t("tenantAgents.modelId")}</th>
                    <th>${t("tenantAgents.modelName")}</th>
                    <th>${t("tenantAgents.provider")}</th>
                    <th style="width:4.5rem;text-align:center">${t("tenantAgents.default")}</th>
                  </tr>
                </thead>
                <tbody>
                  ${this.flatModels.map((m) => {
                    const selected = this.isModelSelected(m.providerId, m.modelId);
                    const isDef = this.isModelDefault(m.providerId, m.modelId);
                    return html`
                      <tr>
                        <td><input type="checkbox" .checked=${selected}
                          @change=${() => this.toggleModel(m.providerId, m.modelId)} /></td>
                        <td>${m.modelId}</td>
                        <td>${m.modelName}</td>
                        <td style="color:var(--text-secondary,#a3a3a3)">${m.providerName}</td>
                        <td style="text-align:center">
                          ${selected ? html`<input type="radio" name="defaultModel" .checked=${isDef}
                            @change=${() => this.setDefaultModel(m.providerId, m.modelId)} />` : nothing}
                        </td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
              ${this.formModelConfig.length > 0 ? html`
                <div class="form-hint">
                  ${t("tenantAgents.selectedCount").replace("{count}", String(this.formModelConfig.length)).replace("{default}", (() => {
                    const d = this.formModelConfig.find((e) => e.isDefault);
                    if (!d) return t("tenantAgents.notSet");
                    const fm = this.flatModels.find((m) => m.providerId === d.providerId && m.modelId === d.modelId);
                    return fm ? `${fm.modelName} (${fm.providerName})` : d.modelId;
                  })())}
                </div>
              ` : nothing}
            `}
          </div>

          <div class="divider"><span>${t("tenantAgents.systemPrompt")}</span></div>

          <div class="form-field" style="margin-bottom:0.75rem">
            <label>${t("tenantAgents.systemPrompt")}</label>
            <textarea .placeholder=${t("tenantAgents.systemPromptPlaceholder")}
              .value=${this.formSystemPrompt}
              @input=${(e: InputEvent) => { this.formSystemPrompt = (e.target as HTMLTextAreaElement).value; }}></textarea>
          </div>

          <div class="divider"><span>${t("tenantAgents.toolAccess")}</span></div>

          ${this.renderToolsSection()}

          <div style="display:flex;gap:0.5rem;margin-top:1rem">
            <button class="btn btn-primary" type="submit" ?disabled=${this.saving}>
              ${this.saving ? t("tenantAgents.saving") : t("tenantAgents.save")}
            </button>
            <button class="btn btn-outline" type="button" @click=${() => { this.showForm = false; }}>${t("tenantAgents.cancel")}</button>
          </div>
        </form>
      </div>
    `;
  }

  private renderToolsSection() {
    const denySet = new Set(this.formToolsDeny);
    const enabled = ALL_TOOL_IDS.filter((id) => !denySet.has(id)).length;
    return html`
      <div class="tools-section">
        <div class="tools-header" @click=${() => { this.formToolsExpanded = !this.formToolsExpanded; }}>
          <div class="tools-header-left">
            <span class="tools-header-arrow ${this.formToolsExpanded ? "open" : ""}">&#9654;</span>
            <span>${t("tenantAgents.toolAccess")}</span>
          </div>
          <span style="font-size:0.72rem;color:var(--text-muted,#525252)">
            ${t("tenantAgents.toolsEnabled").replace("{enabled}", String(enabled)).replace("{total}", String(ALL_TOOL_IDS.length))}
          </span>
        </div>
        ${this.formToolsExpanded ? html`
          <div class="tools-body">
            <div class="form-hint" style="margin-bottom:0.4rem">${t("tenantAgents.toolsHint")}</div>
            <div class="tools-actions">
              <button type="button" class="btn btn-outline btn-sm" @click=${() => this.toggleAllTools(true)}>${t("tenantAgents.enableAll")}</button>
              <button type="button" class="btn btn-outline btn-sm" @click=${() => this.toggleAllTools(false)}>${t("tenantAgents.disableAll")}</button>
            </div>
            ${this.toolGroups.map((group) => {
              const enabledCount = group.tools.filter((tl) => !denySet.has(tl.id)).length;
              const allEnabled = enabledCount === group.tools.length;
              const someEnabled = enabledCount > 0 && enabledCount < group.tools.length;
              return html`
                <div class="tools-group-header">
                  <input type="checkbox" class="tools-group-checkbox"
                    .checked=${allEnabled}
                    .indeterminate=${someEnabled}
                    @change=${(e: Event) => { e.stopPropagation(); this.toggleGroupTools(group.id, (e.target as HTMLInputElement).checked); }} />
                  <span class="tools-group-header-label">${group.label}</span>
                  <span class="tools-group-header-count">${enabledCount}/${group.tools.length}</span>
                </div>
                ${group.tools.map((tool) => html`
                  <div class="tool-row">
                    <div class="tool-row-info">
                      <span class="tool-row-name">${tool.label}</span>
                      <span class="tool-row-desc">${tool.description}</span>
                    </div>
                    <input type="checkbox" class="tool-toggle"
                      .checked=${!denySet.has(tool.id)}
                      @change=${(e: Event) => this.toggleTool(tool.id, (e.target as HTMLInputElement).checked)} />
                  </div>
                `)}
              `;
            })}
          </div>
        ` : nothing}
      </div>
    `;
  }
}
