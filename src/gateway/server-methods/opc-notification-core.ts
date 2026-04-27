/**
 * Core dispatch logic for OPC notifications.
 *
 * Factored out of opc-notification-api.ts so it can be called BOTH:
 *   - From the `notification.dispatch` RPC handler (via the gateway WS)
 *   - Directly in-process from the `opc` agent tool (which runs inside the
 *     cron isolated-agent runner and has no gateway auth env vars, so it
 *     can't make a WS RPC back to itself)
 *
 * This is purely a helper — it performs the work and returns a plain result.
 * Callers are responsible for param validation, RBAC, and audit-log writes.
 */

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";
import { findChannelAppByAgent } from "../../db/models/tenant-channel-app.js";
import { getTenantAgent } from "../../db/models/tenant-agent.js";
import { pushFeishuText, pushWecomText, readFeishuBossOpenId } from "./opc-im-push.js";

const OPC_NOTIFY_AGENT_ID = "opc-notify";

export interface DispatchNotificationParams {
  tenantId: string;
  userId: string;           // for audit / file attribution
  from: string;             // employee role, e.g. "topic-planner"
  message: string;
  priority?: "normal" | "high";
  tag?: string | null;
}

export interface DispatchNotificationResult {
  id: string;
  path: string;                    // workspace-relative
  priority: "normal" | "high";
  delivered: boolean;
  deliverySkipReason: string | null;
  imMessageId?: string | null;
}

function todayDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Write a _notifications/{date}/{ts}-{id}.md audit record AND attempt IM push.
 *
 * Push policy: always push. The focus lock is NOT consulted here — it only
 * matters for inbound routing (route_reply needs to know which employee the
 * boss's reply belongs to). One-way notifications never cause "interruption"
 * in practice (OPC has ~1 notification per employee per day), and blocking
 * them was silently eating content-creator's "稿已审" pings whenever
 * topic-planner had gone first earlier in the day.
 */
export async function dispatchNotificationCore(
  params: DispatchNotificationParams,
): Promise<DispatchNotificationResult> {
  const priority: "normal" | "high" = params.priority === "high" ? "high" : "normal";
  const workspaceRoot = path.join(resolveTenantDir(params.tenantId), "workspace");
  const today = todayDate();
  const dir = path.join(workspaceRoot, "_notifications", today);
  await fs.mkdir(dir, { recursive: true });

  const id = shortId();
  const filename = `${new Date().toISOString().replace(/[:.]/g, "-")}-${id}.md`;
  const absPath = path.join(dir, filename);
  const relPath = `_notifications/${today}/${filename}`;

  const baseFrontmatter: Record<string, unknown> = {
    id,
    from: params.from,
    priority,
    tag: params.tag ?? null,
    delivered: false,
    created_at: new Date().toISOString(),
    created_by: params.userId,
  };

  // Always write the file first so the record is durable even if IM push fails.
  const initialYaml = YAML.stringify(baseFrontmatter).trimEnd();
  await fs.writeFile(absPath, `---\n${initialYaml}\n---\n\n${params.message}\n`, "utf8");

  // ── Try IM push ──────────────────────────────────────────────────────────
  let delivered = false;
  let deliverySkipReason: string | null = null;
  let imMessageId: string | undefined;

  const binding = await findChannelAppByAgent(params.tenantId, OPC_NOTIFY_AGENT_ID);
  if (!binding) {
    deliverySkipReason = "no_im_channel_bound";
  } else {
    // We used to prepend "[opc:<role>:<tag>]" here for route_reply to know
    // which employee a boss IM reply belonged to. Now that the focus-lock +
    // reply-routing mechanism is disabled (route_reply unconditionally returns
    // no_active_employee), the tag is pure noise to the boss — just send the
    // plain message.
    const outboundText = params.message;

    if (binding.channelType === "wecom") {
      const r = await pushWecomText({ botId: binding.appId, text: outboundText });
      delivered = r.ok;
      if (!r.ok) deliverySkipReason = r.error ?? "wecom_push_failed";
    } else if (binding.channelType === "feishu" || binding.channelType === "lark") {
      const opcAgent = await getTenantAgent(params.tenantId, OPC_NOTIFY_AGENT_ID);
      const openId = readFeishuBossOpenId(opcAgent?.config);
      if (!openId) {
        deliverySkipReason = "feishu_boss_open_id_not_captured_yet";
      } else {
        const r = await pushFeishuText({
          appId: binding.appId,
          appSecret: binding.appSecret,
          openId,
          text: outboundText,
        });
        delivered = r.ok;
        imMessageId = r.messageId;
        if (!r.ok) deliverySkipReason = r.error ?? "feishu_push_failed";
      }
    } else {
      deliverySkipReason = `unsupported_channel:${binding.channelType}`;
    }
  }

  // Update the file's delivered flag (best-effort rewrite).
  if (delivered) {
    try {
      const updated = YAML.stringify({
        ...baseFrontmatter,
        delivered: true,
        im_message_id: imMessageId ?? null,
      }).trimEnd();
      await fs.writeFile(absPath, `---\n${updated}\n---\n\n${params.message}\n`, "utf8");
    } catch { /* best-effort */ }
  }

  return {
    id,
    path: relPath,
    priority,
    delivered,
    deliverySkipReason,
    imMessageId: imMessageId ?? null,
  };
}
