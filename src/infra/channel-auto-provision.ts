/**
 * Auto-provision tenant users from channel messages.
 *
 * When a Feishu group message arrives and no user mapping exists,
 * auto-creates a user record with open_ids array and union_id.
 *
 * Directory paths use union_id: tenants/{tenantId}/users/{union_id}/
 */

import { isDbInitialized } from "../db/index.js";

/** In-memory cache to avoid repeated DB lookups within the same process. */
const provisionedCache = new Map<string, { userId: string; unionId: string; role: string; displayName?: string; channelId?: string }>(); // key → result
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const provisionedExpiry = new Map<string, number>();

function cacheKey(tenantId: string, openId: string, channelId?: string): string {
  return `${tenantId}:${openId}:${channelId ?? ""}`;
}

export type AutoProvisionResult = {
  userId: string;
  /** union_id used as directory key: tenants/{tenantId}/users/{unionId}/ */
  unionId: string;
  userCreated: boolean;
  /** User role for permission checks. */
  role: string;
  /** Display name from DB (may be a real name resolved from a previous session). */
  displayName?: string;
  /** tenant_channels.id — the channel this user belongs to. */
  channelId?: string;
};

/**
 * Sentinel returned by `autoProvisionTenantUser` when the tenant has hit
 * its `maxUsers` quota and a new IM sender cannot be provisioned. The
 * upstream tenant-enrich layer turns this into a flag on the message
 * context so the reply pipeline can send a localized "upgrade plan" reply.
 */
export type AutoProvisionQuotaExceeded = {
  quotaExceeded: true;
  current: number;
  max: number;
};

/**
 * Auto-provision a user for a channel message sender.
 *
 * @param tenantId - The tenant from the channel app
 * @param openId - The sender's open_id (Feishu)
 * @param unionId - The sender's union_id (cross-app stable identifier)
 * @param displayName - Optional display name for the new user
 * @returns Provisioned user info, or null if DB is not available
 */
export async function autoProvisionTenantUser(params: {
  tenantId: string;
  openId: string;
  unionId?: string;
  displayName?: string;
  channelId?: string;
}): Promise<AutoProvisionResult | AutoProvisionQuotaExceeded | null> {
  if (!isDbInitialized()) return null;

  const { tenantId, openId, unionId, displayName, channelId } = params;
  const key = cacheKey(tenantId, openId, channelId);

  // Check in-memory cache
  const cached = provisionedCache.get(key);
  const expiry = provisionedExpiry.get(key);
  if (cached && expiry && expiry > Date.now()) {
    return { userId: cached.userId, unionId: cached.unionId, userCreated: false, role: cached.role, displayName: cached.displayName, channelId: cached.channelId };
  }

  const { findOrCreateUserByOpenId } = await import("../db/models/user.js");
  const { UserQuotaExceededError } = await import("../db/models/user-quota-error.js");

  let user;
  let userCreated;
  try {
    const result = await findOrCreateUserByOpenId(
      tenantId,
      openId,
      displayName,
      unionId,
      channelId,
    );
    user = result.user;
    userCreated = result.created;
  } catch (err) {
    if (err instanceof UserQuotaExceededError) {
      // Surface as a sentinel so tenant-enrich can flag the message context.
      // Intentionally NOT cached — once quota frees up, the next message
      // should immediately re-evaluate.
      return { quotaExceeded: true, current: err.current, max: err.max };
    }
    throw err;
  }

  // Use union_id as directory key; fall back to open_id if union_id is unavailable
  const effectiveUnionId = user.unionId ?? openId;

  // Update cache
  const resolvedDisplayName = user.displayName ?? undefined;
  const resolvedChannelId = user.channelId ?? channelId;
  provisionedCache.set(key, { userId: user.id, unionId: effectiveUnionId, role: user.role, displayName: resolvedDisplayName, channelId: resolvedChannelId });
  provisionedExpiry.set(key, Date.now() + CACHE_TTL_MS);

  return { userId: user.id, unionId: effectiveUnionId, userCreated, role: user.role, displayName: resolvedDisplayName, channelId: resolvedChannelId };
}

/**
 * Clear the provision cache (e.g. when config changes).
 */
export function clearAutoProvisionCache(): void {
  provisionedCache.clear();
  provisionedExpiry.clear();
}
