/**
 * OPC agent tool — callable by every tenant agent (employees + opc-notify).
 *
 * Actions:
 *   - notify:      push a notification to the boss (used by all 6 OPC employees).
 *                  Wraps dispatchNotificationCore in-process (no gateway round-trip).
 *   - route_reply: route the boss's IM reply to the active employee.
 *                  TODO: in-process version — currently still via gateway for
 *                  routes that only opc-notify invokes from live sessions
 *                  (those do have gateway auth).
 *
 * Critical: this tool runs inside the server process, so for `notify` we call
 * dispatchNotificationCore directly. Going through `callGatewayTool` fails in
 * cron isolated runs because those don't have ENCLAWS_GATEWAY_TOKEN set.
 */

import { Type } from "@sinclair/typebox";
import { type AnyAgentTool, jsonResult, readStringParam } from "./common.js";
import { callGatewayTool, readGatewayCallOptions } from "./gateway.js";
import { stringEnum } from "../schema/typebox.js";
import { dispatchNotificationCore } from "../../gateway/server-methods/opc-notification-core.js";

const OPC_TOOL_ACTIONS = [
  "notify",                   // freeform text (fallback / error cases)
  "notify_topics",            // topic-planner: daily scan report
  "notify_topics_failed",     // topic-planner: all platforms failed
  "notify_draft_ready",       // content-creator: draft done
  "notify_packs_ready",       // distribution-editor 11:00: packs generated
  "notify_packs_reminder",    // distribution-editor 14:00: 3 variants (none/all/pending)
  "route_reply",
] as const;
const OPC_PRIORITIES = ["normal", "high"] as const;

const OpcToolSchema = Type.Object({
  action: stringEnum(OPC_TOOL_ACTIONS),
  // notify (freeform)
  message: Type.Optional(Type.String()),
  from: Type.Optional(Type.String()),
  priority: Type.Optional(stringEnum(OPC_PRIORITIES)),
  tag: Type.Optional(Type.String()),
  // notify_topics: server-formatted daily scan report
  date: Type.Optional(Type.String()),          // YYYY-MM-DD
  topics: Type.Optional(Type.Array(Type.Object({
    title: Type.String(),
    sources: Type.String(),
    risk: Type.Optional(Type.String()),
  }))),
  // notify_topics_failed: error text per platform
  errors: Type.Optional(Type.Object({
    weibo: Type.Optional(Type.String()),
    zhihu: Type.Optional(Type.String()),
    bilibili: Type.Optional(Type.String()),
  })),
  // notify_draft_ready
  topic_title: Type.Optional(Type.String()),
  // notify_packs_ready: platform → adapted title map
  packs: Type.Optional(Type.Array(Type.Object({
    platform: Type.String(),                   // wechat_mp / xiaohongshu / zhihu / ...
    title: Type.String(),
  }))),
  // notify_packs_reminder
  total: Type.Optional(Type.Number()),
  pending: Type.Optional(Type.Number()),
  pendingByPlatform: Type.Optional(Type.Record(Type.String(), Type.Number())),
  // route_reply
  bossOpenId: Type.Optional(Type.String()),
  gatewayUrl: Type.Optional(Type.String()),
  gatewayToken: Type.Optional(Type.String()),
  timeoutMs: Type.Optional(Type.Number()),
});

const PLATFORM_ZH: Record<string, string> = {
  wechat_mp: "公众号",
  xiaohongshu: "小红书",
  shipinhao: "视频号",
  douyin: "抖音",
  zhihu: "知乎",
};

function platZh(p: string): string {
  return PLATFORM_ZH[p] ?? p;
}

