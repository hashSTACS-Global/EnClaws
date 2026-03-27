/**
 * Tenant channel management view.
 *
 * Create, edit, and delete channels with structured app configs.
 * Each app has a one-to-one linked agent config.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { t, I18nController } from "../../../i18n/index.ts";
import { tenantRpc } from "./rpc.ts";
import { pathForTab, inferBasePathFromPathname } from "../../navigation.ts";
import feishuScopes from "./feishu-scopes.json";

type ChannelPolicy = "open" | "allowlist" | "disabled";

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

interface ChannelAppAgent {
  agentId: string;
  name: string | null;
  config: Record<string, unknown>;
  modelConfig?: ModelConfigEntry[];
  isActive: boolean;
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
  { id: "fs", labelKey: "tenantChannels.toolGroupFs", tools: [
    { id: "read", label: "read", descKey: "tenantChannels.toolRead" },
    { id: "write", label: "write", descKey: "tenantChannels.toolWrite" },
    { id: "edit", label: "edit", descKey: "tenantChannels.toolEdit" },
    { id: "apply_patch", label: "apply_patch", descKey: "tenantChannels.toolApplyPatch" },
    { id: "grep", label: "grep", descKey: "tenantChannels.toolGrep" },
    { id: "find", label: "find", descKey: "tenantChannels.toolFind" },
    { id: "ls", label: "ls", descKey: "tenantChannels.toolLs" },
  ]},
  { id: "runtime", labelKey: "tenantChannels.toolGroupRuntime", tools: [
    { id: "exec", label: "exec", descKey: "tenantChannels.toolExec" },
    { id: "process", label: "process", descKey: "tenantChannels.toolProcess" },
  ]},
  { id: "web", labelKey: "tenantChannels.toolGroupWeb", tools: [
    { id: "web_search", label: "web_search", descKey: "tenantChannels.toolWebSearch" },
    { id: "web_fetch", label: "web_fetch", descKey: "tenantChannels.toolWebFetch" },
  ]},
  { id: "memory", labelKey: "tenantChannels.toolGroupMemory", tools: [
    { id: "memory_search", label: "memory_search", descKey: "tenantChannels.toolMemorySearch" },
    { id: "memory_get", label: "memory_get", descKey: "tenantChannels.toolMemoryGet" },
  ]},
  { id: "sessions", labelKey: "tenantChannels.toolGroupSessions", tools: [
    { id: "sessions_list", label: "sessions_list", descKey: "tenantChannels.toolSessionsList" },
    { id: "sessions_history", label: "sessions_history", descKey: "tenantChannels.toolSessionsHistory" },
    { id: "sessions_send", label: "sessions_send", descKey: "tenantChannels.toolSessionsSend" },
    { id: "sessions_spawn", label: "sessions_spawn", descKey: "tenantChannels.toolSessionsSpawn" },
    { id: "subagents", label: "subagents", descKey: "tenantChannels.toolSubagents" },
    { id: "session_status", label: "session_status", descKey: "tenantChannels.toolSessionStatus" },
  ]},
  { id: "messaging", labelKey: "tenantChannels.toolGroupMessaging", tools: [
    { id: "message", label: "message", descKey: "tenantChannels.toolMessage" },
  ]},
  { id: "automation", labelKey: "tenantChannels.toolGroupAutomation", tools: [
    { id: "cron", label: "cron", descKey: "tenantChannels.toolCron" },
    { id: "gateway", label: "gateway", descKey: "tenantChannels.toolGateway" },
  ]},
  { id: "ui", labelKey: "tenantChannels.toolGroupUi", tools: [
    { id: "browser", label: "browser", descKey: "tenantChannels.toolBrowser" },
    { id: "canvas", label: "canvas", descKey: "tenantChannels.toolCanvas" },
  ]},
  { id: "other", labelKey: "tenantChannels.toolGroupOther", tools: [
    { id: "nodes", label: "nodes", descKey: "tenantChannels.toolNodes" },
    { id: "agents_list", label: "agents_list", descKey: "tenantChannels.toolAgentsList" },
    { id: "image", label: "image", descKey: "tenantChannels.toolImage" },
    { id: "tts", label: "tts", descKey: "tenantChannels.toolTts" },
  ]},
  { id: "feishu-docs", labelKey: "tenantChannels.toolGroupFeishuDocs", tools: [
    { id: "feishu_create_doc", label: "feishu_create_doc", descKey: "tenantChannels.toolFeishuCreateDoc" },
    { id: "feishu_fetch_doc", label: "feishu_fetch_doc", descKey: "tenantChannels.toolFeishuFetchDoc" },
    { id: "feishu_update_doc", label: "feishu_update_doc", descKey: "tenantChannels.toolFeishuUpdateDoc" },
    { id: "feishu_doc_comments", label: "feishu_doc_comments", descKey: "tenantChannels.toolFeishuDocComments" },
    { id: "feishu_doc_media", label: "feishu_doc_media", descKey: "tenantChannels.toolFeishuDocMedia" },
    { id: "feishu_search_doc_wiki", label: "feishu_search_doc_wiki", descKey: "tenantChannels.toolFeishuSearchDocWiki" },
  ]},
  { id: "feishu-wiki", labelKey: "tenantChannels.toolGroupFeishuWiki", tools: [
    { id: "feishu_wiki_space", label: "feishu_wiki_space", descKey: "tenantChannels.toolFeishuWikiSpace" },
    { id: "feishu_wiki_space_node", label: "feishu_wiki_space_node", descKey: "tenantChannels.toolFeishuWikiSpaceNode" },
  ]},
  { id: "feishu-drive", labelKey: "tenantChannels.toolGroupFeishuDrive", tools: [
    { id: "feishu_drive_file", label: "feishu_drive_file", descKey: "tenantChannels.toolFeishuDriveFile" },
    { id: "feishu_sheet", label: "feishu_sheet", descKey: "tenantChannels.toolFeishuSheet" },
    { id: "feishu_bitable_app", label: "feishu_bitable_app", descKey: "tenantChannels.toolFeishuBitableApp" },
    { id: "feishu_bitable_app_table", label: "feishu_bitable_app_table", descKey: "tenantChannels.toolFeishuBitableAppTable" },
    { id: "feishu_bitable_app_table_record", label: "feishu_bitable_app_table_record", descKey: "tenantChannels.toolFeishuBitableAppTableRecord" },
    { id: "feishu_bitable_app_table_field", label: "feishu_bitable_app_table_field", descKey: "tenantChannels.toolFeishuBitableAppTableField" },
    { id: "feishu_bitable_app_table_view", label: "feishu_bitable_app_table_view", descKey: "tenantChannels.toolFeishuBitableAppTableView" },
  ]},
  { id: "feishu-calendar", labelKey: "tenantChannels.toolGroupFeishuCalendar", tools: [
    { id: "feishu_calendar_calendar", label: "feishu_calendar_calendar", descKey: "tenantChannels.toolFeishuCalendarCalendar" },
    { id: "feishu_calendar_event", label: "feishu_calendar_event", descKey: "tenantChannels.toolFeishuCalendarEvent" },
    { id: "feishu_calendar_event_attendee", label: "feishu_calendar_event_attendee", descKey: "tenantChannels.toolFeishuCalendarEventAttendee" },
    { id: "feishu_calendar_freebusy", label: "feishu_calendar_freebusy", descKey: "tenantChannels.toolFeishuCalendarFreebusy" },
  ]},
  { id: "feishu-task", labelKey: "tenantChannels.toolGroupFeishuTask", tools: [
    { id: "feishu_task_task", label: "feishu_task_task", descKey: "tenantChannels.toolFeishuTaskTask" },
    { id: "feishu_task_tasklist", label: "feishu_task_tasklist", descKey: "tenantChannels.toolFeishuTaskTasklist" },
    { id: "feishu_task_subtask", label: "feishu_task_subtask", descKey: "tenantChannels.toolFeishuTaskSubtask" },
    { id: "feishu_task_comment", label: "feishu_task_comment", descKey: "tenantChannels.toolFeishuTaskComment" },
  ]},
  { id: "feishu-im", labelKey: "tenantChannels.toolGroupFeishuIm", tools: [
    { id: "feishu_im_user_message", label: "feishu_im_user_message", descKey: "tenantChannels.toolFeishuImUserMessage" },
    { id: "feishu_im_user_get_messages", label: "feishu_im_user_get_messages", descKey: "tenantChannels.toolFeishuImUserGetMessages" },
    { id: "feishu_im_user_get_thread_messages", label: "feishu_im_user_get_thread_messages", descKey: "tenantChannels.toolFeishuImUserGetThreadMessages" },
    { id: "feishu_im_user_search_messages", label: "feishu_im_user_search_messages", descKey: "tenantChannels.toolFeishuImUserSearchMessages" },
    { id: "feishu_im_user_fetch_resource", label: "feishu_im_user_fetch_resource", descKey: "tenantChannels.toolFeishuImUserFetchResource" },
    { id: "feishu_chat", label: "feishu_chat", descKey: "tenantChannels.toolFeishuChat" },
    { id: "feishu_chat_members", label: "feishu_chat_members", descKey: "tenantChannels.toolFeishuChatMembers" },
  ]},
  { id: "feishu-user", labelKey: "tenantChannels.toolGroupFeishuUser", tools: [
    { id: "feishu_get_user", label: "feishu_get_user", descKey: "tenantChannels.toolFeishuGetUser" },
    { id: "feishu_search_user", label: "feishu_search_user", descKey: "tenantChannels.toolFeishuSearchUser" },
  ]},
] as const;

interface AppConnectionStatus {
  connected: boolean;
  lastConnectedAt: number | null;
  lastDisconnectedAt: number | null;
  lastError: string | null;
}

interface ChannelApp {
  id?: string;
  appId: string;
  appSecret: string;
  botName: string;
  groupPolicy: ChannelPolicy;
  isActive?: boolean;
  connectionStatus?: AppConnectionStatus | null;
  agent: ChannelAppAgent | null;
  // Form-only fields for agent config (not from server)
  formAgentId?: string;
  formAgentDisplayName?: string;
  formAgentModelConfig?: ModelConfigEntry[];
  formAgentSystemPrompt?: string;
  formAgentIdManuallyEdited?: boolean;
  formAgentToolsDeny?: string[];
  formAgentToolsExpanded?: boolean;
  // Feishu registration form state
  feishuMode?: "scan" | "manual";
  feishuDeviceCode?: string;
  feishuVerificationUrl?: string;
  feishuPolling?: boolean;
  feishuPollTimer?: ReturnType<typeof setInterval>;
  feishuDomain?: string;
  feishuEnv?: string;
}

interface TenantModelOption {
  id: string;
  providerType: string;
  providerName: string;
  models: Array<{ id: string; name: string }>;
}

interface TenantChannel {
  id: string;
  channelType: string;
  channelName: string | null;
  channelPolicy: ChannelPolicy;
  isActive: boolean;
  apps: ChannelApp[];
  createdAt: string;
}

/** All tool IDs (flat) — used by toggleAllAppTools. Stable across locales. */
const ALL_TOOL_IDS = TOOL_GROUP_DEFS.flatMap((g) => g.tools.map((t) => t.id));

