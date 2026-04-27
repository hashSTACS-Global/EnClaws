/**
 * Gateway RPC handler for OPC inbound message routing.
 *
 * Method:
 *   tenant.opcInbox.routeReply  - When the boss replies in IM, opc-notify
 *                                  invokes this RPC via the `opc` tool.
 *
 * Current scope (focus lock disabled):
 *   - Capture the boss's Feishu open_id onto opc-notify.config (first time only,
 *     mainly as a fallback to the one we wrote at onboarding).
 *   - Always respond `routed: false, reason: "no_active_employee"` so opc-notify
 *     tells the boss to use portal. Automatic "forward reply to the active
 *     employee" routing was behind a focus lock that caused more problems than
 *     it solved (it silently blocked outbound IM pushes); we may revisit once
 *     the broader OPC loop is stable.
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import type { TenantContext } from "../../auth/middleware.js";
import { getTenantAgent, updateTenantAgent } from "../../db/models/tenant-agent.js";
import { invalidateTenantConfigCache } from "../../config/tenant-config.js";

const OPC_NOTIFY_AGENT_ID = "opc-notify";

function getTenantCtx(
  client: GatewayRequestHandlerOptions["client"],
  respond: GatewayRequestHandlerOptions["respond"],
): TenantContext | null {
  if (!isDbInitialized()) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Multi-tenant mode not enabled"));
    return null;
  }
  const tenant = (client as unknown as { tenant?: TenantContext })?.tenant;
  if (!tenant) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Authentication required"));
    return null;
  }
  return tenant;
}

export const opcInboxHandlers: GatewayRequestHandlers = {
  "tenant.opcInbox.routeReply": async (
    { params, client, respond, context }: GatewayRequestHandlerOptions,
  ) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = params as {
      message?: string;
      bossOpenId?: string;
    };
    const message = typeof p?.message === "string" ? p.message.trim() : "";
    if (!message) {
      return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "message required"));
    }

    // Capture boss's Feishu open_id if this is the first time we've seen it.
    // Mostly a belt-and-suspenders against the onboarding path missing it.
    if (p.bossOpenId && p.bossOpenId.trim()) {
      try {
        const opcAgent = await getTenantAgent(ctx.tenantId, OPC_NOTIFY_AGENT_ID);
        if (opcAgent) {
          const existingConfig = (opcAgent.config ?? {}) as Record<string, unknown>;
          const existingOpenId = typeof existingConfig.bossOpenId === "string" ? existingConfig.bossOpenId : null;
          if (existingOpenId !== p.bossOpenId) {
            await updateTenantAgent(ctx.tenantId, OPC_NOTIFY_AGENT_ID, {
              config: { ...existingConfig, bossOpenId: p.bossOpenId.trim() },
            });
            invalidateTenantConfigCache(ctx.tenantId);
          }
        }
      } catch (err) {
        context.logGateway.warn(`opcInbox.routeReply: capture bossOpenId failed: ${(err as Error).message}`);
      }
    }

    try {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "opcInbox.routeReply",
        resource: OPC_NOTIFY_AGENT_ID,
        detail: {
          routed: false,
          reason: "focus_lock_disabled",
          messageLength: message.length,
          capturedBossOpenId: !!(p.bossOpenId && p.bossOpenId.trim()),
        },
      });
    } catch { /* best-effort */ }

    // Always: reply routing disabled → opc-notify should tell boss to use portal
    return respond(true, { routed: false, reason: "no_active_employee" });
  },
};
