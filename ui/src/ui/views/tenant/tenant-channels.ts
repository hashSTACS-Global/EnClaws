/**
 * Tenant channel management view.
 *
 * Create, edit, and delete channels with structured app configs.
 * Each app has a one-to-one linked agent config.
 */

import { html, css, LitElement, nothing } from "lit";
import { customElement, state, property } from "lit/decorators.js";
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

const BUILTIN_TOOL_GROUPS: ToolGroup[] = [
  { id: "fs", label: "文件操作", tools: [
    { id: "read", label: "read", description: "读取文件内容" },
    { id: "write", label: "write", description: "创建或覆写文件" },
    { id: "edit", label: "edit", description: "精确编辑文件" },
    { id: "apply_patch", label: "apply_patch", description: "应用多文件补丁" },
    { id: "grep", label: "grep", description: "搜索文件内容" },
    { id: "find", label: "find", description: "按模式查找文件" },
    { id: "ls", label: "ls", description: "列出目录内容" },
  ]},
  { id: "runtime", label: "运行时", tools: [
    { id: "exec", label: "exec", description: "执行 Shell 命令" },
    { id: "process", label: "process", description: "管理后台进程" },
  ]},
  { id: "web", label: "网络", tools: [
    { id: "web_search", label: "web_search", description: "搜索网页" },
    { id: "web_fetch", label: "web_fetch", description: "获取网页内容" },
  ]},
  { id: "memory", label: "记忆", tools: [
    { id: "memory_search", label: "memory_search", description: "语义搜索记忆" },
    { id: "memory_get", label: "memory_get", description: "读取记忆文件" },
  ]},
  { id: "sessions", label: "会话", tools: [
    { id: "sessions_list", label: "sessions_list", description: "列出会话" },
    { id: "sessions_history", label: "sessions_history", description: "查看会话历史" },
    { id: "sessions_send", label: "sessions_send", description: "发送消息到会话" },
    { id: "sessions_spawn", label: "sessions_spawn", description: "创建子代理" },
    { id: "subagents", label: "subagents", description: "管理子代理" },
    { id: "session_status", label: "session_status", description: "查看会话状态" },
  ]},
  { id: "messaging", label: "消息", tools: [
    { id: "message", label: "message", description: "发送消息和频道操作" },
  ]},
  { id: "automation", label: "自动化", tools: [
    { id: "cron", label: "cron", description: "定时任务调度" },
    { id: "gateway", label: "gateway", description: "网关控制" },
  ]},
  { id: "ui", label: "界面", tools: [
    { id: "browser", label: "browser", description: "控制浏览器" },
    { id: "canvas", label: "canvas", description: "控制画布" },
  ]},
  { id: "other", label: "其他", tools: [
    { id: "nodes", label: "nodes", description: "节点和设备" },
    { id: "agents_list", label: "agents_list", description: "列出代理" },
    { id: "image", label: "image", description: "图片理解" },
    { id: "tts", label: "tts", description: "文本转语音" },
  ]},
  { id: "feishu-docs", label: "飞书 · 文档", tools: [
    { id: "feishu_create_doc", label: "feishu_create_doc", description: "创建文档" },
    { id: "feishu_fetch_doc", label: "feishu_fetch_doc", description: "读取文档内容" },
    { id: "feishu_update_doc", label: "feishu_update_doc", description: "更新文档内容" },
    { id: "feishu_doc_comments", label: "feishu_doc_comments", description: "文档评论" },
    { id: "feishu_doc_media", label: "feishu_doc_media", description: "文档媒体（图片/文件）" },
    { id: "feishu_search_doc_wiki", label: "feishu_search_doc_wiki", description: "搜索云文档和知识库" },
  ]},
  { id: "feishu-wiki", label: "飞书 · 知识库", tools: [
    { id: "feishu_wiki_space", label: "feishu_wiki_space", description: "知识库空间管理" },
    { id: "feishu_wiki_space_node", label: "feishu_wiki_space_node", description: "知识库节点管理" },
  ]},
  { id: "feishu-drive", label: "飞书 · 云盘", tools: [
    { id: "feishu_drive_file", label: "feishu_drive_file", description: "云盘文件操作" },
    { id: "feishu_sheet", label: "feishu_sheet", description: "多维电子表格" },
    { id: "feishu_bitable_app", label: "feishu_bitable_app", description: "多维表格应用" },
    { id: "feishu_bitable_app_table", label: "feishu_bitable_app_table", description: "多维表格数据表" },
    { id: "feishu_bitable_app_table_record", label: "feishu_bitable_app_table_record", description: "多维表格记录" },
    { id: "feishu_bitable_app_table_field", label: "feishu_bitable_app_table_field", description: "多维表格字段" },
    { id: "feishu_bitable_app_table_view", label: "feishu_bitable_app_table_view", description: "多维表格视图" },
  ]},
  { id: "feishu-calendar", label: "飞书 · 日历", tools: [
    { id: "feishu_calendar_calendar", label: "feishu_calendar_calendar", description: "日历管理" },
    { id: "feishu_calendar_event", label: "feishu_calendar_event", description: "日历事件（订/改/删会议）" },
    { id: "feishu_calendar_event_attendee", label: "feishu_calendar_event_attendee", description: "会议参与者管理" },
    { id: "feishu_calendar_freebusy", label: "feishu_calendar_freebusy", description: "查询忙闲状态" },
  ]},
  { id: "feishu-task", label: "飞书 · 任务", tools: [
    { id: "feishu_task_task", label: "feishu_task_task", description: "任务管理" },
    { id: "feishu_task_tasklist", label: "feishu_task_tasklist", description: "任务清单" },
    { id: "feishu_task_subtask", label: "feishu_task_subtask", description: "子任务" },
    { id: "feishu_task_comment", label: "feishu_task_comment", description: "任务评论" },
  ]},
  { id: "feishu-im", label: "飞书 · 消息", tools: [
    { id: "feishu_im_user_message", label: "feishu_im_user_message", description: "发送/回复消息" },
    { id: "feishu_im_user_get_messages", label: "feishu_im_user_get_messages", description: "获取消息记录" },
    { id: "feishu_im_user_get_thread_messages", label: "feishu_im_user_get_thread_messages", description: "获取话题消息" },
    { id: "feishu_im_user_search_messages", label: "feishu_im_user_search_messages", description: "搜索消息" },
    { id: "feishu_im_user_fetch_resource", label: "feishu_im_user_fetch_resource", description: "获取消息资源" },
    { id: "feishu_chat", label: "feishu_chat", description: "群聊管理" },
    { id: "feishu_chat_members", label: "feishu_chat_members", description: "群成员管理" },
  ]},
  { id: "feishu-user", label: "飞书 · 通讯录", tools: [
    { id: "feishu_get_user", label: "feishu_get_user", description: "获取用户信息" },
    { id: "feishu_search_user", label: "feishu_search_user", description: "搜索用户" },
  ]},
];

