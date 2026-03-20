/**
 * Multi-tenant context enrichment for inbound messages.
 *
 * When a channel plugin (e.g. the official Feishu plugin) dispatches a message
 * to the core without TenantId/TenantUserId, this module detects the tenant
 * configuration from the account-scoped config and auto-provisions the user,
 * injecting TenantId and TenantUserId into the message context.
 *
 * This allows external plugins to work unmodified in multi-tenant deployments.
 */

import type { OpenClawConfig } from "../../config/config.js";
import type { FinalizedMsgContext } from "../templating.js";
import { logVerbose } from "../../globals.js";

/**
 * Enrich the inbound message context with multi-tenant fields if applicable.
 *
 * Checks whether the channel's account-scoped config carries a `tenantId`.
 * If so, and the context does not already have TenantId set, performs
 * auto-provisioning to resolve the tenant user and injects TenantId +
 * TenantUserId into `ctx` (mutates in place).
 *
 * No-op when:
 * - ctx.TenantId is already set (plugin already handled it)
 * - No tenantId found in channel config (single-tenant / personal mode)
 * - No SenderId available (cannot provision without sender identity)
 */
export async function enrichTenantContext(
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): Promise<void> {
  // Skip if the plugin already injected tenant info (e.g. the old built-in feishu plugin)
  if (ctx.TenantId) return;

  const provider = (ctx.Provider ?? ctx.Surface ?? "").toLowerCase();
  if (!provider) return;

  // Read tenantId from the account-scoped channel config.
  // In multi-tenant mode, server-channels.ts merges DB tenant data into the
  // account config: cfg.channels[provider].tenantId = "<tenant-uuid>"
  const channelCfg = (cfg.channels as Record<string, Record<string, unknown> | undefined>)?.[provider];
  const tenantId = channelCfg?.tenantId as string | undefined;
  if (!tenantId) return;

  const senderId = ctx.SenderId;
  if (!senderId) return;

  try {
    const { autoProvisionTenantUser } = await import("../../infra/channel-auto-provision.js");

    const provisioned = await autoProvisionTenantUser({
      tenantId,
      openId: senderId,
      unionId: ctx.SenderUnionId ?? undefined,
      displayName: ctx.SenderName ?? undefined,
    });

    if (provisioned) {
      ctx.TenantId = tenantId;
      ctx.TenantUserId = provisioned.unionId;
      logVerbose(
        `[tenant-enrich] auto-provisioned: provider=${provider} senderId=${senderId} ` +
        `userId=${provisioned.userId} unionId=${provisioned.unionId} created=${provisioned.userCreated}`,
      );
    }
  } catch (err) {
    // Non-fatal: log and continue without tenant context.
    // The message will be processed in single-tenant mode.
    logVerbose(`[tenant-enrich] auto-provision failed for ${provider}/${senderId}: ${String(err)}`);
  }
}
