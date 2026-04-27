/**
 * Gateway RPC handler for OPC notification dispatch.
 *
 * Method:
 *   notification.dispatch — Thin RPC wrapper around dispatchNotificationCore.
 *
 * Agents typically reach this via the in-process `opc` tool (see opc-tool.ts),
 * which skips the gateway round-trip entirely. This RPC is kept for:
 *   - portal or external callers that want to push a notification via WS
 *   - server-side integrations (non-agent code paths)
 */

import type {
  GatewayRequestHandlers,
  GatewayRequestHandlerOptions,
} from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";
import { dispatchNotificationCore } from "./opc-notification-core.js";

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

export const opcNotificationHandlers: GatewayRequestHandlers = {
  "notification.dispatch": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = params as {
      from?: string;
      message?: string;
      priority?: "normal" | "high";
      tag?: string;
    };

    if (!p?.from) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "from required"));
    if (!p?.message) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "message required"));

    const result = await dispatchNotificationCore({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      from: p.from,
      message: p.message,
      priority: p.priority,
      tag: p.tag ?? null,
    });

    try {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "notification.dispatch",
        resource: result.path,
        detail: {
          from: p.from,
          priority: result.priority,
          tag: p.tag ?? null,
          delivered: result.delivered,
          deliverySkipReason: result.deliverySkipReason,
        },
      });
    } catch { /* best-effort */ }

    return respond(true, {
      id: result.id,
      path: result.path,
      priority: result.priority,
      delivered: result.delivered,
      deliverySkipReason: result.deliverySkipReason,
    });
  },
};
