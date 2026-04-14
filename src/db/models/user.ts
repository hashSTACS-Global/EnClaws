/**
 * User CRUD operations.
 */

import fs from "node:fs";
import path from "node:path";
import { hashPassword } from "../../auth/password.js";
import {
  resolveTenantDevicesDir,
  resolveTenantCredentialsDir,
  resolveTenantCronDir,
  resolveTenantAgentWorkspaceDir,
} from "../../config/sessions/tenant-paths.js";
import { query, getDbType, DB_SQLITE } from "../index.js";
import * as sqliteUser from "../sqlite/models/user.js";
import type {
  User,
  SafeUser,
  CreateUserInput,
  UpdateUserInput,
  UserRole,
  UserStatus,
} from "../types.js";
import { checkTenantQuota } from "./tenant.js";
import { UserQuotaExceededError } from "./user-quota-error.js";

// Re-export for convenience so callers can `import { UserQuotaExceededError } from "../../db/models/user.js"`.
export { UserQuotaExceededError } from "./user-quota-error.js";

function rowToUser(row: Record<string, unknown>): User {
  return {
    id: row.id as string,
    tenantId: row.tenant_id as string,
    channelId: (row.channel_id as string) ?? null,
    openIds: Array.isArray(row.open_ids) ? (row.open_ids as string[]) : [],
    unionId: (row.union_id as string) ?? null,
    email: (row.email as string) ?? null,
    passwordHash: (row.password_hash as string) ?? null,
    displayName: (row.display_name as string) ?? null,
    role: row.role as UserRole,
    status: row.status as UserStatus,
    avatarUrl: (row.avatar_url as string) ?? null,
    lastLoginAt: (row.last_login_at as Date) ?? null,
    settings: (row.settings ?? {}) as User["settings"],
    forceChangePassword: Number(row.force_change_password ?? 0) === 1,
    passwordChangedAt: (row.password_changed_at as Date) ?? null,
    mfaSecret: (row.mfa_secret as string) ?? null,
    mfaEnabled: Number(row.mfa_enabled ?? 0) === 1,
    mfaBackupCodes: (row.mfa_backup_codes as string) ?? null,
    pivotToken: (row.pivot_token as string) ?? null,
    pivotTokenExpiresAt: (row.pivot_token_expires_at as Date) ?? null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  };
}

export function toSafeUser(user: User): SafeUser & { hasPivotToken: boolean } {
  const { passwordHash: _, mfaSecret: _s, mfaBackupCodes: _b, pivotToken: _pt, ...safe } = user;
  return { ...safe, hasPivotToken: Boolean(_pt) };
}

/**
 * Seed initial files inside tenant-scoped user directories so that
 * both webchat and Feishu users start with the same baseline state.
 *
 * Files created:
 *   devices/paired.json  → {}
 *   devices/pending.json → {}
 *   cron/jobs.json       → { "version": 1, "jobs": [] }
 */
export function seedUserDirFiles(tenantId: string, dirKey: string): void {
  const devicesDir = resolveTenantDevicesDir(tenantId, dirKey);
  const cronDir = resolveTenantCronDir(tenantId, dirKey);

  const seeds: Array<[string, string]> = [
    [path.join(devicesDir, "paired.json"), "{}"],
    [path.join(devicesDir, "pending.json"), "{}"],
    [path.join(cronDir, "jobs.json"), JSON.stringify({ version: 1, jobs: [] })],
  ];

  for (const [filePath, content] of seeds) {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, content, "utf-8");
    }
  }
}

