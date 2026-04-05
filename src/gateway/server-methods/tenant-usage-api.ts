/**
 * Gateway RPC handlers for tenant usage tracking.
 *
 * Methods:
 *   tenant.usage.summary    - Get token usage summary for the tenant
 *   tenant.usage.quota      - Check current quota status
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { getTenantById } from "../../db/models/tenant.js";
import { getTenantUsageSummary, checkTokenQuota } from "../../db/models/usage.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";

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

export const tenantUsageHandlers: GatewayRequestHandlers = {
  /**
   * Get token usage summary.
   *
   * Params:
   *   since?: string (ISO date)
   *   until?: string (ISO date)
   *   userId?: string
   *   agentId?: string
   */
  "tenant.usage.summary": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) {return;}

    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { since, until, userId, agentId } = params as {
      since?: string;
      until?: string;
      userId?: string;
      agentId?: string;
    };

    const summary = await getTenantUsageSummary(ctx.tenantId, {
      since: since ? new Date(since) : undefined,
      until: until ? new Date(until) : undefined,
      userId,
      agentId,
    });

    respond(true, summary);
  },

  /**
   * Check current quota status.
   */
  "tenant.usage.quota": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) {return;}

    const tenant = await getTenantById(ctx.tenantId);
    if (!tenant) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Tenant not found"));
      return;
    }

    const tokenQuota = await checkTokenQuota(ctx.tenantId, tenant.quotas.maxTokensPerMonth);

    // Get current month start
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    respond(true, {
      plan: tenant.plan,
      period: {
        start: monthStart.toISOString(),
        end: monthEnd.toISOString(),
      },
      tokens: {
        used: tokenQuota.used,
        max: tokenQuota.max,
        remaining: Math.max(0, tokenQuota.max - tokenQuota.used),
        percentUsed: tokenQuota.max > 0 ? Math.round((tokenQuota.used / tokenQuota.max) * 100) : 0,
      },
      quotas: tenant.quotas,
    });
  },
};
