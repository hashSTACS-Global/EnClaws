/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * OpenClaw Lark/Feishu plugin entry point.
 *
 * Registers the Feishu channel and all tool families:
 * doc, wiki, drive, perm, bitable, task, calendar.
 */

import type { OpenClawPluginApi } from 'openclaw/plugin-sdk';
import { emptyPluginConfigSchema } from 'openclaw/plugin-sdk';
import { feishuPlugin } from './src/channel/plugin';
import { LarkClient } from './src/core/lark-client';
import { registerOapiTools } from './src/tools/oapi/index';
import { registerFeishuMcpDocTools } from './src/tools/mcp/doc/index';
import { registerFeishuOAuthTool } from './src/tools/oauth';
import { registerFeishuOAuthBatchAuthTool } from './src/tools/oauth-batch-auth';
import { registerFeishuPreAuthTool } from './src/tools/pre-auth';
import {
  runDiagnosis,
  formatDiagReportCli,
  traceByMessageId,
  formatTraceOutput,
  analyzeTrace,
} from './src/commands/diagnose';
import { registerCommands } from './src/commands/index';
import { larkLogger } from './src/core/lark-logger';
import { emitSecurityWarnings } from './src/core/security-check';
import { getPreAuthToolActions, expandToSkillActions, SKILL_TOOL_ACTIONS } from './src/core/skill-scopes';

const log = larkLogger('plugin');

// ---------------------------------------------------------------------------
// Re-exports for external consumers
// ---------------------------------------------------------------------------

export { monitorFeishuProvider } from './src/channel/monitor';
export { sendMessageFeishu, sendCardFeishu, updateCardFeishu, editMessageFeishu } from './src/messaging/outbound/send';
export { getMessageFeishu } from './src/messaging/outbound/fetch';
export {
  uploadImageLark,
  uploadFileLark,
  sendImageLark,
  sendFileLark,
  sendAudioLark,
  uploadAndSendMediaLark,
} from './src/messaging/outbound/media';
export {
  sendTextLark,
  sendCardLark,
  sendMediaLark,
  type SendTextLarkParams,
  type SendCardLarkParams,
  type SendMediaLarkParams,
} from './src/messaging/outbound/deliver';
export { type FeishuChannelData } from './src/messaging/outbound/outbound';
export { probeFeishu } from './src/channel/probe';
export {
  addReactionFeishu,
  removeReactionFeishu,
  listReactionsFeishu,
  FeishuEmoji,
  VALID_FEISHU_EMOJI_TYPES,
} from './src/messaging/outbound/reactions';
export { forwardMessageFeishu } from './src/messaging/outbound/forward';
export {
  updateChatFeishu,
  addChatMembersFeishu,
  removeChatMembersFeishu,
  listChatMembersFeishu,
} from './src/messaging/outbound/chat-manage';
export { feishuMessageActions } from './src/messaging/outbound/actions';
export {
  mentionedBot,
  nonBotMentions,
  extractMessageBody,
  formatMentionForText,
  formatMentionForCard,
  formatMentionAllForText,
  formatMentionAllForCard,
  buildMentionedMessage,
  buildMentionedCardContent,
  type MentionInfo,
} from './src/messaging/inbound/mention';
export { feishuPlugin } from './src/channel/plugin';
export type {
  MessageContext,
  RawMessage,
  RawSender,
  FeishuMessageContext,
  FeishuReactionCreatedEvent,
} from './src/messaging/types';
export { handleFeishuReaction } from './src/messaging/inbound/reaction-handler';
export { parseMessageEvent } from './src/messaging/inbound/parse';
export { checkMessageGate } from './src/messaging/inbound/gate';
export { isMessageExpired } from './src/messaging/inbound/dedup';

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