export async function createUser(
  input: CreateUserInput & { forceChangePassword?: boolean },
  opts?: { skipDirInit?: boolean },
): Promise<SafeUser> {
  if (getDbType() === DB_SQLITE) return sqliteUser.createUser(input, opts);
  const passwordHash = input.password ? await hashPassword(input.password) : null;
  const fcp = input.forceChangePassword ? 1 : 0;
  const result = await query(
    `INSERT INTO users (tenant_id, channel_id, email, password_hash, display_name, role,
                        force_change_password, password_changed_at)
     VALUES ($1, $2, $3, $4::text, $5, $6, $7, CASE WHEN $4::text IS NULL THEN NULL ELSE NOW() END)
     RETURNING *`,
    [
      input.tenantId,
      input.channelId ?? null,
      input.email ? input.email.toLowerCase().trim() : null,
      passwordHash,
      input.displayName ?? null,
      input.role ?? "member",
      fcp,
    ],
  );
  const user = rowToUser(result.rows[0]);

  // Initialize tenant-scoped directories and seed initial files (use union_id as folder name)
  if (!opts?.skipDirInit) {
    const dirKey = user.unionId ?? user.id;
    try {
      const dirs = [
        resolveTenantDevicesDir(user.tenantId, dirKey),
        resolveTenantCredentialsDir(user.tenantId, dirKey),
        resolveTenantCronDir(user.tenantId, dirKey),
        resolveTenantAgentWorkspaceDir(user.tenantId, undefined, dirKey),
      ];
      for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
      }
      seedUserDirFiles(user.tenantId, dirKey);
    } catch {
      // Non-fatal: directories will be created on first write
    }
  }

  return toSafeUser(user);
}

export async function getUserById(id: string): Promise<User | null> {
  if (getDbType() === DB_SQLITE) return sqliteUser.getUserById(id);
  const result = await query("SELECT * FROM users WHERE id = $1", [id]);
  return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
}

/**
 * Batch-fetch display names by user IDs. Returns a map of id → displayName.
 */
export async function getUserDisplayNamesByIds(ids: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (ids.length === 0) return map;
  const unique = [...new Set(ids)];
  await Promise.all(
    unique.map(async (id) => {
      const user = await getUserById(id);
      if (user?.displayName) map.set(id, user.displayName);
    }),
  );
  return map;
}

/**
 * Batch-fetch display names by Feishu open_ids. Returns a map of openId → displayName.
 */
export async function getUserDisplayNamesByOpenIds(
  tenantId: string,
  openIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (openIds.length === 0) return map;
  const unique = [...new Set(openIds)];
  const isSqlite = getDbType() === DB_SQLITE;
  await Promise.all(
    unique.map(async (oid) => {
      let name: string | null = null;
      if (isSqlite) {
        const result = sqliteUser.findUserByOpenIdForDisplay(tenantId, oid);
        const row = result.rows[0] as Record<string, unknown> | undefined;
        name = (row?.display_name as string) ?? null;
      } else {
        const result = await query(
          `SELECT display_name FROM users WHERE tenant_id = $1 AND open_ids @> ARRAY[$2]::varchar[] AND status = 'active' LIMIT 1`,
          [tenantId, oid],
        );
        name = (result.rows[0]?.display_name as string) ?? null;
      }
      if (name) map.set(oid, name);
    }),
  );
  return map;
}

export async function getUserByEmail(tenantId: string, email: string): Promise<User | null> {
  if (getDbType() === DB_SQLITE) return sqliteUser.getUserByEmail(tenantId, email);
  const result = await query("SELECT * FROM users WHERE tenant_id = $1 AND email = $2", [
    tenantId,
    email.toLowerCase().trim(),
  ]);
  return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
}

/**
 * Find a user by Feishu union_id within a tenant.
 * Returns null if not found.
 */
export async function getUserByUnionId(tenantId: string, unionId: string): Promise<User | null> {
  if (getDbType() === DB_SQLITE) {
    const { sqliteQuery: sq } = await import("../sqlite/index.js");
    const result = sq("SELECT * FROM users WHERE tenant_id = ? AND union_id = ?", [tenantId, unionId]);
    return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
  }
  const result = await query(
    "SELECT * FROM users WHERE tenant_id = $1 AND union_id = $2",
    [tenantId, unionId],
  );
  return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
}

/**
 * Find user by email across all tenants (for login with email only).
 * Returns the first active match. If ambiguous, caller should require tenant slug.
 */
