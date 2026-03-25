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
const provisionedCache = new Map<string, { userId: string; unionId: string; role: string; displayName?: string }>(); // key → result
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const provisionedExpiry = new Map<string, number>();

function cacheKey(tenantId: string, openId: string): string {
  return `${tenantId}:${openId}`;
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
}): Promise<AutoProvisionResult | null> {
  if (!isDbInitialized()) return null;

  const { tenantId, openId, unionId, displayName } = params;
  const key = cacheKey(tenantId, openId);

  // Check in-memory cache
  const cached = provisionedCache.get(key);
  const expiry = provisionedExpiry.get(key);
  if (cached && expiry && expiry > Date.now()) {
    return { userId: cached.userId, unionId: cached.unionId, userCreated: false, role: cached.role, displayName: cached.displayName };
  }

  const { findOrCreateUserByOpenId } = await import("../db/models/user.js");

  const { user, created: userCreated } = await findOrCreateUserByOpenId(
    tenantId,
    openId,
    displayName,
    unionId,
  );

  // Use union_id as directory key; fall back to open_id if union_id is unavailable
  const effectiveUnionId = user.unionId ?? openId;

  // Update cache
  const resolvedDisplayName = user.displayName ?? undefined;
  provisionedCache.set(key, { userId: user.id, unionId: effectiveUnionId, role: user.role, displayName: resolvedDisplayName });
  provisionedExpiry.set(key, Date.now() + CACHE_TTL_MS);

  return { userId: user.id, unionId: effectiveUnionId, userCreated, role: user.role, displayName: resolvedDisplayName };
}

/**
 * Clear the provision cache (e.g. when config changes).
 */
export function clearAutoProvisionCache(): void {
  provisionedCache.clear();
  provisionedExpiry.clear();
}