const plugin = {
  id: 'openclaw-lark',
  name: 'Feishu',
  description: 'Lark/Feishu channel plugin with im/doc/wiki/drive/task/calendar tools',
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    LarkClient.setRuntime(api.runtime);
    api.registerChannel({ plugin: feishuPlugin });

    // ========================================

    // Register OAPI tools (calendar, task - using Feishu Open API directly)
    registerOapiTools(api);

    // Register MCP doc tools (using Model Context Protocol)
    registerFeishuMcpDocTools(api);

    // Register OAuth tool (UAT device flow authorization)
    registerFeishuOAuthTool(api);

    // Register OAuth batch auth tool (batch authorization for all app scopes)
    registerFeishuOAuthBatchAuthTool(api);

    // Register pre-auth tool (proactive permission check before skill execution)
    registerFeishuPreAuthTool(api);

    // ---- L1: Prompt injection — train AI to call feishu_pre_auth proactively ----

    api.on('before_prompt_build', () => {
      // 动态构建 skill → tool_actions 查找表，让 AI 根据意图选择正确的参数
      const skillEntries = Object.entries(SKILL_TOOL_ACTIONS);
      if (skillEntries.length === 0) return;

      const table = skillEntries
        .map(([name, actions]) => `- ${name}: \`{"tool_actions": ${JSON.stringify(actions)}}\``)
        .join('\n');

      return {
        prependContext: [
          '## 飞书工具权限预检（必读）',
          '',
          '在使用任何 feishu_ 开头的工具之前，**必须**先调用 `feishu_pre_auth` 工具进行权限预检。',
          '',
          '### 步骤',
          '1. 根据用户意图，从下方查找表中选择对应的 Skill',
          '2. 调用 `feishu_pre_auth`，传入该 Skill 的 tool_actions',
          '3. 返回 `all_authorized: true` → 继续执行；否则按指引完成授权',
          '',
          '### Skill 查找表',
          table,
          '',
          '### 示例',
          '',
          '用户：帮我创建一个日程',
          '',
          '正确流程：',
          '1. 意图 → 日历 → 选择 feishu-calendar',
          '2. 先调用 `feishu_pre_auth({"tool_actions": ["feishu_search_user.default", "feishu_calendar_calendar.list", "feishu_calendar_event.create", ...]})`',
          '3. 确认 all_authorized: true 后，再调用 feishu_calendar_event.create',
          '',
          '错误流程（禁止）：',
          '1. 直接调用 feishu_calendar_event.create → ❌ 会被拦截',
          '',
          '⚠️ 每个会话只需预检一次，同 Skill 内的工具无需重复预检。',
          '⚠️ 跳过预检会导致多次弹出授权弹窗，严重影响用户体验。',
        ].join('\n'),
      };
    });

    // ---- L2: Tool call hooks (pre-auth enforcement fallback + tracing) ----

    // 按 sessionKey 跟踪已预检的 tool_actions，避免重复弹授权
    const preAuthedActions = new Map<string, Set<string>>();
    const MAX_TRACKED_SESSIONS = 200;
    // 暂存 pre-auth 调用的参数，等 after_tool_call 确认成功后再记录
    const pendingPreAuth = new Map<string, { sessionKey: string; actions: string[] }>();
    // 拦截计数器：同一 session 同一 apiName 被 block 超过阈值后放行，避免死循环
    const blockCounts = new Map<string, Map<string, number>>();
    const MAX_BLOCKS_BEFORE_FALLBACK = 2;

    api.on('before_tool_call', (event, ctx: { sessionKey?: string } | undefined) => {
      const sessionKey = ctx?.sessionKey ?? '__default__';

      log.warn(`[pre-auth-debug] before_tool_call: ${event.toolName} session=${sessionKey}`);

      // 1. feishu_pre_auth 调用：暂存参数（不重置 blockCounts，等 after_tool_call 确认成功后再清）
      if (event.toolName === 'feishu_pre_auth') {
        const actions = event.params?.tool_actions;
        if (Array.isArray(actions)) {
          pendingPreAuth.set(sessionKey, { sessionKey, actions: actions as string[] });
          log.warn(`[pre-auth-debug] stored pending: ${actions.length} actions session=${sessionKey}`);
        }
        return;
      }

      // 2. 仅对 feishu_ 开头的工具强制预检
      if (!event.toolName.startsWith('feishu_')) return;

      // 3. 构造 tool_action key
      const action = (event.params?.action as string) ?? 'default';
      const apiName = `${event.toolName}.${action}`;

      // 4. 查找 tool_actions（仅 1-2 个 skill 的工具可确定，共享工具放行）
      const toolActions = getPreAuthToolActions(apiName);
      if (!toolActions) return;

      // 5. 已预检 → 放行
      const set = preAuthedActions.get(sessionKey);
      if (set?.has(apiName)) {
        log.warn(`[pre-auth-debug] ${apiName} already pre-authed, letting through`);
        return;
      }

      log.warn(`[pre-auth-debug] ${apiName} NOT pre-authed. sessions=[${[...(preAuthedActions.keys())]}] set=${set?.size ?? 'none'}`);

      // 6. 安全阀：block 超过阈值后放行，退化为 auto-auth
      let sessionBlocks = blockCounts.get(sessionKey);
      if (!sessionBlocks) {
        sessionBlocks = new Map();
        blockCounts.set(sessionKey, sessionBlocks);
      }
      const count = (sessionBlocks.get(apiName) ?? 0) + 1;
      sessionBlocks.set(apiName, count);
      if (count > MAX_BLOCKS_BEFORE_FALLBACK) {
        log.warn(`[pre-auth-debug] safety valve: ${apiName} count=${count}, letting through`);
        return;
      }

      // 7. 未预检 → 阻止，提示 AI 先调 feishu_pre_auth
      log.warn(`[pre-auth-debug] BLOCKING ${apiName} (${count}/${MAX_BLOCKS_BEFORE_FALLBACK})`);
      return {
        block: true,
        blockReason:
          `请先调用 feishu_pre_auth({"tool_actions": ${JSON.stringify(toolActions)}}) 进行权限预检。`,
      };
    });

    api.on('after_tool_call', (event, ctx: { sessionKey?: string } | undefined) => {
      if (event.error) {
        log.error(`tool fail: ${event.toolName} ${event.error} (${event.durationMs ?? 0}ms)`);
      } else {
        log.info(`tool done: ${event.toolName} ok (${event.durationMs ?? 0}ms)`);
      }

      // feishu_pre_auth 执行后，记录 tool_actions 为已预检
      if (event.toolName === 'feishu_pre_auth') {
        const ctxSessionKey = ctx?.sessionKey ?? '__default__';
        // 优先按 ctxSessionKey 查找；若未命中则遍历 pending 列表（平台 bug：after_tool_call 的 ctx 可能缺少 sessionKey）
        let pending = pendingPreAuth.get(ctxSessionKey);
        if (pending) {
          pendingPreAuth.delete(ctxSessionKey);
        } else {
          for (const [key, value] of pendingPreAuth) {
            pending = value;
            pendingPreAuth.delete(key);
            break;
          }
        }

        log.warn(`[pre-auth-debug] after_tool_call: pre_auth ctxSession=${ctxSessionKey} realSession=${pending?.sessionKey} error=${!!event.error} pending=${!!pending}`);

        if (!pending) return;

        // pre-auth 无报错即记录（包括返回 OAuth 卡片的情况）
        if (event.error) {
          log.warn(`[pre-auth-debug] pre_auth had error, NOT recording`);
          return;
        }

        // 使用 before_tool_call 记录的真实 sessionKey，而非 after_tool_call 的 ctx
        const realSessionKey = pending.sessionKey;
        let set = preAuthedActions.get(realSessionKey);
        if (!set) {
          if (preAuthedActions.size >= MAX_TRACKED_SESSIONS) {
            const oldest = preAuthedActions.keys().next().value;
            if (oldest !== undefined) preAuthedActions.delete(oldest);
          }
          set = new Set();
          preAuthedActions.set(realSessionKey, set);
        }
        const expanded = expandToSkillActions(pending.actions);
        for (const a of expanded) set.add(a);
        blockCounts.delete(realSessionKey);
        log.warn(`[pre-auth-debug] RECORDED ${expanded.length} actions for session=${realSessionKey}`);
      }
    });

    // ---- Diagnostic commands ----

    // CLI: openclaw feishu-diagnose [--trace <messageId>]
    api.registerCli(
      (ctx) => {
        ctx.program
          .command('feishu-diagnose')
          .description('运行飞书插件诊断，检查配置、连通性和权限状态')
          .option('--trace <messageId>', '按 message_id 追踪完整处理链路')
          .option('--analyze', '分析追踪日志（需配合 --trace 使用）')
          .action(async (opts: { trace?: string; analyze?: boolean }) => {
            try {
              if (opts.trace) {
                const lines = await traceByMessageId(opts.trace);
                // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                console.log(formatTraceOutput(lines, opts.trace));
                if (opts.analyze && lines.length > 0) {
                  // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                  console.log(analyzeTrace(lines, opts.trace));
                }
              } else {
                const report = await runDiagnosis({
                  config: ctx.config,
                  logger: ctx.logger,
                });
                // eslint-disable-next-line no-console -- CLI 命令直接输出到终端
                console.log(formatDiagReportCli(report));
                if (report.overallStatus === 'unhealthy') {
                  process.exitCode = 1;
                }
              }
            } catch (err) {
              ctx.logger.error(`诊断命令执行失败: ${err}`);
              process.exitCode = 1;
            }
          });
      },
      { commands: ['feishu-diagnose'] },
    );

    // Chat commands: /feishu_diagnose, /feishu_doctor, /feishu_auth, /feishu
    registerCommands(api);

    // ---- Multi-account security checks ----
    if (api.config) {
      emitSecurityWarnings(api.config, api.logger);
    }
  },
};

export default plugin;