export async function findUserByEmail(email: string): Promise<User | null> {
  if (getDbType() === DB_SQLITE) return sqliteUser.findUserByEmail(email);
  const result = await query(
    `SELECT u.* FROM users u
     JOIN tenants t ON u.tenant_id = t.id
     WHERE u.email = $1 AND u.status = 'active' AND t.status = 'active'
     ORDER BY u.last_login_at DESC NULLS LAST
     LIMIT 1`,
    [email.toLowerCase().trim()],
  );
  return result.rows.length > 0 ? rowToUser(result.rows[0]) : null;
}

/**
 * List users result row. Extends {@link SafeUser} with the resolved channel
 * display name (via LEFT JOIN on `tenant_channels`). `channelName` is null
 * when the user has no `channel_id` set or the channel row has been deleted.
 */
export type ListedUser = SafeUser & { channelName: string | null };

export async function listUsers(
  tenantId: string,
  opts?: {
    status?: UserStatus;
    role?: UserRole;
    channelId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<{ users: SafeUser[]; total: number }> {
  if (getDbType() === DB_SQLITE) return sqliteUser.listUsers(tenantId, opts);
  const conditions: string[] = ["u.tenant_id = $1"];
  const values: unknown[] = [tenantId];
  let idx = 2;

  if (opts?.status) {
    conditions.push(`u.status = $${idx++}`);
    values.push(opts.status);
  }
  if (opts?.role) {
    conditions.push(`u.role = $${idx++}`);
    values.push(opts.role);
  }
  if (opts?.channelId) {
    conditions.push(`u.channel_id = $${idx++}`);
    values.push(opts.channelId);
  }

  const where = `WHERE ${conditions.join(" AND ")}`;
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  // LEFT JOIN on tenant_channels so users with no channel / dangling channel_id
  // still come back (channel_name will just be NULL).
  const [dataResult, countResult] = await Promise.all([
    query(
      `SELECT u.*, tc.channel_name
         FROM users u
         LEFT JOIN tenant_channels tc ON tc.id = u.channel_id
         ${where}
         ORDER BY u.created_at DESC
         LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
    query(`SELECT COUNT(*) as count FROM users u ${where}`, values),
  ]);

  return {
    users: dataResult.rows.map((row) => {
      const safe = toSafeUser(rowToUser(row));
      return { ...safe, channelName: (row.channel_name as string) ?? null };
    }),
    total: parseInt(countResult.rows[0].count as string, 10),
  };
}

export async function updateUser(id: string, updates: UpdateUserInput): Promise<SafeUser | null> {
  if (getDbType() === DB_SQLITE) return sqliteUser.updateUser(id, updates);
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.displayName !== undefined) {
    sets.push(`display_name = $${idx++}`);
    values.push(updates.displayName);
  }
  if (updates.role !== undefined) {
    sets.push(`role = $${idx++}`);
    values.push(updates.role);
  }
  if (updates.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.settings !== undefined) {
    sets.push(`settings = $${idx++}::jsonb`);
    values.push(JSON.stringify(updates.settings));
  }
  if (updates.avatarUrl !== undefined) {
    sets.push(`avatar_url = $${idx++}`);
    values.push(updates.avatarUrl);
  }

  if (sets.length === 0) {
    const user = await getUserById(id);
    return user ? toSafeUser(user) : null;
  }

  values.push(id);
  const result = await query(
    `UPDATE users SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows.length > 0 ? toSafeUser(rowToUser(result.rows[0])) : null;
}

export async function updateLastLogin(userId: string): Promise<void> {
  if (getDbType() === DB_SQLITE) return sqliteUser.updateLastLogin(userId);
  await query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [userId]);
}

/**
 * Update the user's password hash and clear the force-change-password flag.
 * Also stamps password_changed_at = now (for Phase 2 expiry policy).
 */
export async function updateUserPassword(
  userId: string,
  newPassword: string,
  opts?: { keepForceFlag?: boolean },
): Promise<void> {
  if (getDbType() === DB_SQLITE) {
    return sqliteUser.updateUserPassword(userId, newPassword, opts);
  }
  const hash = await hashPassword(newPassword);
  const fcpClause = opts?.keepForceFlag ? "" : ", force_change_password = 0";
  await query(
    `UPDATE users SET password_hash = $1, password_changed_at = NOW()${fcpClause}, updated_at = NOW() WHERE id = $2`,
    [hash, userId],
  );
}

/**
 * Set or clear the force-change-password flag (used by admin reset / invite flows).
 */
export async function setForceChangePassword(userId: string, force: boolean): Promise<void> {
  if (getDbType() === DB_SQLITE) {
    return sqliteUser.setForceChangePassword(userId, force);
  }
  await query("UPDATE users SET force_change_password = $1 WHERE id = $2", [force ? 1 : 0, userId]);
}

export async function deleteUser(id: string): Promise<boolean> {
  if (getDbType() === DB_SQLITE) return sqliteUser.deleteUser(id);
  const result = await query(
    "UPDATE users SET status = 'deleted' WHERE id = $1 AND status != 'deleted'",
    [id],
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Update display_name for a user identified by open_id, but only if the
 * current display_name looks like a placeholder (ou_/on_ prefix or empty).
 */
export async function updateDisplayNameByOpenId(
  openId: string,
  displayName: string,
): Promise<void> {
  if (getDbType() === DB_SQLITE) {
    return sqliteUser.updateDisplayNameByOpenId(openId, displayName);
  }
  await query(
    `UPDATE users SET display_name = $1, updated_at = NOW()
     WHERE open_ids @> ARRAY[$2]::varchar[] AND status = 'active'
       AND (display_name IS NULL OR display_name LIKE 'ou\\_%' OR display_name LIKE 'on\\_%')`,
    [displayName, openId],
  );
}

/**
 * Find or create a user by their Feishu union_id (primary) or open_id (fallback).
 *
 * Lookup order:
 *   1. By union_id (one user per union_id across apps)
 *   2. By open_ids array containment (legacy / when union_id is unavailable)
 *
 * When found, appends the open_id to the open_ids array if not already present.
 * Returns the user's union_id for use as the directory key.
 */
export async function findOrCreateUserByOpenId(
  tenantId: string,
  openId: string,
  displayName?: string,
  unionId?: string,
  channelId?: string,
): Promise<{ user: User; created: boolean }> {
  if (getDbType() === DB_SQLITE)
    return sqliteUser.findOrCreateUserByOpenId(tenantId, openId, displayName, unionId, channelId);

  // Helper: lazily backfill channel_id on legacy records (NULL → current channel)
  async function backfillChannelId(user: User): Promise<void> {
    if (channelId && !user.channelId) {
      await query("UPDATE users SET channel_id = $1 WHERE id = $2", [channelId, user.id]);
      user.channelId = channelId;
    }
  }

  // 1. Try to find by union_id first (preferred, cross-app stable identifier)
  if (unionId) {
    const byUnion = await query(
      `SELECT * FROM users WHERE tenant_id = $1 AND union_id = $2 AND status = 'active'
         AND (channel_id = $3 OR channel_id IS NULL)
       ORDER BY channel_id IS NULL ASC LIMIT 1`,
      [tenantId, unionId, channelId ?? null],
    );
    if (byUnion.rows.length > 0) {
      const user = rowToUser(byUnion.rows[0]);
      await backfillChannelId(user);
      // Append open_id to array if not already present
      if (openId && !user.openIds.includes(openId)) {
        await query("UPDATE users SET open_ids = array_append(open_ids, $1) WHERE id = $2", [
          openId,
          user.id,
        ]);
        user.openIds.push(openId);
      }
      // Update display_name if a real name is now available
      if (displayName && displayName !== user.displayName && !displayName.startsWith("ou_")) {
        if (
          !user.displayName ||
          user.displayName.startsWith("ou_") ||
          user.displayName.startsWith("on_")
        ) {
          await query("UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2", [
            displayName,
            user.id,
          ]);
          user.displayName = displayName;
        }
      }
      return { user, created: false };
    }
  }

  // 2. Fallback: find by open_ids array containment
  const byOpenId = await query(
    `SELECT * FROM users WHERE tenant_id = $1 AND open_ids @> ARRAY[$2]::varchar[] AND status = 'active'
       AND (channel_id = $3 OR channel_id IS NULL)
     ORDER BY channel_id IS NULL ASC LIMIT 1`,
    [tenantId, openId, channelId ?? null],
  );
  if (byOpenId.rows.length > 0) {
    const user = rowToUser(byOpenId.rows[0]);
    await backfillChannelId(user);
    // Update union_id if it was missing and is now available
    if (unionId && !user.unionId) {
      await query("UPDATE users SET union_id = $1 WHERE id = $2", [unionId, user.id]);
      user.unionId = unionId;
    }
    // Update display_name if a real name is now available
    if (displayName && displayName !== user.displayName && !displayName.startsWith("ou_")) {
      if (
        !user.displayName ||
        user.displayName.startsWith("ou_") ||
        user.displayName.startsWith("on_")
      ) {
        await query("UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2", [
          displayName,
          user.id,
        ]);
        user.displayName = displayName;
      }
    }
    return { user, created: false };
  }

  // 3. Create new user with open_ids array, union_id, and channel_id
  // Check user quota before insert — IM-channel users were previously
  // auto-provisioned without any quota enforcement, so a tenant could
  // exceed maxUsers freely. Existing users (steps 1 and 2 above) are
  // never blocked even after the limit is reached.
  const userQuota = await checkTenantQuota(tenantId, "users");
  if (!userQuota.allowed) {
    throw new UserQuotaExceededError(userQuota.current, userQuota.max);
  }

  try {
    const result = await query(
      `INSERT INTO users (tenant_id, channel_id, open_ids, union_id, display_name, role)
       VALUES ($1, $2, ARRAY[$3]::varchar[], $4, $5, 'member')
       RETURNING *`,
      [tenantId, channelId ?? null, openId, unionId ?? null, displayName ?? openId],
    );
    const user = rowToUser(result.rows[0]);

    // Initialize tenant-scoped directories and seed initial files (use union_id as folder name)
    const dirKey = user.unionId ?? openId;
    try {
      const dirs = [
        resolveTenantDevicesDir(user.tenantId, dirKey),
        resolveTenantCredentialsDir(user.tenantId, dirKey),
        resolveTenantCronDir(user.tenantId, dirKey),
        resolveTenantAgentWorkspaceDir(user.tenantId, undefined, dirKey),
      ];
      for (const dir of dirs) {
        fs.mkdirSync(dir, { recursive: true });
      }
      seedUserDirFiles(user.tenantId, dirKey);
    } catch {
      // Non-fatal: directories will be created on first write
    }

    return { user, created: true };
  } catch {
    // Race condition: another request may have created the user
    const fallback = await query(
      `SELECT * FROM users WHERE tenant_id = $1 AND open_ids @> ARRAY[$2]::varchar[]
         AND (channel_id = $3 OR channel_id IS NULL)`,
      [tenantId, openId, channelId ?? null],
    );
    if (fallback.rows.length > 0) {
      return { user: rowToUser(fallback.rows[0]), created: false };
    }
    throw new Error(`Failed to find or create user for openId=${openId} unionId=${unionId}`);
  }
}

/**
 * Build a user mapping for pipeline env injection (PIVOT_USER_MAP).
 * Maps user display names to their IM platform identifiers.
 * Returns {} on empty tenant or errors.
 */
export async function getUserMap(
  tenantId: string,
  feishuAppId?: string,
  feishuAppSecret?: string,
): Promise<Record<string, { feishu_id?: string; wecom_id?: string }>> {
  try {
    const { users } = await listUsers(tenantId, { limit: 10000 });

    // If feishu app credentials are provided, resolve union_id → open_id via API
    let unionToOpenId: Map<string, string> | undefined;
    if (feishuAppId && feishuAppSecret) {
      const { getFeishuAccessToken } = await import("../../integrations/feishu/token-manager.js");
      const { batchResolveFeishuOpenIds } = await import("../../integrations/feishu/id-resolver.js");
      try {
        const token = await getFeishuAccessToken(feishuAppId, feishuAppSecret);
        const unionIds = users
          .filter((u) => u.unionId)
          .map((u) => u.unionId!);
        if (unionIds.length > 0) {
          unionToOpenId = await batchResolveFeishuOpenIds(token, feishuAppId, unionIds);
        }
      } catch {
        // Feishu API failure — fall through to openIds fallback
      }
    }

    const map: Record<string, { feishu_id?: string; wecom_id?: string }> = {};
    for (const user of users) {
      if (!user.displayName) {
        continue;
      }
      const entry: { feishu_id?: string; wecom_id?: string } = {};
      // Priority: union_id → open_id (via API), fallback to stored openIds[0]
      if (unionToOpenId && user.unionId) {
        const resolved = unionToOpenId.get(user.unionId);
        if (resolved) {
          entry.feishu_id = resolved;
        }
      }
      if (!entry.feishu_id && user.openIds && user.openIds.length > 0 && user.openIds[0]) {
        entry.feishu_id = user.openIds[0];
      }
      if (entry.feishu_id || entry.wecom_id) {
        map[user.displayName] = entry;
      }
    }
    return map;
  } catch {
    return {};
  }
}

// ============================================================
// Pivot Token (ptk) — CLI/API access
// ============================================================

import crypto from "node:crypto";

/**
 * Generate a new ptk token for a user. Overwrites any existing token.
 * Returns the raw token (ptk_xxx) — store it securely, it cannot be recovered.
 */
export async function generatePivotToken(
  tenantId: string,
  userId: string,
  expiresAt?: Date | null,
): Promise<string> {
  const raw = `ptk_${crypto.randomBytes(16).toString("hex")}`;
  const tokenHash = crypto.createHash("sha256").update(raw).digest("hex");
  if (getDbType() === DB_SQLITE) {
    const { sqliteQuery: sq } = await import("../sqlite/index.js");
    sq(
      `UPDATE users SET pivot_token = ?, pivot_token_expires_at = ?, updated_at = datetime('now') WHERE tenant_id = ? AND id = ?`,
      [tokenHash, expiresAt?.toISOString() ?? null, tenantId, userId],
    );
    return raw;
  }
  await query(
    `UPDATE users SET pivot_token = $1, pivot_token_expires_at = $2, updated_at = NOW() WHERE tenant_id = $3 AND id = $4`,
    [tokenHash, expiresAt ?? null, tenantId, userId],
  );
  return raw;
}

/**
 * Verify a ptk token. Returns the user if valid, null otherwise.
 * Token is stored as SHA-256 hash in DB for security.
 */
export async function verifyPivotToken(
  rawToken: string,
): Promise<User | null> {
  if (!rawToken.startsWith("ptk_")) return null;
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  if (getDbType() === DB_SQLITE) {
    const { sqliteQuery: sq } = await import("../sqlite/index.js");
    const result = sq("SELECT * FROM users WHERE pivot_token = ?", [tokenHash]);
    if (result.rows.length === 0) return null;
    const user = rowToUser(result.rows[0]);
    if (user.pivotTokenExpiresAt && new Date(user.pivotTokenExpiresAt) < new Date()) return null;
    if (user.status !== "active") return null;
    return user;
  }
  const result = await query("SELECT * FROM users WHERE pivot_token = $1", [tokenHash]);
  if (result.rows.length === 0) return null;
  const user = rowToUser(result.rows[0]);
  if (user.pivotTokenExpiresAt && new Date(user.pivotTokenExpiresAt) < new Date()) return null;
  if (user.status !== "active") return null;
  return user;
}

/**
 * Revoke a user's ptk token.
 */
export async function revokePivotToken(
  tenantId: string,
  userId: string,
): Promise<void> {
  if (getDbType() === DB_SQLITE) {
    const { sqliteQuery: sq } = await import("../sqlite/index.js");
    sq(
      `UPDATE users SET pivot_token = NULL, pivot_token_expires_at = NULL, updated_at = datetime('now') WHERE tenant_id = ? AND id = ?`,
      [tenantId, userId],
    );
    return;
  }
  await query(
    `UPDATE users SET pivot_token = NULL, pivot_token_expires_at = NULL, updated_at = NOW() WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId],
  );
}