export interface CreateOpcToolOptions {
  /** Tenant context captured at tool creation time, used for in-process calls. */
  tenantId?: string;
  userId?: string;
  /** Agent role for auto-fill of the `from` param (e.g. "topic-planner"). */
  defaultFrom?: string;
  /**
   * Stable author id used for audit log fields when no real user is bound to
   * this tool (agent-scoped cron has `tenantUserId=undefined` by design — the
   * "user" is the agent itself). Pass the agent id here so `created_by` still
   * has a meaningful value instead of an empty string.
   */
  fallbackAuthorId?: string;
}

export function createOpcTool(opts?: CreateOpcToolOptions): AnyAgentTool {
  return {
    label: "OPC",
    name: "opc",
    description:
      "OPC notification + inbox routing. " +
      "action='notify' pushes a message to the boss's IM via the bound notification channel — used by all 6 OPC employees when they finish a workflow step. " +
      "action='route_reply' is for the opc-notify facade agent only — it forwards the boss's IM reply to the currently active employee's isolated session. " +
      "When called by an OPC employee, `from` defaults to that employee's role so you usually only need { action, message }.",
    parameters: OpcToolSchema,
    execute: async (_toolCallId, args) => {
      const params = args as Record<string, unknown>;
      const action = readStringParam(params, "action", { required: true });

      if (action === "notify") {
        if (!opts?.tenantId) {
          throw new Error("opc.notify: tenant context missing (tool was created without tenantId)");
        }
        const authorId = opts.userId ?? opts.fallbackAuthorId ?? "agent";

        const message = readStringParam(params, "message", { required: true });

        // Hard-reject known success-report patterns so LLM is forced to use
        // the structured actions instead of freestyling message text. qwen3.6-plus
        // ignores prompt-level instructions; this is the only reliable enforcement.
        const rejections: Array<{ pattern: RegExp; suggest: string }> = [
          { pattern: /(选题.*已产出|今日.*选题|候选选题|候选.*选题)/,
            suggest: "opc({ action: 'notify_topics', date, topics: [{title, sources, risk}, ...] })" },
          { pattern: /(热榜.*(失败|拉取失败)|scan.*failed|抓取失败)/,
            suggest: "opc({ action: 'notify_topics_failed', date, errors: {...} })" },
          { pattern: /(初稿.*(已完成|完成|待审)|草稿.*待审)/,
            suggest: "opc({ action: 'notify_draft_ready', topic_title })" },
          { pattern: /(发布包.*已就绪|发布包.*生成|已.*改写.*平台|平台.*发布包)/,
            suggest: "opc({ action: 'notify_packs_ready', date, topic_title, packs: [{platform, title}, ...] })" },
          // Wide net for the 14:00 distribution-editor reminder — catches any
          // phrasing that claims to report pack publish status (including "no
          // pending" false-positives where LLM didn't actually check workspace).
          { pattern: /(发布包|待发|待发布|已发|催办|分发提醒|发布提醒|全部发完|无待发)/,
            suggest: "opc({ action: 'notify_packs_reminder', date, total, pending, pendingByPlatform })\n" +
                     "Hint: to fill `total` and `pending` correctly, you MUST first call workspace.list({collection:'publish_packs', since: today}) and count entries by their frontmatter.status. Do not guess." },
        ];
        for (const r of rejections) {
          if (r.pattern.test(message)) {
            throw new Error(
              `opc.notify rejected: this message looks like a known success report. ` +
              `Use the structured action instead to get consistent formatting:\n  ${r.suggest}\n` +
              `action:"notify" is only for error/skip/exceptional cases not covered by a notify_* action.`,
            );
          }
        }

        const rawFrom = typeof params.from === "string" ? params.from.trim() : "";
        const looksLikeRole = /^[a-z][a-z0-9-]{2,}$/i.test(rawFrom);
        const from = looksLikeRole ? rawFrom : (opts.defaultFrom ?? rawFrom);
        if (!from) {
          throw new Error("opc.notify: `from` is required and no defaultFrom configured for this agent");
        }
        const priority =
          typeof params.priority === "string" && (params.priority === "high" || params.priority === "normal")
            ? params.priority
            : "normal";
        const tag =
          typeof params.tag === "string" && params.tag.trim() ? params.tag.trim() : null;

        const result = await dispatchNotificationCore({
          tenantId: opts.tenantId,
          userId: authorId,
          from,
          message,
          priority,
          tag,
        });
        return jsonResult(result);
      }

      if (action === "notify_topics") {
        // Server-formatted daily scan report. LLM just passes structured data;
        // the message text is built by the template below, so it can't drift.
        if (!opts?.tenantId) {
          throw new Error("opc.notify_topics: tenant context missing");
        }
        const authorId = opts.userId ?? opts.fallbackAuthorId ?? "agent";
        const date = readStringParam(params, "date", { required: true });
        const rawTopics = Array.isArray(params.topics) ? params.topics : [];
        if (rawTopics.length === 0) {
          throw new Error("opc.notify_topics: topics[] is required and non-empty");
        }
        const numEmojis = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣", "🔟"];
        const topicLines = rawTopics.map((t, i) => {
          const row = t as Record<string, unknown>;
          const title = String(row.title ?? "").trim();
          const sources = String(row.sources ?? "").trim();
          const n = numEmojis[i] ?? `${i + 1}.`;
          return sources ? `${n} ${title}（${sources}）` : `${n} ${title}`;
        });
        const risks = rawTopics.map(t => String((t as Record<string, unknown>).risk ?? "low").toLowerCase());
        const lowCount = risks.filter(r => r === "low").length;
        const nonLowCount = risks.length - lowCount;
        const complianceLine = nonLowCount === 0
          ? "全部通过合规检查（低风险）✅"
          : `合规：${lowCount} 条低风险 / ${nonLowCount} 条中/高风险 ⚠️`;

        const message =
          `📋 今日选题已产出（${date}）\n\n` +
          `今日 ${rawTopics.length} 条候选选题：\n` +
          topicLines.join("\n") + "\n\n" +
          complianceLine + "\n" +
          `请老板挑选感兴趣的选题，将进入内容创作流程。`;

        const result = await dispatchNotificationCore({
          tenantId: opts.tenantId,
          userId: authorId,
          from: opts.defaultFrom ?? "topic-planner",
          message,
          priority: "normal",
          tag: `scan-${date}`,
        });
        return jsonResult(result);
      }

      // ── Structured notification actions (server builds the message text) ──

      if (action === "notify_topics_failed") {
        if (!opts?.tenantId) throw new Error("opc.notify_topics_failed: tenant context missing");
        const authorId = opts.userId ?? opts.fallbackAuthorId ?? "agent";
        const date = readStringParam(params, "date", { required: true });
        const errs = (params.errors ?? {}) as Record<string, string>;
        const errLines: string[] = [];
        if (errs.weibo) errLines.push(`微博：${errs.weibo}`);
        if (errs.zhihu) errLines.push(`知乎：${errs.zhihu}`);
        if (errs.bilibili) errLines.push(`B站：${errs.bilibili}`);
        const message =
          `⚠️ 今日热榜全部拉取失败（${date}）\n\n` +
          (errLines.length > 0 ? errLines.join("\n") + "\n\n" : "") +
          `本日无真实数据，不做推荐。请排查网络或 skill 配置。`;
        const result = await dispatchNotificationCore({
          tenantId: opts.tenantId, userId: authorId,
          from: opts.defaultFrom ?? "topic-planner",
          message, priority: "high", tag: `scan-failed-${date}`,
        });
        return jsonResult(result);
      }

      if (action === "notify_draft_ready") {
        if (!opts?.tenantId) throw new Error("opc.notify_draft_ready: tenant context missing");
        const authorId = opts.userId ?? opts.fallbackAuthorId ?? "agent";
        const topicTitle = readStringParam(params, "topic_title", { required: true });
        const message =
          `✍️ 今日初稿已完成\n` +
          `选题：${topicTitle}\n` +
          `请到 portal「内容草稿」页审阅`;
        const result = await dispatchNotificationCore({
          tenantId: opts.tenantId, userId: authorId,
          from: opts.defaultFrom ?? "content-creator",
          message, priority: "normal",
        });
        return jsonResult(result);
      }

      if (action === "notify_packs_ready") {
        if (!opts?.tenantId) throw new Error("opc.notify_packs_ready: tenant context missing");
        const authorId = opts.userId ?? opts.fallbackAuthorId ?? "agent";
        const date = readStringParam(params, "date", { required: true });
        const topicTitle = readStringParam(params, "topic_title", { required: true });
        const rawPacks = Array.isArray(params.packs) ? params.packs as Array<Record<string, unknown>> : [];
        if (rawPacks.length === 0) {
          throw new Error("opc.notify_packs_ready: packs[] must contain at least one item");
        }
        const lines = rawPacks.map((p, i) => {
          const plat = platZh(String(p.platform ?? ""));
          const title = String(p.title ?? "").trim();
          return `${i + 1}. ${plat}：${title}`;
        });
        const message =
          `📋 今日发布包已就绪\n\n` +
          `来源稿件：${topicTitle}\n\n` +
          `已为 ${rawPacks.length} 个平台生成：\n` +
          lines.join("\n") + "\n\n" +
          `请到 portal「待发文章」页复制正文发布`;
        const result = await dispatchNotificationCore({
          tenantId: opts.tenantId, userId: authorId,
          from: opts.defaultFrom ?? "distribution-editor",
          message, priority: "normal", tag: `pack-${date}`,
        });
        return jsonResult(result);
      }

      if (action === "notify_packs_reminder") {
        if (!opts?.tenantId) throw new Error("opc.notify_packs_reminder: tenant context missing");
        const authorId = opts.userId ?? opts.fallbackAuthorId ?? "agent";
        const date = readStringParam(params, "date", { required: true });
        const total = typeof params.total === "number" ? params.total : 0;
        const pending = typeof params.pending === "number" ? params.pending : 0;
        let message: string;
        if (total === 0) {
          message = `今日无发布包（没有审核通过的草稿）`;
        } else if (pending === 0) {
          message = `👍 今日 ${total} 条发布包已全部发完`;
        } else {
          const byPlat = (params.pendingByPlatform ?? {}) as Record<string, number>;
          const platLines = Object.entries(byPlat)
            .filter(([, n]) => n > 0)
            .map(([p, n]) => `${platZh(p)}${n > 1 ? ` ${n} 条` : ""}`)
            .join(" / ");
          message =
            `⏰ 催办：今日 ${total} 条发布包还有 ${pending} 条未发` +
            (platLines ? `（${platLines} 未标记已发）` : "") +
            `\n打开 portal「待发文章」页完成`;
        }
        const result = await dispatchNotificationCore({
          tenantId: opts.tenantId, userId: authorId,
          from: opts.defaultFrom ?? "distribution-editor",
          message, priority: "normal", tag: `dist-remind-${date}`,
        });
        return jsonResult(result);
      }

      if (action === "route_reply") {
        // opc-notify runs in a live session (inbound IM), which has gateway auth
        // through the session context — so this path still goes via RPC.
        const gatewayOpts = readGatewayCallOptions(params);
        const message = readStringParam(params, "message", { required: true });
        const bossOpenId =
          typeof params.bossOpenId === "string" && params.bossOpenId.trim()
            ? params.bossOpenId.trim()
            : undefined;
        const result = await callGatewayTool<{
          routed: boolean;
          employeeId?: string;
          agentId?: string;
          threadTag?: string | null;
          reason?: string;
        }>("tenant.opcInbox.routeReply", gatewayOpts, { message, bossOpenId });
        return jsonResult(result);
      }

      throw new Error(`unknown opc action: ${action}`);
    },
  };
}
