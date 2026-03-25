/**
 * Multi-tenant context enrichment for inbound messages.
 *
 * When a channel plugin (e.g. the official Feishu plugin) dispatches a message
 * to the core without TenantId/TenantUserId, this module detects the tenant
 * configuration from the account-scoped config and auto-provisions the user,
 * injecting TenantId and TenantUserId into the message context.
 *
 * Also resolves sender display names when the channel plugin fails (e.g. due
 * to contact scope limitations). Uses DB cache first, then falls back to the
 * Feishu chat members API with tenant_access_token (no user OAuth needed).
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
  // If TenantId is already set but TenantUserRole is missing, resolve the role from DB.
  if (ctx.TenantId && ctx.TenantUserId && !ctx.TenantUserRole) {
    try {
      const { autoProvisionTenantUser } = await import("../../infra/channel-auto-provision.js");
      const senderId = ctx.SenderId;
      if (senderId) {
        const provisioned = await autoProvisionTenantUser({
          tenantId: ctx.TenantId,
          openId: senderId,
          unionId: ctx.SenderUnionId ?? undefined,
          displayName: ctx.SenderName ?? undefined,
        });
        if (provisioned) {
          ctx.TenantUserRole = provisioned.role;
          // Backfill sender name from DB if plugin didn't resolve it
          if (isMissingSenderName(ctx) && provisioned.displayName && !isPlaceholderName(provisioned.displayName)) {
            ctx.SenderName = provisioned.displayName;
            logVerbose(`[tenant-enrich] backfilled SenderName from DB: ${provisioned.displayName}`);
          }
        }
      }
    } catch {
      // Non-fatal: continue without role
    }
  }

  // If sender name is still missing, try resolving via Feishu chat members API
  if (ctx.TenantId && isMissingSenderName(ctx)) {
    await resolveFeishuSenderName(ctx, cfg);
  }

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
      ctx.TenantUserRole = provisioned.role;
      // Backfill sender name from DB if plugin didn't resolve it
      if (isMissingSenderName(ctx) && provisioned.displayName && !isPlaceholderName(provisioned.displayName)) {
        ctx.SenderName = provisioned.displayName;
        logVerbose(`[tenant-enrich] backfilled SenderName from DB: ${provisioned.displayName}`);
      }
      logVerbose(
        `[tenant-enrich] auto-provisioned: provider=${provider} senderId=${senderId} ` +
        `userId=${provisioned.userId} unionId=${provisioned.unionId} role=${provisioned.role} created=${provisioned.userCreated}`,
      );
    }
  } catch (err) {
    // Non-fatal: log and continue without tenant context.
    // The message will be processed in single-tenant mode.
    logVerbose(`[tenant-enrich] auto-provision failed for ${provider}/${senderId}: ${String(err)}`);
  }

  // If sender name is still missing, try resolving via Feishu chat members API
  if (ctx.TenantId && isMissingSenderName(ctx)) {
    await resolveFeishuSenderName(ctx, cfg);
  }
}

// ---------------------------------------------------------------------------
// Sender name resolution helpers
// ---------------------------------------------------------------------------

function isPlaceholderName(name: string): boolean {
  return !name || name.startsWith("ou_") || name.startsWith("on_");
}

function isMissingSenderName(ctx: FinalizedMsgContext): boolean {
  return !ctx.SenderName || isPlaceholderName(ctx.SenderName);
}

/**
 * Extract chatId from ctx.To (Feishu format: "chat:{chatId}" or "user:{openId}").
 * Returns undefined for p2p chats — the API layer will resolve via openId instead.
 */
function extractChatId(ctx: FinalizedMsgContext): string | undefined {
  const to = (ctx as Record<string, unknown>).To as string | undefined;
  if (!to) return undefined;
  if (to.startsWith("chat:")) return to.slice(5);
  return undefined;
}

/**
 * Resolve sender name via Feishu chat members API (tenant_access_token).
 * On success, updates ctx.SenderName and persists to DB.
 */
async function resolveFeishuSenderName(
  ctx: FinalizedMsgContext,
  cfg: OpenClawConfig,
): Promise<void> {
  const provider = (ctx.Provider ?? ctx.Surface ?? "").toLowerCase();
  if (provider !== "feishu") return;

  const senderId = ctx.SenderId;
  if (!senderId) return;

  const chatId = extractChatId(ctx);

  try {
    const { resolveFeishuUserName, extractFeishuCredentials } = await import("../../infra/feishu-user-resolve.js");

    const accountId = (ctx as Record<string, unknown>).AccountId as string | undefined;
    const creds = extractFeishuCredentials(cfg as unknown as Record<string, unknown>, provider, accountId);
    if (!creds) return;

    const name = await resolveFeishuUserName({
      appId: creds.appId,
      appSecret: creds.appSecret,
      chatId: chatId ?? undefined,
      openId: senderId,
    });

    if (name && !isPlaceholderName(name)) {
      ctx.SenderName = name;
      logVerbose(`[tenant-enrich] resolved SenderName via Feishu API: ${name}`);

      // Persist to DB so future messages don't need API calls
      if (ctx.TenantId) {
        try {
          const { updateDisplayNameByOpenId } = await import("../../db/models/user.js");
          await updateDisplayNameByOpenId(senderId, name);
        } catch {
          // Non-fatal
        }
      }
    }
  } catch (err) {
    logVerbose(`[tenant-enrich] Feishu name resolve failed: ${String(err)}`);
  }
}