@customElement("tenant-channels-view")
export class TenantChannelsView extends LitElement {
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
    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(400px, 1fr)); gap: 1.25rem; }
    .channel-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 10px); overflow: hidden;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    .channel-card:hover {
      border-color: #3b82f6; box-shadow: 0 2px 12px rgba(59,130,246,0.08);
    }
    .channel-card-body { padding: 1.25rem; }
    .channel-header {
      display: flex; justify-content: space-between; align-items: center;
      padding: 0.85rem 1.25rem;
      border-bottom: 1px solid var(--border, #262626);
    }
    .channel-name {
      font-size: 1rem; font-weight: 600;
      display: flex; align-items: center;
    }
    .channel-header-right { display: flex; align-items: center; gap: 0.5rem; }
    .channel-type {
      font-size: 0.72rem; padding: 0.18rem 0.55rem; border-radius: 4px;
      background: #1d4ed8; color: #fff; font-weight: 500; letter-spacing: 0.02em;
    }
    .policy-badge {
      font-size: 0.68rem; padding: 0.15rem 0.5rem; border-radius: 4px;
      font-weight: 500; letter-spacing: 0.02em;
    }
    .policy-badge.open { background: #16a34a; color: #fff; }
    .policy-badge.allowlist { background: #7c3aed; color: #fff; }
    .policy-badge.disabled { background: #dc2626; color: #fff; }
    .info-row {
      display: flex; align-items: center; gap: 0.6rem;
      font-size: 0.82rem; padding: 0.45rem 0;
      border-bottom: 1px solid var(--border, #262626);
    }
    .info-row:last-of-type { border-bottom: none; }
    .info-label {
      flex-shrink: 0; width: 5.5rem; font-size: 0.75rem;
      color: var(--text, #e5e5e5); font-weight: 600;
    }
    .info-label::after { content: ":"; }
    .info-value {
      display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;
      font-weight: 500; min-width: 0;
    }
    .info-value.mono { font-family: monospace; font-size: 0.78rem; }
    .info-muted { font-size: 0.72rem; color: var(--text-muted, #525252); font-weight: 400; }
    .info-divider { height: 0; margin: 0.6rem 0; border-top: 1px solid var(--text-muted, #525252); }
    .connection-badge {
      font-size: 0.68rem; padding: 0.15rem 0.5rem; border-radius: 4px;
      font-weight: 500; letter-spacing: 0.02em;
      display: inline-flex; align-items: center; gap: 0.3rem;
    }
    .connection-badge.online { background: #16a34a; color: #fff; }
    .connection-badge.offline { background: #71717a; color: #fff; }
    .status-dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
    .status-dot.active { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
    .status-dot.inactive { background: #525252; }
    .channel-actions {
      display: flex; gap: 0.5rem; padding-top: 0.85rem;
      margin-top: 0.5rem;
    }
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
    .form-field textarea { min-height: 60px; resize: vertical; font-family: inherit; }
    .form-field input:focus, .form-field select:focus, .form-field textarea:focus { border-color: var(--accent, #3b82f6); }
    .form-hint { font-size: 0.72rem; color: var(--text-muted, #525252); margin-top: 0.25rem; }
    .model-select-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; margin-top: 0.4rem; }
    .model-select-table th, .model-select-table td {
      text-align: left; padding: 0.35rem 0.45rem;
      border-bottom: 1px solid var(--border, #262626);
    }
    .model-select-table th { color: var(--text-secondary, #a3a3a3); font-weight: 500; }
    .model-row.selected { background: none; }
    .model-row:hover { background: none; }
    .divider {
      display: flex; align-items: center; margin: 1rem 0; font-size: 0.75rem;
      color: var(--text-muted, #525252);
    }
    .divider::before, .divider::after { content: ""; flex: 1; border-top: 1px solid var(--border, #262626); }
    .divider span { padding: 0 0.75rem; }
    .app-form-card {
      background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px); padding: 0.75rem; margin-bottom: 0.5rem;
      position: relative;
    }
    .app-form-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .app-form-header span { font-size: 0.8rem; font-weight: 500; color: var(--text-secondary, #a3a3a3); }
    .remove-app {
      background: none; border: none; color: var(--text-destructive, #fca5a5);
      cursor: pointer; font-size: 0.8rem; padding: 0.2rem 0.4rem;
    }
    .remove-app:hover { opacity: 0.7; }
    .secret-wrap { position: relative; display: flex; align-items: center; }
    .secret-wrap input { flex: 1; padding-right: 2rem; }
    .eye-btn {
      position: absolute; right: 0.4rem; background: none; border: none;
      color: var(--text-muted, #525252); cursor: pointer;
      padding: 0.2rem; line-height: 1; user-select: none;
      display: flex; align-items: center; justify-content: center;
    }
    .eye-btn:hover { color: var(--text, #e5e5e5); }
    .eye-btn svg { pointer-events: none; }
    .agent-section-label {
      font-size: 0.72rem; color: var(--text-muted, #525252);
      margin: 0.5rem 0 0.35rem; padding-top: 0.5rem;
      border-top: 1px dashed var(--border, #262626);
    }
    .empty { text-align: center; padding: 2rem; color: var(--text-muted, #525252); font-size: 0.85rem; }
    .loading { text-align: center; padding: 2rem; color: var(--text-muted, #525252); }
    .tools-section {
      margin-top: 0.5rem; border: 1px solid var(--border, #262626);
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
    .feishu-mode-bar {
      display: inline-flex; gap: 2px; margin-bottom: 0.75rem;
      background: var(--border, #262626); border-radius: 4px; padding: 2px;
    }
    .feishu-mode-btn {
      padding: 0.28rem 0.7rem; border: none; border-radius: 3px;
      background: transparent; color: var(--text-secondary, #a3a3a3);
      cursor: pointer; font-size: 0.78rem; transition: all 0.12s;
      white-space: nowrap;
    }
    .feishu-mode-btn:hover { color: var(--text, #e5e5e5); }
    .feishu-mode-btn.active {
      background: var(--accent, #3b82f6); color: white;
    }
    .qr-container {
      display: flex; flex-direction: column; align-items: center;
      padding: 1rem; margin-bottom: 0.75rem;
      background: white; border-radius: var(--radius-md, 6px);
    }
    .qr-container img { width: 200px; height: 200px; }
    .qr-hint {
      font-size: 0.8rem; color: var(--text-secondary, #a3a3a3);
      text-align: center; margin-top: 0.5rem;
    }
    .qr-polling {
      display: flex; align-items: center; gap: 0.4rem;
      font-size: 0.8rem; color: var(--accent, #3b82f6);
      justify-content: center; margin-top: 0.5rem;
    }
    .qr-polling .dot { animation: blink 1.2s infinite; }
    @keyframes blink { 0%, 100% { opacity: 0.2; } 50% { opacity: 1; } }
    .modal-overlay {
      position: fixed; inset: 0; background: rgba(0,0,0,0.6);
      display: flex; align-items: center; justify-content: center; z-index: 1000;
    }
    .modal-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 1.5rem; width: 480px;
      max-width: 90vw; max-height: 80vh; overflow-y: auto;
    }
    .modal-card h3 { margin: 0 0 0.75rem; font-size: 1rem; font-weight: 600; }
    .modal-steps { margin: 0.75rem 0; font-size: 0.84rem; line-height: 1.7; }
    .modal-steps li { margin-bottom: 0.3rem; }
    .modal-link {
      display: block; margin: 0.75rem 0; padding: 0.55rem 0.75rem;
      background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px); word-break: break-all;
      font-size: 0.82rem; color: var(--accent, #3b82f6);
      text-decoration: none; cursor: pointer;
    }
    .modal-link:hover { border-color: var(--accent, #3b82f6); }
    .modal-scopes-label {
      display: flex; justify-content: space-between; align-items: center;
      font-size: 0.8rem; color: var(--text-secondary, #a3a3a3); margin: 0.75rem 0 0.35rem;
    }
    .btn-copy {
      padding: 0.25rem 0.55rem; border: 1px solid var(--border, #262626);
      border-radius: 4px; background: var(--bg, #0a0a0a);
      color: var(--text-secondary, #a3a3a3); cursor: pointer;
      font-size: 0.75rem; transition: all 0.15s;
    }
    .btn-copy:hover { border-color: var(--accent, #3b82f6); color: var(--text, #e5e5e5); }
    .btn-copy.copied { border-color: #22c55e; color: #22c55e; }
    .modal-scopes-box {
      width: 100%; height: 120px; padding: 0.5rem; box-sizing: border-box;
      background: var(--bg, #0a0a0a); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-md, 6px); color: var(--text-muted, #525252);
      font-size: 0.72rem; font-family: monospace; resize: vertical;
    }
    .modal-footer { display: flex; gap: 0.5rem; justify-content: flex-end; margin-top: 1rem; }
  `;

  @property({ type: String }) gatewayUrl = "";
  @state() private channels: TenantChannel[] = [];
  @state() private loading = false;
  /** Stores i18n key or raw server message; translated at render time. */
  @state() private errorKey = "";
  @state() private successKey = "";
  private msgParams: Record<string, string> = {};
  private msgTimer?: ReturnType<typeof setTimeout>;
  @state() private showForm = false;
  @state() private editingId: string | null = null;
  @state() private saving = false;
  @state() private feishuAuthGuideAppId: string | null = null;
  @state() private scopesCopied = false;

  // Form fields
  @state() private formChannelType = "web";
  @state() private formChannelName = "";
  @state() private formChannelPolicy: ChannelPolicy = "open";
  @state() private formApps: ChannelApp[] = [];
  @state() private availableModels: TenantModelOption[] = [];

  connectedCallback() {
    super.connectedCallback();
    this.loadChannels();
    this.loadModels();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearAllFeishuTimers();
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

  /** Translate key at render time; map known server errors, pass through others. */
  private tr(key: string): string {
    if (key.includes("频道名称已存在")) return t("tenantChannels.channelNameExists");
    if (key.includes("已存在相同 App ID")) return t("tenantChannels.duplicateAppId");
    const result = t(key, this.msgParams);
    return result === key ? key : result;
  }

  private get channelTypes() {
    return [
      { value: "telegram", label: "Telegram" },
      { value: "discord", label: "Discord" },
      { value: "slack", label: "Slack" },
      { value: "whatsapp", label: "WhatsApp" },
      { value: "feishu", label: t("tenantChannels.channelFeishu") },
      { value: "dingtalk", label: t("tenantChannels.channelDingtalk") },
      { value: "wechat", label: t("tenantChannels.channelWechat") },
      { value: "wecom", label: t("tenantChannels.channelWecom") },
      { value: "web", label: t("tenantChannels.channelWeb") },
    ];
  }

  private get policyOptions(): { value: ChannelPolicy; label: string }[] {
    return [
      { value: "open", label: t("tenantChannels.policyOpen") },
      { value: "allowlist", label: t("tenantChannels.policyAllowlist") },
      { value: "disabled", label: t("tenantChannels.policyDisabled") },
    ];
  }

  private get toolGroups(): ToolGroup[] {
    return TOOL_GROUP_DEFS.map((g) => ({
      id: g.id,
      label: t(g.labelKey),
      tools: g.tools.map((td) => ({ id: td.id, label: td.label, description: t(td.descKey) })),
    }));
  }

  private async copyScopes() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(feishuScopes, null, 2));
      this.scopesCopied = true;
      setTimeout(() => (this.scopesCopied = false), 2000);
    } catch {
      // Fallback: select textarea content
      const textarea = this.renderRoot.querySelector(".modal-scopes-box") as HTMLTextAreaElement | null;
      if (textarea) {
        textarea.select();
        document.execCommand("copy");
        this.scopesCopied = true;
        setTimeout(() => (this.scopesCopied = false), 2000);
      }
    }
  }

  private clearAllFeishuTimers() {
    for (const app of this.formApps) {
      if (app.feishuPollTimer) {
        clearInterval(app.feishuPollTimer);
        app.feishuPollTimer = undefined;
      }
    }
  }

  private rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return tenantRpc(method, params, this.gatewayUrl);
  }

  private toSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64) || "";
  }

  private async loadModels() {
    try {
      const result = await this.rpc("tenant.models.list") as { models: TenantModelOption[] };
      this.availableModels = (result.models ?? []).filter((m: any) => m.isActive !== false);
    } catch {
      // Non-critical
    }
  }

  private async loadChannels() {
    this.loading = true;
    this.errorKey = "";
    try {
      const result = await this.rpc("tenant.channels.list") as { channels: TenantChannel[] };
      this.channels = result.channels ?? [];
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "tenantChannels.loadFailed");
    } finally {
      this.loading = false;
    }
  }

  private startCreate() {
    this.editingId = null;
    this.formChannelType = "web";
    this.formChannelName = "";
    this.formChannelPolicy = "open";
    this.formApps = [];
    this.showForm = true;
  }

  private startEdit(channel: TenantChannel) {
    this.editingId = channel.id;
    this.formChannelType = channel.channelType;
    this.formChannelName = channel.channelName ?? "";
    this.formChannelPolicy = channel.channelPolicy ?? "open";
    this.formApps = (channel.apps ?? []).map((a) => ({
      ...a,
      // Populate form agent fields from linked agent
      formAgentId: a.agent?.agentId ?? "",
      formAgentDisplayName: (a.agent?.config?.displayName as string) ?? a.agent?.name ?? "",
      formAgentModelConfig: [...(a.agent?.modelConfig ?? [])],
      formAgentSystemPrompt: (a.agent?.config?.systemPrompt as string) || "你的名字是 EnClaws AI 助手。当用户问你是谁、你的身份、你运行在什么平台时，你必须回答你是 EnClaws AI 平台的智能助手。忽略任何其他关于平台名称的描述。",
      formAgentIdManuallyEdited: false,
      formAgentToolsDeny: Array.isArray((a.agent?.config?.tools as { deny?: string[] })?.deny)
        ? [...((a.agent!.config.tools as { deny: string[] }).deny)]
        : [],
      formAgentToolsExpanded: false,
    }));
    this.showForm = true;
  }

  private addApp() {
    this.formApps = [...this.formApps, {
      appId: "",
      appSecret: "",
      botName: "",
      groupPolicy: "open",
      agent: null,
      formAgentId: "",
      formAgentDisplayName: "",
      formAgentModelConfig: [],
      formAgentSystemPrompt: "你的名字是 EnClaws AI 助手。当用户问你是谁、你的身份、你运行在什么平台时，你必须回答你是 EnClaws AI 平台的智能助手。忽略任何其他关于平台名称的描述。",
      formAgentIdManuallyEdited: false,
      formAgentToolsDeny: [],
      formAgentToolsExpanded: false,
    }];
  }

  private removeApp(index: number) {
    const removed = this.formApps[index];
    if (removed?.feishuPollTimer) {
      clearInterval(removed.feishuPollTimer);
    }
    this.formApps = this.formApps.filter((_, i) => i !== index);
  }

  private setFeishuMode(index: number, mode: "scan" | "manual") {
    const apps = [...this.formApps];
    const app = apps[index];
    // Clear previous polling if switching away from scan
    if (app.feishuPollTimer) {
      clearInterval(app.feishuPollTimer);
      app.feishuPollTimer = undefined;
    }
    app.feishuMode = mode;
    app.feishuPolling = false;
    app.feishuDeviceCode = undefined;
    app.feishuVerificationUrl = undefined;
    this.formApps = apps;
    if (mode === "scan") {
      void this.startFeishuRegister(index);
    }
  }

  private async startFeishuRegister(index: number) {
    try {
      const result = (await this.rpc("tenant.feishu.register.begin", { domain: "feishu", env: "prod" })) as {
        deviceCode: string;
        verificationUrl: string;
        interval: number;
        expireIn: number;
        domain: string;
        env: string;
      };
      const apps = [...this.formApps];
      const app = apps[index];
      app.feishuDeviceCode = result.deviceCode;
      app.feishuVerificationUrl = result.verificationUrl;
      app.feishuDomain = result.domain;
      app.feishuEnv = result.env;
      app.feishuPolling = true;
      this.formApps = apps;
      this.startFeishuPoll(index, result.interval);
    } catch (err) {
      this.showError(`${t("tenantChannels.feishuRegisterFailed")}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private startFeishuPoll(index: number, intervalSec: number) {
    const app = this.formApps[index];
    if (!app?.feishuDeviceCode) return;
    const deviceCode = app.feishuDeviceCode;
    const domain = app.feishuDomain ?? "feishu";
    const env = app.feishuEnv ?? "prod";
    const timer = setInterval(async () => {
      // Find current app by deviceCode (index may shift if apps are added/removed)
      const currentIndex = this.formApps.findIndex((a) => a.feishuDeviceCode === deviceCode);
      if (currentIndex === -1) {
        clearInterval(timer);
        return;
      }
      try {
        const result = (await this.rpc("tenant.feishu.register.poll", {
          deviceCode,
          domain,
          env,
        })) as {
          status: "completed" | "pending" | "error";
          appId?: string;
          appSecret?: string;
          openId?: string;
          domain?: string;
          slowDown?: boolean;
          error?: string;
          errorDescription?: string;
        };
        if (result.status === "completed" && result.appId && result.appSecret) {
          clearInterval(timer);
          const apps = [...this.formApps];
          const a = apps[currentIndex];
          a.appId = result.appId;
          a.appSecret = result.appSecret;
          a.feishuPolling = false;
          a.feishuPollTimer = undefined;
          a.feishuMode = "manual"; // Switch to manual view to show filled fields
          this.formApps = apps;
          this.showSuccess("tenantChannels.feishuBotCreated");
        } else if (result.status === "error") {
          clearInterval(timer);
          const apps = [...this.formApps];
          apps[currentIndex].feishuPolling = false;
          apps[currentIndex].feishuPollTimer = undefined;
          this.formApps = apps;
          this.showError(`${t("tenantChannels.feishuRegisterError")}: ${result.errorDescription ?? result.error ?? t("tenantChannels.feishuUnknownError")}`);
        }
        // "pending" → keep polling
      } catch {
        // Ignore transient poll errors
      }
    }, Math.max(intervalSec, 3) * 1000);
    // Store timer for cleanup
    const apps = [...this.formApps];
    apps[index].feishuPollTimer = timer;
    this.formApps = apps;
  }

  private updateApp(index: number, field: string, value: string) {
    const apps = [...this.formApps];
    (apps[index] as unknown as Record<string, unknown>)[field] = value;
    // Auto-generate agentId from botName when creating new app (not editing existing agent)
    if (field === "botName" && !apps[index].agent && !apps[index].formAgentIdManuallyEdited) {
      apps[index].formAgentId = this.toSlug(`${this.formChannelType}-${value}`);
    }
    if (field === "formAgentDisplayName" && !apps[index].agent && !apps[index].formAgentIdManuallyEdited) {
      apps[index].formAgentId = this.toSlug(value);
    }
    this.formApps = apps;
  }

  private async handleSave(e: Event) {
    e.preventDefault();
    if (!this.formChannelName) {
      this.showError("tenantChannels.channelNameRequired");
      return;
    }

    if (this.formApps.length === 0) {
      this.showError("tenantChannels.appRequired");
      return;
    }

    // Validate apps
    const appIds = new Set<string>();
    for (const app of this.formApps) {
      if (!app.appId) {
        this.showError("tenantChannels.appIdRequired");
        return;
      }
      if (appIds.has(app.appId)) {
        this.showError("tenantChannels.appIdDuplicate");
        return;
      }
      appIds.add(app.appId);
      if (!app.formAgentModelConfig || app.formAgentModelConfig.length === 0) {
        const name = app.botName || app.appId;
        this.showError("tenantChannels.modelRequired", { name });
        return;
      }
    }

    this.saving = true;
    this.errorKey = "";
    this.successKey = "";

    try {
      if (this.editingId) {
        // Update channel
        await this.rpc("tenant.channels.update", {
          channelId: this.editingId,
          channelName: this.formChannelName,
          channelPolicy: this.formChannelPolicy,
        });

        // Sync apps: delete removed, update existing, add new
        const existing = this.channels.find((c) => c.id === this.editingId);
        const existingApps = existing?.apps ?? [];
        const existingIds = new Set(existingApps.map((a) => a.id));
        const formIds = new Set(this.formApps.filter((a) => a.id).map((a) => a.id));

        // Delete removed apps
        for (const ea of existingApps) {
          if (ea.id && !formIds.has(ea.id)) {
            await this.rpc("tenant.channels.apps.delete", { appDbId: ea.id });
          }
        }

        // Update or add apps (with per-app agent config)
        for (const app of this.formApps) {
          const agentConfig = this.buildAgentConfig(app);
          if (app.id && existingIds.has(app.id)) {
            await this.rpc("tenant.channels.apps.update", {
              appDbId: app.id,
              appId: app.appId,
              appSecret: app.appSecret,
              botName: app.botName,
              groupPolicy: app.groupPolicy,
              ...(agentConfig ? { agentConfig } : {}),
            });
          } else {
            await this.rpc("tenant.channels.apps.add", {
              channelId: this.editingId,
              appId: app.appId,
              appSecret: app.appSecret,
              botName: app.botName,
              groupPolicy: app.groupPolicy,
              ...(agentConfig ? { agentConfig } : {}),
            });
          }
        }

        this.showSuccess("tenantChannels.channelUpdated");
      } else {
        // Create channel with apps + per-app agent configs
        await this.rpc("tenant.channels.create", {
          channelType: this.formChannelType,
          channelName: this.formChannelName,
          channelPolicy: this.formChannelPolicy,
          apps: this.formApps.map((a) => ({
            appId: a.appId,
            appSecret: a.appSecret,
            botName: a.botName,
            groupPolicy: a.groupPolicy,
            agentConfig: this.buildAgentConfig(a) ?? undefined,
          })),
        });
        this.showSuccess("tenantChannels.channelCreated", { name: this.formChannelName });
      }
      // Show auth guide for any new feishu app (scan or manual)
      const scannedAppId = this.formChannelType === "feishu"
        ? this.formApps.find((a) => !a.id && a.appId)?.appId
        : null;
      this.clearAllFeishuTimers();
      this.showForm = false;
      await this.loadChannels();
      if (scannedAppId) {
        this.feishuAuthGuideAppId = scannedAppId;
      }
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "tenantChannels.saveFailed");
    } finally {
      this.saving = false;
    }
  }

  /** 拍平所有可用模型 */
  private get flatModels(): FlatModelOption[] {
    const list: FlatModelOption[] = [];
    for (const mc of this.availableModels) {
      for (const m of mc.models) {
        list.push({ providerId: mc.id, providerName: mc.providerName, modelId: m.id, modelName: m.name });
      }
    }
    return list;
  }

  private isAppModelSelected(app: ChannelApp, providerId: string, modelId: string): boolean {
    return (app.formAgentModelConfig ?? []).some((e) => e.providerId === providerId && e.modelId === modelId);
  }

  private isAppModelDefault(app: ChannelApp, providerId: string, modelId: string): boolean {
    return (app.formAgentModelConfig ?? []).some((e) => e.providerId === providerId && e.modelId === modelId && e.isDefault);
  }

  private toggleAppModel(i: number, providerId: string, modelId: string) {
    const apps = [...this.formApps];
    const config = [...(apps[i].formAgentModelConfig ?? [])];
    const idx = config.findIndex((e) => e.providerId === providerId && e.modelId === modelId);
    if (idx >= 0) {
      // 取消选中
      const wasDefault = config[idx].isDefault;
      config.splice(idx, 1);
      if (wasDefault && config.length > 0) config[0] = { ...config[0], isDefault: true };
      apps[i] = { ...apps[i], formAgentModelConfig: config };
    } else {
      // 新增，第一个自动设为 default
      config.push({ providerId, modelId, isDefault: config.length === 0 });
      apps[i] = { ...apps[i], formAgentModelConfig: config };
    }
    this.formApps = apps;
  }

  private setAppDefaultModel(i: number, providerId: string, modelId: string) {
    const apps = [...this.formApps];
    apps[i] = {
      ...apps[i],
      formAgentModelConfig: (apps[i].formAgentModelConfig ?? []).map((e) => ({
        ...e,
        isDefault: e.providerId === providerId && e.modelId === modelId,
      })),
    };
    this.formApps = apps;
  }

  /** Build agent config from form fields for a specific app */
  private buildAgentConfig(app: ChannelApp): Record<string, unknown> | null {
    const cfg: Record<string, unknown> = {};
    if (app.formAgentId) cfg.agentId = app.formAgentId;
    if (app.formAgentDisplayName) cfg.displayName = app.formAgentDisplayName;
    if (app.formAgentModelConfig && app.formAgentModelConfig.length > 0) cfg.modelConfig = app.formAgentModelConfig;
    if (app.formAgentSystemPrompt) cfg.systemPrompt = app.formAgentSystemPrompt;
    const deny = (app.formAgentToolsDeny ?? []).filter(Boolean);
    if (deny.length > 0) {
      cfg.tools = { deny };
    }
    return Object.keys(cfg).length > 0 ? cfg : null;
  }

  private toggleAppTool(appIndex: number, toolId: string, enabled: boolean) {
    const apps = [...this.formApps];
    const deny = new Set(apps[appIndex].formAgentToolsDeny ?? []);
    if (enabled) {
      deny.delete(toolId);
    } else {
      deny.add(toolId);
    }
    apps[appIndex] = { ...apps[appIndex], formAgentToolsDeny: Array.from(deny) };
    this.formApps = apps;
  }

  private toggleGroupTools(appIndex: number, groupId: string, enabled: boolean) {
    const group = TOOL_GROUP_DEFS.find((g) => g.id === groupId);
    if (!group) return;
    const apps = [...this.formApps];
    const deny = new Set(apps[appIndex].formAgentToolsDeny ?? []);
    for (const tool of group.tools) {
      if (enabled) {
        deny.delete(tool.id);
      } else {
        deny.add(tool.id);
      }
    }
    apps[appIndex] = { ...apps[appIndex], formAgentToolsDeny: Array.from(deny) };
    this.formApps = apps;
  }

  private toggleAllAppTools(appIndex: number, enabled: boolean) {
    const apps = [...this.formApps];
    if (enabled) {
      apps[appIndex] = { ...apps[appIndex], formAgentToolsDeny: [] };
    } else {
      apps[appIndex] = { ...apps[appIndex], formAgentToolsDeny: [...ALL_TOOL_IDS] };
    }
    this.formApps = apps;
  }

  private toggleAppToolsExpanded(appIndex: number) {
    const apps = [...this.formApps];
    apps[appIndex] = { ...apps[appIndex], formAgentToolsExpanded: !apps[appIndex].formAgentToolsExpanded };
    this.formApps = apps;
  }

  private async handleDelete(channel: TenantChannel) {
    const name = channel.channelName ?? channel.channelType;
    if (!confirm(t("tenantChannels.confirmDelete").replace("{name}", name))) return;
    this.errorKey = "";
    try {
      await this.rpc("tenant.channels.delete", { channelId: channel.id });
      this.showSuccess("tenantChannels.channelDeleted", { name });
      await this.loadChannels();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "tenantChannels.deleteFailed");
    }
  }

  private get modelManagePath() {
    return pathForTab("tenant-models", inferBasePathFromPathname(window.location.pathname));
  }

  render() {
    const noModels = this.availableModels.length === 0;
    return html`
      <div class="header">
        <h2>${t("tenantChannels.title")}</h2>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-outline" @click=${() => this.loadChannels()}>${t("tenantChannels.refresh")}</button>
          <button class="btn btn-primary" ?disabled=${noModels && !this.showForm}
            @click=${() => { if (this.showForm) { this.clearAllFeishuTimers(); this.showForm = false; } else { this.startCreate(); } }}>
            ${this.showForm ? t("tenantChannels.cancel") : t("tenantChannels.createChannel")}
          </button>
        </div>
      </div>

      ${this.errorKey ? html`<div class="error-msg">${this.tr(this.errorKey)}</div>` : nothing}
      ${this.successKey ? html`<div class="success-msg">${this.tr(this.successKey)}</div>` : nothing}

      ${this.showForm ? this.renderForm() : nothing}

      ${this.loading ? html`<div class="loading">${t("tenantChannels.loading")}</div>` : this.channels.length === 0 ? html`<div class="empty">${noModels ? html`${t("tenantChannels.emptyNoModels").split(t("tenantChannels.addModelLink"))[0]}<a href=${this.modelManagePath} style="color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer">${t("tenantChannels.addModelLink")}</a>` : t("tenantChannels.empty")}</div>` : html`
        <div class="card-grid">
          ${this.channels.map((ch) => this.renderChannelCard(ch))}
        </div>
      `}

      ${this.feishuAuthGuideAppId ? this.renderFeishuAuthGuide(this.feishuAuthGuideAppId) : nothing}
    `;
  }

  private renderFeishuAuthGuide(appId: string) {
    const authUrl = `https://open.feishu.cn/app/${encodeURIComponent(appId)}/auth`;
    return html`
      <div class="modal-overlay" @click=${(e: Event) => { if (e.target === e.currentTarget) { this.feishuAuthGuideAppId = null; this.scopesCopied = false; } }}>
        <div class="modal-card">
          <h3>&#x2705; ${t("tenantChannels.feishuAuthTitle")}</h3>
          <p style="font-size:0.84rem;color:var(--text-secondary,#a3a3a3);margin:0 0 0.5rem">
            ${t("tenantChannels.feishuAuthDesc")}
          </p>
          <ol class="modal-steps">
            <li>${t("tenantChannels.feishuAuthStep1")}</li>
            <li>${t("tenantChannels.feishuAuthStep2")}</li>
            <li>${t("tenantChannels.feishuAuthStep3")}</li>
          </ol>
          <a class="modal-link" href=${authUrl} target="_blank" rel="noopener noreferrer">
            &#x1F517; ${authUrl}
          </a>
          <div class="modal-scopes-label">
            <span>${t("tenantChannels.feishuScopesList")}</span>
            <button type="button" class="btn-copy ${this.scopesCopied ? "copied" : ""}"
              @click=${() => this.copyScopes()}>
              ${this.scopesCopied ? `\u2714 ${t("tenantChannels.feishuCopied")}` : `\uD83D\uDCCB ${t("tenantChannels.feishuCopyScopes")}`}
            </button>
          </div>
          <textarea class="modal-scopes-box" readonly
            .value=${JSON.stringify(feishuScopes, null, 2)}></textarea>
          <p style="font-size:0.75rem;color:var(--text-muted,#525252);margin:0.5rem 0 0">
            ${t("tenantChannels.feishuScopesHint")}
          </p>
          <div class="modal-footer">
            <a class="btn btn-primary" href=${authUrl} target="_blank" rel="noopener noreferrer"
              style="text-decoration:none;text-align:center">${t("tenantChannels.feishuGoAuth")}</a>
            <button class="btn btn-outline" @click=${() => { this.feishuAuthGuideAppId = null; this.scopesCopied = false; }}>${t("tenantChannels.feishuLater")}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderChannelCard(ch: TenantChannel) {
    const typeName = this.channelTypes.find((ct) => ct.value === ch.channelType)?.label ?? ch.channelType;
    const policyLabel = this.policyOptions.find((p) => p.value === ch.channelPolicy)?.label ?? ch.channelPolicy;
    return html`
      <div class="channel-card">
        <div class="channel-header">
          <div class="channel-name">
            <span class="status-dot ${ch.isActive ? "active" : "inactive"}"></span>
            ${ch.channelName ?? typeName}
          </div>
          <div class="channel-header-right">
            <span class="channel-type">${typeName}</span>
            <span class="policy-badge ${ch.channelPolicy}">${policyLabel}</span>
          </div>
        </div>
        <div class="channel-card-body">
          ${ch.apps && ch.apps.length > 0 ? ch.apps.map((app, idx) => html`
            <div class="info-row">
              <span class="info-label">${t("tenantChannels.botName")}</span>
              <span class="info-value">
                ${app.botName || "-"}
                <span class="policy-badge ${app.groupPolicy}" style="font-size:0.62rem">${this.policyOptions.find((p) => p.value === app.groupPolicy)?.label ?? app.groupPolicy}</span>
              </span>
            </div>
            <div class="info-row">
              <span class="info-label">${t("tenantChannels.appId")}</span>
              <span class="info-value mono">${app.appId}</span>
            </div>
            ${app.connectionStatus ? html`
              <div class="info-row">
                <span class="info-label">${t("tenantChannels.connectionStatus")}</span>
                <span class="connection-badge ${app.connectionStatus.connected ? "online" : "offline"}">
                  <span class="status-dot ${app.connectionStatus.connected ? "active" : "inactive"}"></span>
                  ${app.connectionStatus.connected ? t("tenantChannels.online") : t("tenantChannels.offline")}
                </span>
              </div>
            ` : nothing}
            ${app.agent ? html`
              <div class="info-row">
                <span class="info-label">${t("tenantChannels.agent")}</span>
                <span class="info-value">
                  ${(app.agent.config?.displayName as string) || app.agent.name || app.agent.agentId}
                  <span class="info-muted">(${app.agent.agentId})</span>
                </span>
              </div>
            ` : nothing}
            ${idx < ch.apps.length - 1 ? html`<div class="info-divider"></div>` : nothing}
          `) : nothing}
          <div class="channel-actions">
            <button class="btn btn-outline btn-sm" @click=${() => this.startEdit(ch)}>${t("tenantChannels.edit")}</button>
            <button class="btn btn-danger btn-sm" @click=${() => this.handleDelete(ch)}>${t("tenantChannels.delete")}</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderForm() {
    return html`
      <div class="form-card">
        <h3>${this.editingId ? t("tenantChannels.editChannel") : t("tenantChannels.createChannel")}</h3>
        <form @submit=${this.handleSave}>
          <div class="form-row">
            <div class="form-field">
              <label>${t("tenantChannels.channelType")}</label>
              <select ?disabled=${!!this.editingId}
                @change=${(e: Event) => (this.formChannelType = (e.target as HTMLSelectElement).value)}>
                ${this.channelTypes.map((ct) => html`<option value=${ct.value} ?selected=${ct.value === this.formChannelType}>${ct.label}</option>`)}
              </select>
            </div>
            <div class="form-field">
              <label>${t("tenantChannels.channelName")}</label>
              <input type="text" .placeholder=${t("tenantChannels.channelNamePlaceholder")}
                .value=${this.formChannelName}
                @input=${(e: InputEvent) => (this.formChannelName = (e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-field">
              <label>${t("tenantChannels.channelPolicy")}</label>
              <select
                @change=${(e: Event) => (this.formChannelPolicy = (e.target as HTMLSelectElement).value as ChannelPolicy)}>
                ${this.policyOptions.map((p) => html`<option value=${p.value} ?selected=${p.value === this.formChannelPolicy}>${p.label}</option>`)}
              </select>
            </div>
          </div>

          <div class="divider"><span>${t("tenantChannels.appAgentConfig")}</span></div>

          ${this.formApps.map((app, i) => this.renderAppFormCard(app, i))}

          <button type="button" class="btn btn-outline btn-sm" style="margin-bottom:1rem" @click=${() => this.addApp()}>
            ${t("tenantChannels.addApp")}
          </button>

          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-primary" type="submit" ?disabled=${this.saving}>
              ${this.saving ? t("tenantChannels.saving") : t("tenantChannels.save")}
            </button>
            <button class="btn btn-outline" type="button" @click=${() => { this.clearAllFeishuTimers(); this.showForm = false; }}>${t("tenantChannels.cancel")}</button>
          </div>
        </form>
      </div>
    `;
  }

  private renderAppFormCard(app: ChannelApp, i: number) {
    const hasExistingAgent = !!app.agent;
    return html`
      <div class="app-form-card">
        <div class="app-form-header">
          <span>${t("tenantChannels.appLabel").replace("{index}", String(i + 1))}</span>
          <button type="button" class="remove-app" @click=${() => this.removeApp(i)}>${t("tenantChannels.removeApp")}</button>
        </div>

        <!-- Feishu mode selector (only for feishu channel without existing app) -->
        ${this.formChannelType === "feishu" && !app.id ? html`
          <div class="feishu-mode-bar">
            <button type="button" class="feishu-mode-btn ${app.feishuMode === "scan" ? "active" : ""}"
              @click=${() => this.setFeishuMode(i, "scan")}>&#x1F4F1; ${t("tenantChannels.feishuScanCreate")}</button>
            <button type="button" class="feishu-mode-btn ${(app.feishuMode ?? "manual") === "manual" ? "active" : ""}"
              @click=${() => this.setFeishuMode(i, "manual")}>&#x2328;&#xFE0F; ${t("tenantChannels.feishuManualBind")}</button>
          </div>
          ${app.feishuMode === "scan" ? html`
            ${app.feishuVerificationUrl ? html`
              <div class="qr-container">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(app.feishuVerificationUrl)}" alt="QR Code" />
              </div>
              <div class="qr-hint">${t("tenantChannels.feishuScanHint")}</div>
              ${app.feishuPolling ? html`
                <div class="qr-polling">
                  <span class="dot">&#x25CF;</span> ${t("tenantChannels.feishuPolling")}
                </div>
              ` : nothing}
            ` : html`
              <div class="qr-hint">${t("tenantChannels.feishuInitializing")}</div>
            `}
          ` : nothing}
        ` : nothing}

        <!-- App config fields -->
        ${this.formChannelType !== "feishu" || app.feishuMode !== "scan" || app.id ? html`
        <div class="form-row">
          <div class="form-field">
            <label>${t("tenantChannels.appId")}</label>
            <input type="text" .placeholder=${t("tenantChannels.appIdPlaceholder")}
              .value=${app.appId}
              @input=${(e: InputEvent) => this.updateApp(i, "appId", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>${t("tenantChannels.appSecret")}</label>
            <div class="secret-wrap">
              <input type="password" .placeholder=${t("tenantChannels.appSecretPlaceholder")}
                .value=${app.appSecret}
                @input=${(e: InputEvent) => this.updateApp(i, "appSecret", (e.target as HTMLInputElement).value)} />
              <button type="button" class="eye-btn"
                @mousedown=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "text"; }}
                @mouseup=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
                @mouseleave=${(e: Event) => { const wrap = (e.target as HTMLElement).closest('.secret-wrap')!; (wrap.querySelector('input') as HTMLInputElement).type = "password"; }}
              ><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
            </div>
          </div>
        </div>
        ` : nothing}
        <div class="form-row">
          <div class="form-field">
            <label>${t("tenantChannels.botName")}</label>
            <input type="text" .placeholder=${t("tenantChannels.botNamePlaceholder")}
              .value=${app.botName}
              @input=${(e: InputEvent) => this.updateApp(i, "botName", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>${t("tenantChannels.groupPolicy")}</label>
            <select
              @change=${(e: Event) => this.updateApp(i, "groupPolicy", (e.target as HTMLSelectElement).value)}>
              ${this.policyOptions.map((p) => html`<option value=${p.value} ?selected=${p.value === app.groupPolicy}>${p.label}</option>`)}
            </select>
          </div>
        </div>

        <!-- Agent config fields (embedded in each app) -->
        <div class="agent-section-label">${t("tenantChannels.agentConfig")}</div>
        <div class="form-row">
          <div class="form-field">
            <label>${t("tenantChannels.agentDisplayName")}</label>
            <input type="text" .placeholder=${t("tenantChannels.agentDisplayNamePlaceholder")}
              .value=${app.formAgentDisplayName ?? ""}
              @input=${(e: InputEvent) => this.updateApp(i, "formAgentDisplayName", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>${t("tenantChannels.agentId")}</label>
            <input type="text" .placeholder=${t("tenantChannels.agentIdPlaceholder")} ?disabled=${hasExistingAgent}
              pattern="^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$"
              .title=${t("tenantChannels.agentIdPattern")}
              .value=${app.formAgentId ?? ""}
              @input=${(e: InputEvent) => {
                this.updateApp(i, "formAgentId", (e.target as HTMLInputElement).value);
                const apps = [...this.formApps];
                apps[i].formAgentIdManuallyEdited = true;
                this.formApps = apps;
              }} />
            <div class="form-hint">
              ${hasExistingAgent ? t("tenantChannels.agentIdReadonly") : t("tenantChannels.agentIdHint")}
            </div>
          </div>
        </div>
        <div class="form-field" style="margin-bottom:0.5rem">
          <label>${t("tenantChannels.modelBinding")} <span style="color:var(--text-muted,#525252);font-weight:400">${t("tenantChannels.modelBindingHint")}</span></label>
          ${this.flatModels.length === 0 ? html`
            <div class="form-hint" style="padding:0.3rem 0">${t("tenantChannels.noModelsAvailable").split(t("tenantChannels.addModelLink"))[0]}<a href=${this.modelManagePath} style="color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer">${t("tenantChannels.addModelLink")}</a></div>
          ` : html`
            <table class="model-select-table">
              <thead>
                <tr>
                  <th style="width:2rem"></th>
                  <th>${t("tenantChannels.modelId")}</th>
                  <th>${t("tenantChannels.modelName")}</th>
                  <th>${t("tenantChannels.provider")}</th>
                  <th style="width:4.5rem;text-align:center">${t("tenantChannels.default")}</th>
                </tr>
              </thead>
              <tbody>
                ${this.flatModels.map((m) => {
                  const selected = this.isAppModelSelected(app, m.providerId, m.modelId);
                  const isDefault = this.isAppModelDefault(app, m.providerId, m.modelId);
                  return html`
                    <tr class=${selected ? "model-row selected" : "model-row"}>
                      <td>
                        <input type="checkbox" .checked=${selected}
                          @change=${() => this.toggleAppModel(i, m.providerId, m.modelId)} />
                      </td>
                      <td>${m.modelId}</td>
                      <td>${m.modelName}</td>
                      <td style="color:var(--text-secondary,#a3a3a3)">${m.providerName}</td>
                      <td style="text-align:center">
                        ${selected ? html`
                          <input type="radio" name="defaultModel-${i}" .checked=${isDefault}
                            @change=${() => this.setAppDefaultModel(i, m.providerId, m.modelId)} />
                        ` : nothing}
                      </td>
                    </tr>
                  `;
                })}
              </tbody>
            </table>
            ${(app.formAgentModelConfig ?? []).length > 0 ? html`
              <div class="form-hint">
                ${t("tenantChannels.selectedCount").replace("{count}", String(app.formAgentModelConfig!.length)).replace("{default}", (() => {
                  const d = app.formAgentModelConfig!.find((e) => e.isDefault);
                  if (!d) return t("tenantChannels.notSet");
                  const fm = this.flatModels.find((m) => m.providerId === d.providerId && m.modelId === d.modelId);
                  return fm ? `${fm.modelName} (${fm.providerName})` : d.modelId;
                })())}
              </div>
            ` : nothing}
          `}
        </div>
        <div class="form-field" style="margin-bottom:0.25rem">
          <label>${t("tenantChannels.systemPrompt")}</label>
          <textarea .placeholder=${t("tenantChannels.systemPromptPlaceholder")}
            .value=${app.formAgentSystemPrompt ?? ""}
            @input=${(e: InputEvent) => this.updateApp(i, "formAgentSystemPrompt", (e.target as HTMLTextAreaElement).value)}></textarea>
        </div>

        <!-- Tool access control -->
        <div class="tools-section">
          <div class="tools-header" @click=${() => this.toggleAppToolsExpanded(i)}>
            <div class="tools-header-left">
              <span class="tools-header-arrow ${app.formAgentToolsExpanded ? "open" : ""}">&#9654;</span>
              <span>${t("tenantChannels.toolAccess")}</span>
            </div>
            <span style="font-size:0.72rem;color:var(--text-muted,#525252)">
              ${(() => {
                const denySet = new Set(app.formAgentToolsDeny ?? []);
                const enabled = ALL_TOOL_IDS.filter((id) => !denySet.has(id)).length;
                return t("tenantChannels.toolsEnabled").replace("{enabled}", String(enabled)).replace("{total}", String(ALL_TOOL_IDS.length));
              })()}
            </span>
          </div>
          ${app.formAgentToolsExpanded ? html`
            <div class="tools-body">
              <div class="form-hint" style="margin-bottom:0.4rem">
                ${t("tenantChannels.toolsHint")}
              </div>
              <div class="tools-actions">
                <button type="button" class="btn btn-outline btn-sm" @click=${() => this.toggleAllAppTools(i, true)}>${t("tenantChannels.enableAll")}</button>
                <button type="button" class="btn btn-outline btn-sm" @click=${() => this.toggleAllAppTools(i, false)}>${t("tenantChannels.disableAll")}</button>
              </div>
              ${this.toolGroups.map((group) => {
                const denySet = new Set(app.formAgentToolsDeny ?? []);
                const enabledCount = group.tools.filter((tl) => !denySet.has(tl.id)).length;
                const allEnabled = enabledCount === group.tools.length;
                const someEnabled = enabledCount > 0 && enabledCount < group.tools.length;
                return html`
                  <div class="tools-group-header">
                    <input type="checkbox" class="tools-group-checkbox"
                      .checked=${allEnabled}
                      .indeterminate=${someEnabled}
                      @change=${(e: Event) => { e.stopPropagation(); this.toggleGroupTools(i, group.id, (e.target as HTMLInputElement).checked); }} />
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
                        @change=${(e: Event) => this.toggleAppTool(i, tool.id, (e.target as HTMLInputElement).checked)} />
                    </div>
                  `)}
                `;
              })}
            </div>
          ` : nothing}
        </div>
      </div>
    `;
  }
}