interface ChannelApp {
  id?: string;
  appId: string;
  appSecret: string;
  botName: string;
  groupPolicy: ChannelPolicy;
  isActive?: boolean;
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

const CHANNEL_TYPES = [
  { value: "telegram", label: "Telegram" },
  { value: "discord", label: "Discord" },
  { value: "slack", label: "Slack" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "feishu", label: "飞书" },
  { value: "dingtalk", label: "钉钉" },
  { value: "wechat", label: "微信" },
  { value: "wecom", label: "企业微信" },
  { value: "web", label: "网页" },
];

const POLICY_OPTIONS: { value: ChannelPolicy; label: string }[] = [
  { value: "open", label: "开放" },
  { value: "allowlist", label: "白名单" },
  { value: "disabled", label: "禁用" },
];

@customElement("tenant-channels-view")
export class TenantChannelsView extends LitElement {
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
    .card-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(380px, 1fr)); gap: 1rem; }
    .channel-card {
      background: var(--card, #141414); border: 1px solid var(--border, #262626);
      border-radius: var(--radius-lg, 8px); padding: 1.25rem;
    }
    .channel-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; }
    .channel-name { font-size: 0.95rem; font-weight: 600; }
    .channel-type {
      font-size: 0.75rem; padding: 0.15rem 0.45rem; border-radius: 4px;
      background: var(--border, #262626); color: var(--text-secondary, #a3a3a3);
    }
    .policy-badge {
      font-size: 0.7rem; padding: 0.1rem 0.4rem; border-radius: 4px; margin-left: 0.4rem;
    }
    .policy-badge.open { background: #052e16; color: #86efac; }
    .policy-badge.allowlist { background: #1e1b4b; color: #a5b4fc; }
    .policy-badge.disabled { background: #2d1215; color: #fca5a5; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 0.3rem; }
    .status-dot.active { background: #22c55e; }
    .status-dot.inactive { background: #525252; }
    .channel-actions { display: flex; gap: 0.4rem; margin-top: 0.75rem; }
    .apps-section { margin-top: 0.75rem; border-top: 1px solid var(--border, #262626); padding-top: 0.5rem; }
    .apps-section-title { font-size: 0.75rem; color: var(--text-muted, #525252); margin-bottom: 0.4rem; }
    .app-item {
      font-size: 0.8rem; padding: 0.5rem 0.6rem; background: var(--bg, #0a0a0a);
      border-radius: 4px; margin-bottom: 0.3rem;
    }
    .app-item-row { display: flex; justify-content: space-between; align-items: center; }
    .app-item-info { display: flex; gap: 0.5rem; align-items: center; }
    .agent-info {
      font-size: 0.72rem; color: var(--text-secondary, #a3a3a3);
      margin-top: 0.25rem; padding-left: 0.2rem;
    }
    .agent-tag {
      display: inline-block; font-size: 0.68rem; padding: 0.1rem 0.35rem;
      background: #1a1a2e; border: 1px solid #2d2d44; border-radius: 3px;
      color: #a5b4fc; margin-right: 0.3rem;
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
  @state() private error = "";
  @state() private success = "";
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
    this.error = "";
    try {
      const result = await this.rpc("tenant.channels.list") as { channels: TenantChannel[] };
      this.channels = result.channels ?? [];
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "加载频道列表失败");
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
      this.showError(`飞书注册初始化失败: ${err instanceof Error ? err.message : String(err)}`);
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
          this.showSuccess("飞书机器人创建成功，凭证已自动填入");
        } else if (result.status === "error") {
          clearInterval(timer);
          const apps = [...this.formApps];
          apps[currentIndex].feishuPolling = false;
          apps[currentIndex].feishuPollTimer = undefined;
          this.formApps = apps;
          this.showError(`飞书注册失败: ${result.errorDescription ?? result.error ?? "未知错误"}`);
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
    if (!this.formChannelName) return;

    // Validate apps
    for (const app of this.formApps) {
      if (!app.appId) {
        this.showError("每个应用必须填写 App ID");
        return;
      }
      if (!app.formAgentModelConfig || app.formAgentModelConfig.length === 0) {
        const name = app.botName || app.appId;
        this.showError(`应用「${name}」必须至少选择一个模型`);
        return;
      }
    }

    this.saving = true;
    this.error = "";
    this.success = "";

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

        this.showSuccess("频道及关联代理已更新");
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
        this.showSuccess(`频道 ${this.formChannelName} 及关联代理已创建`);
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
      this.showError(err instanceof Error ? err.message : "保存失败");
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
    const group = BUILTIN_TOOL_GROUPS.find((g) => g.id === groupId);
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
      const allIds = BUILTIN_TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
      apps[appIndex] = { ...apps[appIndex], formAgentToolsDeny: allIds };
    }
    this.formApps = apps;
  }

  private toggleAppToolsExpanded(appIndex: number) {
    const apps = [...this.formApps];
    apps[appIndex] = { ...apps[appIndex], formAgentToolsExpanded: !apps[appIndex].formAgentToolsExpanded };
    this.formApps = apps;
  }

  private async handleDelete(channel: TenantChannel) {
    if (!confirm(`确定要删除频道 ${channel.channelName ?? channel.channelType} 吗？`)) return;
    this.error = "";
    try {
      await this.rpc("tenant.channels.delete", { channelId: channel.id });
      this.showSuccess(`频道 ${channel.channelName ?? channel.channelType} 已删除`);
      await this.loadChannels();
    } catch (err) {
      this.showError(err instanceof Error ? err.message : "删除失败");
    }
  }

  private get modelManagePath() {
    return pathForTab("tenant-models", inferBasePathFromPathname(window.location.pathname));
  }

  render() {
    const noModels = this.availableModels.length === 0;
    return html`
      <div class="header">
        <h2>频道管理</h2>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-outline" @click=${() => this.loadChannels()}>刷新</button>
          <button class="btn btn-primary" ?disabled=${noModels && !this.showForm}
            @click=${() => { if (this.showForm) { this.clearAllFeishuTimers(); this.showForm = false; } else { this.startCreate(); } }}>
            ${this.showForm ? "取消" : "创建频道"}
          </button>
        </div>
      </div>

      ${this.error ? html`<div class="error-msg">${this.error}</div>` : nothing}
      ${this.success ? html`<div class="success-msg">${this.success}</div>` : nothing}

      ${this.showForm ? this.renderForm() : nothing}

      ${this.loading ? html`<div class="loading">加载中...</div>` : this.channels.length === 0 ? html`<div class="empty">${noModels ? html`暂无可用模型，请在模型管理<a href=${this.modelManagePath} style="color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer">添加模型</a>` : html`暂无频道，点击"创建频道"添加`}</div>` : html`
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
          <h3>&#x2705; 机器人创建成功</h3>
          <p style="font-size:0.84rem;color:var(--text-secondary,#a3a3a3);margin:0 0 0.5rem">
            机器人凭证已自动填入表单。为了让机器人正常使用全部功能，还需要在飞书开放平台完成权限授权。
          </p>
          <ol class="modal-steps">
            <li>点击下方链接，前往飞书开放平台的权限管理页面</li>
            <li>在页面中开通所需的 <strong>应用权限</strong> 和 <strong>用户权限</strong></li>
            <li>完成后点击"发布版本"使权限生效</li>
          </ol>
          <a class="modal-link" href=${authUrl} target="_blank" rel="noopener noreferrer">
            &#x1F517; ${authUrl}
          </a>
          <div class="modal-scopes-label">
            <span>所需权限列表</span>
            <button type="button" class="btn-copy ${this.scopesCopied ? "copied" : ""}"
              @click=${() => this.copyScopes()}>
              ${this.scopesCopied ? "\u2714 已复制" : "\uD83D\uDCCB 复制权限"}
            </button>
          </div>
          <textarea class="modal-scopes-box" readonly
            .value=${JSON.stringify(feishuScopes, null, 2)}></textarea>
          <p style="font-size:0.75rem;color:var(--text-muted,#525252);margin:0.5rem 0 0">
            提示：复制权限后，在飞书开放平台的权限管理页面中批量导入、导出权限开通。如果暂时跳过，后续可随时配置。
          </p>
          <div class="modal-footer">
            <a class="btn btn-primary" href=${authUrl} target="_blank" rel="noopener noreferrer"
              style="text-decoration:none;text-align:center">前往授权</a>
            <button class="btn btn-outline" @click=${() => { this.feishuAuthGuideAppId = null; this.scopesCopied = false; }}>稍后再说</button>
          </div>
        </div>
      </div>
    `;
  }

  private renderChannelCard(ch: TenantChannel) {
    const typeName = CHANNEL_TYPES.find((t) => t.value === ch.channelType)?.label ?? ch.channelType;
    const policyLabel = POLICY_OPTIONS.find((p) => p.value === ch.channelPolicy)?.label ?? ch.channelPolicy;
    return html`
      <div class="channel-card">
        <div class="channel-header">
          <div class="channel-name">
            <span class="status-dot ${ch.isActive ? "active" : "inactive"}"></span>
            ${ch.channelName ?? typeName}
          </div>
          <div>
            <span class="channel-type">${typeName}</span>
            <span class="policy-badge ${ch.channelPolicy}">${policyLabel}</span>
          </div>
        </div>
        ${ch.apps && ch.apps.length > 0 ? html`
          <div class="apps-section">
            <div class="apps-section-title">应用 & 代理 (${ch.apps.length})</div>
            ${ch.apps.map((app) => html`
              <div class="app-item">
                <div class="app-item-row">
                  <div class="app-item-info">
                    <span>${app.botName || app.appId}</span>
                    <span class="policy-badge ${app.groupPolicy}" style="font-size:0.65rem">
                      ${POLICY_OPTIONS.find((p) => p.value === app.groupPolicy)?.label ?? app.groupPolicy}
                    </span>
                  </div>
                  <span style="font-size:0.7rem;color:var(--text-muted,#525252)">${app.appId}</span>
                </div>
                ${app.agent ? html`
                  <div class="agent-info">
                    <span class="agent-tag">代理</span>
                    ${(app.agent.config?.displayName as string) || app.agent.name || app.agent.agentId}
                    <span style="color:var(--text-muted,#525252);margin-left:0.3rem">(${app.agent.agentId})</span>
                  </div>
                ` : nothing}
              </div>
            `)}
          </div>
        ` : nothing}
        <div class="channel-actions">
          <button class="btn btn-outline btn-sm" @click=${() => this.startEdit(ch)}>编辑</button>
          <button class="btn btn-danger btn-sm" @click=${() => this.handleDelete(ch)}>删除</button>
        </div>
      </div>
    `;
  }

  private renderForm() {
    return html`
      <div class="form-card">
        <h3>${this.editingId ? "编辑频道" : "创建频道"}</h3>
        <form @submit=${this.handleSave}>
          <div class="form-row">
            <div class="form-field">
              <label>频道类型</label>
              <select ?disabled=${!!this.editingId}
                @change=${(e: Event) => (this.formChannelType = (e.target as HTMLSelectElement).value)}>
                ${CHANNEL_TYPES.map((ct) => html`<option value=${ct.value} ?selected=${ct.value === this.formChannelType}>${ct.label}</option>`)}
              </select>
            </div>
            <div class="form-field">
              <label>频道名称</label>
              <input type="text" required placeholder="输入频道名称"
                .value=${this.formChannelName}
                @input=${(e: InputEvent) => (this.formChannelName = (e.target as HTMLInputElement).value)} />
            </div>
            <div class="form-field">
              <label>频道策略</label>
              <select
                @change=${(e: Event) => (this.formChannelPolicy = (e.target as HTMLSelectElement).value as ChannelPolicy)}>
                ${POLICY_OPTIONS.map((p) => html`<option value=${p.value} ?selected=${p.value === this.formChannelPolicy}>${p.label}</option>`)}
              </select>
            </div>
          </div>

          <div class="divider"><span>应用 & 代理配置</span></div>

          ${this.formApps.map((app, i) => this.renderAppFormCard(app, i))}

          <button type="button" class="btn btn-outline btn-sm" style="margin-bottom:1rem" @click=${() => this.addApp()}>
            + 添加应用
          </button>

          <div style="display:flex;gap:0.5rem">
            <button class="btn btn-primary" type="submit" ?disabled=${this.saving}>
              ${this.saving ? "保存中..." : "保存"}
            </button>
            <button class="btn btn-outline" type="button" @click=${() => { this.clearAllFeishuTimers(); this.showForm = false; }}>取消</button>
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
          <span>应用 ${i + 1}</span>
          <button type="button" class="remove-app" @click=${() => this.removeApp(i)}>移除</button>
        </div>

        <!-- Feishu mode selector (only for feishu channel without existing app) -->
        ${this.formChannelType === "feishu" && !app.id ? html`
          <div class="feishu-mode-bar">
            <button type="button" class="feishu-mode-btn ${app.feishuMode === "scan" ? "active" : ""}"
              @click=${() => this.setFeishuMode(i, "scan")}>&#x1F4F1; 扫码创建机器人</button>
            <button type="button" class="feishu-mode-btn ${(app.feishuMode ?? "manual") === "manual" ? "active" : ""}"
              @click=${() => this.setFeishuMode(i, "manual")}>&#x2328;&#xFE0F; 绑定机器人</button>
          </div>
          ${app.feishuMode === "scan" ? html`
            ${app.feishuVerificationUrl ? html`
              <div class="qr-container">
                <img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(app.feishuVerificationUrl)}" alt="QR Code" />
              </div>
              <div class="qr-hint">请使用飞书 App 扫描上方二维码</div>
              ${app.feishuPolling ? html`
                <div class="qr-polling">
                  <span class="dot">&#x25CF;</span> 等待扫码确认中...
                </div>
              ` : nothing}
            ` : html`
              <div class="qr-hint">正在初始化...</div>
            `}
          ` : nothing}
        ` : nothing}

        <!-- App config fields -->
        ${this.formChannelType !== "feishu" || app.feishuMode !== "scan" || app.id ? html`
        <div class="form-row">
          <div class="form-field">
            <label>App ID</label>
            <input type="text" required placeholder="应用ID"
              .value=${app.appId}
              @input=${(e: InputEvent) => this.updateApp(i, "appId", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>App Secret</label>
            <div class="secret-wrap">
              <input type="password" placeholder="应用密钥"
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
            <label>Bot 名称</label>
            <input type="text" placeholder="机器人名称"
              .value=${app.botName}
              @input=${(e: InputEvent) => this.updateApp(i, "botName", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>群组策略</label>
            <select
              @change=${(e: Event) => this.updateApp(i, "groupPolicy", (e.target as HTMLSelectElement).value)}>
              ${POLICY_OPTIONS.map((p) => html`<option value=${p.value} ?selected=${p.value === app.groupPolicy}>${p.label}</option>`)}
            </select>
          </div>
        </div>

        <!-- Agent config fields (embedded in each app) -->
        <div class="agent-section-label">代理配置</div>
        <div class="form-row">
          <div class="form-field">
            <label>代理显示名称</label>
            <input type="text" placeholder="我的代理"
              .value=${app.formAgentDisplayName ?? ""}
              @input=${(e: InputEvent) => this.updateApp(i, "formAgentDisplayName", (e.target as HTMLInputElement).value)} />
          </div>
          <div class="form-field">
            <label>代理 ID</label>
            <input type="text" placeholder="my-agent" ?disabled=${hasExistingAgent}
              pattern="^[a-z0-9]([a-z0-9_-]{0,62}[a-z0-9])?$"
              title="仅限小写英文字母、数字、连字符和下划线，1-64位"
              .value=${app.formAgentId ?? ""}
              @input=${(e: InputEvent) => {
                this.updateApp(i, "formAgentId", (e.target as HTMLInputElement).value);
                const apps = [...this.formApps];
                apps[i].formAgentIdManuallyEdited = true;
                this.formApps = apps;
              }} />
            <div class="form-hint">
              ${hasExistingAgent ? "代理 ID 创建后不可修改" : "仅限小写英文、数字、连字符和下划线，由 Bot 名称自动生成"}
            </div>
          </div>
        </div>
        <div class="form-field" style="margin-bottom:0.5rem">
          <label>模型绑定 <span style="color:var(--text-muted,#525252);font-weight:400">（可多选，设置默认，fallback 按顺序）</span></label>
          ${this.flatModels.length === 0 ? html`
            <div class="form-hint" style="padding:0.3rem 0">暂无可用模型，请在模型管理<a href=${this.modelManagePath} style="color:var(--accent,#3b82f6);text-decoration:underline;cursor:pointer">添加模型</a></div>
          ` : html`
            <table class="model-select-table">
              <thead>
                <tr>
                  <th style="width:2rem"></th>
                  <th>模型ID</th>
                  <th>模型名称</th>
                  <th>供应商</th>
                  <th style="width:4.5rem;text-align:center">默认</th>
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
                已选 ${app.formAgentModelConfig!.length} 个，默认：${(() => {
                  const d = app.formAgentModelConfig!.find((e) => e.isDefault);
                  if (!d) return "未设置";
                  const fm = this.flatModels.find((m) => m.providerId === d.providerId && m.modelId === d.modelId);
                  return fm ? `${fm.modelName}（${fm.providerName}）` : d.modelId;
                })()}
              </div>
            ` : nothing}
          `}
        </div>
        <div class="form-field" style="margin-bottom:0.25rem">
          <label>系统提示词</label>
          <textarea placeholder="你是一个有用的助手..."
            .value=${app.formAgentSystemPrompt ?? ""}
            @input=${(e: InputEvent) => this.updateApp(i, "formAgentSystemPrompt", (e.target as HTMLTextAreaElement).value)}></textarea>
        </div>

        <!-- Tool access control -->
        <div class="tools-section">
          <div class="tools-header" @click=${() => this.toggleAppToolsExpanded(i)}>
            <div class="tools-header-left">
              <span class="tools-header-arrow ${app.formAgentToolsExpanded ? "open" : ""}">&#9654;</span>
              <span>工具权限</span>
            </div>
            <span style="font-size:0.72rem;color:var(--text-muted,#525252)">
              ${(() => {
                const allIds = BUILTIN_TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.id));
                const denySet = new Set(app.formAgentToolsDeny ?? []);
                const enabled = allIds.filter((id) => !denySet.has(id)).length;
                return `${enabled}/${allIds.length} 已启用`;
              })()}
            </span>
          </div>
          ${app.formAgentToolsExpanded ? html`
            <div class="tools-body">
              <div class="form-hint" style="margin-bottom:0.4rem">
                默认允许全部工具。取消勾选可禁止代理使用该工具（硬约束，代理将无法调用）。
              </div>
              <div class="tools-actions">
                <button type="button" class="btn btn-outline btn-sm" @click=${() => this.toggleAllAppTools(i, true)}>全部启用</button>
                <button type="button" class="btn btn-outline btn-sm" @click=${() => this.toggleAllAppTools(i, false)}>全部禁用</button>
              </div>
              ${BUILTIN_TOOL_GROUPS.map((group) => {
                const denySet = new Set(app.formAgentToolsDeny ?? []);
                const enabledCount = group.tools.filter((t) => !denySet.has(t.id)).length;
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
