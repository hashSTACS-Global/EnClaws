/**
 * Gateway RPC handlers for authentication (login, register, refresh, etc.).
 *
 * Methods:
 *   auth.register              - Register a new tenant + owner user
 *   auth.login                 - Login with email + password
 *   auth.refresh               - Refresh access token
 *   auth.logout                - Revoke refresh token
 *   auth.me                    - Get current user info
 *   auth.changePassword        - Self-service password change
 *   auth.capabilities          - Detect SMTP availability (forgot-password flow)
 *   auth.forgotPassword        - Request a password-reset email
 *   auth.forgotPassword.verify - Consume a reset token + set new password
 *   auth.adminResetPassword    - platform-admin reset for an owner (one-time link)
 *   auth.viewTempPassword      - One-time view of an admin-issued temp password
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { createTenant, getTenantBySlug, getTenantById } from "../../db/models/tenant.js";
import { ensureTenantDirFiles } from "../../agents/workspace.js";
import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";
import { installSkillPack } from "../../agents/skill-pack-installer.js";
import {
  createUser,
  getUserById,
  findUserByEmail,
  getUserByEmail,
  updateLastLogin,
  updateUserPassword,
  setForceChangePassword,
  toSafeUser,
} from "../../db/models/user.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { verifyPassword } from "../../auth/password.js";
import { generateTokenPair, verifyRefreshToken, revokeAllUserTokens } from "../../auth/jwt.js";
import { validatePasswordStrength, generateTempPassword } from "../../auth/password-policy.js";
import {
  loginRateLimiter,
  retryAfterSeconds,
} from "../../auth/login-rate-limit.js";
import { recordLoginAttempt } from "../../auth/login-attempts.js";
import {
  archivePasswordHash,
  isPasswordInHistory,
} from "../../auth/password-history.js";
import {
  computePasswordExpiresAt,
  isPasswordExpired,
} from "../../auth/password-expiry.js";
import {
  hasEmailCapability,
  sendPasswordResetEmail,
} from "../../auth/smtp-capability.js";
import {
  issueResetToken,
  issueViewTempToken,
  findResetToken,
  consumeResetToken,
  decryptTempPasswordPayload,
  revokeAllResetTokens,
  shouldThrottleForgot,
  noteForgotIssued,
} from "../../auth/password-reset.js";
import { isDbInitialized } from "../../db/index.js";
import type { TenantContext } from "../../auth/middleware.js";
import type { JwtPayload } from "../../db/types.js";

function requireDb(respond: GatewayRequestHandlerOptions["respond"]): boolean {
  if (!isDbInitialized()) {
    respond(false, undefined, errorShape(
      ErrorCodes.INVALID_REQUEST,
      "Multi-tenant mode not enabled. Set ENCLAWS_DB_URL to enable.",
    ));
    return false;
  }
  return true;
}

export const authHandlers: GatewayRequestHandlers = {
  /**
   * Register a new tenant with an owner account.
   *
   * Params:
   *   tenantName: string
   *   tenantSlug: string
   *   email: string
   *   password: string
   *   displayName?: string
   */
  "auth.register": async ({ params, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const { tenantName, tenantSlug, email, password, displayName } = params as {
      tenantName: string;
      tenantSlug: string;
      email: string;
      password: string;
      displayName?: string;
    };

    if (!tenantName || !tenantSlug || !email || !password) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "Missing required fields: tenantName, tenantSlug, email, password",
      ));
      return;
    }

    // Validate slug format
    if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,126}[a-zA-Z0-9])?$/.test(tenantSlug)) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "Slug must be alphanumeric with hyphens, 1-128 chars",
      ));
      return;
    }

    // Validate password strength (Phase 1 — policy + weak-password blacklist)
    const policy = validatePasswordStrength(password, email);
    if (!policy.ok) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        policy.message ?? "密码不符合安全策略",
      ));
      return;
    }

    // Check slug uniqueness
    const existing = await getTenantBySlug(tenantSlug);
    if (existing) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_REQUEST,
        "Tenant slug already in use",
      ));
      return;
    }

    // Check global email uniqueness
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_REQUEST,
        "该邮箱已注册",
      ));
      return;
    }

    try {
      // Create tenant
      const tenant = await createTenant({
        name: tenantName,
        slug: tenantSlug,
      });

      // Seed tenant-level directory files immediately after creation
      try {
        await ensureTenantDirFiles(resolveTenantDir(tenant.id));
      } catch (dirErr: unknown) {
        console.warn(`[auth.register] Failed to seed tenant dir files for ${tenant.id}: ${dirErr instanceof Error ? dirErr.message : "unknown"}`);
      }

      // Auto-install skill pack (fire-and-forget, don't block registration)
      installSkillPack(tenant.id).then((packResult) => {
        if (packResult.skipped) {
          console.error(`[skill-pack] tenant ${tenant.id}: skipped — ${packResult.skipped}`);
        } else if (packResult.ok) {
          console.error(`[skill-pack] tenant ${tenant.id}: installed ${packResult.installed.length} skills from ${packResult.source}`);
        } else {
          console.error(`[skill-pack] tenant ${tenant.id}: partial — ok: ${packResult.installed.join(", ")}; errors: ${packResult.errors.map((e) => e.skill).join(", ")}`);
        }
      }).catch((err) => {
        console.error(`[skill-pack] tenant ${tenant.id}: unexpected error —`, err);
      });

      // Create owner user (skip user-level directory init for page registration;
      // directories will be created on-demand when the user actually starts a session)
      const user = await createUser({
        tenantId: tenant.id,
        email,
        password,
        displayName,
        role: "owner",
      }, { skipDirInit: true });

      // Generate tokens
      const payload: JwtPayload = {
        sub: user.id,
        tid: tenant.id,
        email: user.email,
        role: "owner",
        tslug: tenant.slug,
      };
      const tokens = await generateTokenPair(payload);

      await createAuditLog({
        tenantId: tenant.id,
        userId: user.id,
        action: "tenant.register",
        resource: `tenant:${tenant.slug}`,
      });

      respond(true, {
        tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
        user: { id: user.id, email: user.email, role: user.role, displayName: user.displayName },
        ...tokens,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Registration failed";
      if (msg.includes("duplicate key") || msg.includes("unique constraint")) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "该邮箱已注册"));
      } else {
        respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, msg));
      }
    }
  },

  /**
   * Login with email + password.
   *
   * Params:
   *   email: string
   *   password: string
   *   tenantSlug?: string   (optional, for disambiguation)
   */
  "auth.login": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const { email, password, tenantSlug } = params as {
      email: string;
      password: string;
      tenantSlug?: string;
    };

    if (!email || !password) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing email or password"));
      return;
    }

    const clientIp = client?.clientIp;

    // Phase 1 RPC-layer rate limit: compound (ip+email) sliding window
    // + exponential backoff. Returns 429 with retryAfterMs when blocked.
    const gate = loginRateLimiter.check(clientIp, email);
    if (!gate.allowed) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.RATE_LIMITED,
          `登录尝试过于频繁，请 ${retryAfterSeconds(gate.retryAfterMs)} 秒后重试`,
          { retryAfterMs: gate.retryAfterMs },
        ),
      );
      return;
    }

    let user;
    if (tenantSlug) {
      const tenant = await getTenantBySlug(tenantSlug);
      if (!tenant || tenant.status !== "active") {
        const after = loginRateLimiter.recordFailure(clientIp, email);
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "Invalid credentials", {
            retryAfterMs: after.retryAfterMs || undefined,
          }),
        );
        return;
      }
      user = await getUserByEmail(tenant.id, email);
    } else {
      user = await findUserByEmail(email);
    }

    if (!user || user.status !== "active") {
      const after = loginRateLimiter.recordFailure(clientIp, email);
      // Phase 2: persist failure row (no user_id because we can't identify the user)
      void recordLoginAttempt({
        ip: clientIp ?? "unknown",
        email,
        success: false,
      });
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Invalid credentials", {
          retryAfterMs: after.retryAfterMs || undefined,
        }),
      );
      return;
    }

    const valid = user.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!valid) {
      const after = loginRateLimiter.recordFailure(clientIp, email);
      // Phase 2: always persist failed attempts (not just platform-admin/owner)
      void recordLoginAttempt({
        ip: clientIp ?? "unknown",
        email,
        success: false,
      });
      // Audit failed login attempts for platform-admin / owner
      if (user.role === "platform-admin" || user.role === "owner") {
        await createAuditLog({
          tenantId: user.tenantId,
          userId: user.id,
          action: "user.login.failed",
          detail: { ip: clientIp ?? null },
        }).catch(() => undefined);
      }
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "Invalid credentials", {
          retryAfterMs: after.retryAfterMs || undefined,
        }),
      );
      return;
    }

    // Successful authentication — clear the (ip, email) backoff
    loginRateLimiter.recordSuccess(clientIp, email);

    // Phase 2: password expiry check — flip fcp on the user record if
    // the configured max-age has elapsed. This means the JWT issued
    // below will carry fcp:true even though the DB flag wasn't set yet.
    let mustChangePassword = user.forceChangePassword;
    if (!mustChangePassword && isPasswordExpired(user.passwordChangedAt)) {
      mustChangePassword = true;
      await setForceChangePassword(user.id, true).catch(() => undefined);
      await createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        action: "user.password.expired",
      }).catch(() => undefined);
    }

    await updateLastLogin(user.id);

    // Phase 2: persist success row
    void recordLoginAttempt({
      ip: clientIp ?? "unknown",
      email,
      success: true,
    });

    const payload: JwtPayload = {
      sub: user.id,
      tid: user.tenantId,
      email: user.email,
      role: user.role,
      tslug: "", // resolved below
    };
    if (mustChangePassword) {
      payload.fcp = true;
    }
    // Phase 2: include password expiry timestamp when the policy is enabled
    const pwExp = computePasswordExpiresAt(user.passwordChangedAt);
    if (pwExp !== null) {
      payload.pwExp = pwExp;
    }

    // Resolve tenant slug
    const tenant = await getTenantById(user.tenantId);
    if (tenant) {
      payload.tslug = tenant.slug;
    }

    const tokens = await generateTokenPair(payload);

    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.login",
    });

    respond(true, {
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        displayName: user.displayName,
        tenantId: user.tenantId,
        forceChangePassword: mustChangePassword,
      },
      pwExp: pwExp ?? undefined,
      ...tokens,
    });
  },

  /**
   * Refresh access token using a refresh token.
   *
   * Params:
   *   refreshToken: string
   */
  "auth.refresh": async ({ params, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const { refreshToken } = params as { refreshToken: string };
    if (!refreshToken) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing refreshToken"));
      return;
    }

    const result = await verifyRefreshToken(refreshToken);
    if (!result) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Invalid or expired refresh token"));
      return;
    }

    const user = await getUserById(result.userId);
    if (!user || user.status !== "active") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User account is not active"));
      return;
    }

    const tenant = await import("../../db/models/tenant.js").then((m) =>
      m.getTenantById(user.tenantId),
    );

    const payload: JwtPayload = {
      sub: user.id,
      tid: user.tenantId,
      email: user.email,
      role: user.role,
      tslug: tenant?.slug ?? "",
    };
    const tokens = await generateTokenPair(payload);

    respond(true, tokens);
  },

  /**
   * Logout — revoke all refresh tokens for the current user.
   */
  "auth.logout": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const tenant = (client as unknown as { tenant?: TenantContext })?.tenant;
    if (!tenant) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Not authenticated"));
      return;
    }

    await revokeAllUserTokens(tenant.userId);

    await createAuditLog({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      action: "user.logout",
    });

    respond(true, { ok: true });
  },

  /**
   * Get current authenticated user info.
   */
  "auth.me": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const tenant = (client as unknown as { tenant?: TenantContext })?.tenant;
    if (!tenant) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Not authenticated"));
      return;
    }

    const user = await getUserById(tenant.userId);
    if (!user) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User not found"));
      return;
    }

    const tenantInfo = await import("../../db/models/tenant.js").then((m) =>
      m.getTenantById(tenant.tenantId),
    );

    respond(true, {
      user: toSafeUser(user),
      tenant: tenantInfo
        ? { id: tenantInfo.id, name: tenantInfo.name, slug: tenantInfo.slug, plan: tenantInfo.plan }
        : null,
      permissions: await import("../../auth/rbac.js").then((m) =>
        m.getPermissionsForRole(user.role),
      ),
    });
  },

  // ==========================================================================
  // Auth Phase 1 — self-service password change
  // ==========================================================================

  /**
   * Change the current user's password.
   *
   * Params: { currentPassword: string, newPassword: string }
   *
   * On success: revokes all refresh tokens (forces re-login on every device).
   */
  "auth.changePassword": async ({
    params,
    client,
    respond,
  }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const ctx = (client as unknown as { tenant?: TenantContext })?.tenant;
    if (!ctx) {
      respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Not authenticated"));
      return;
    }

    const { currentPassword, newPassword } = params as {
      currentPassword: string;
      newPassword: string;
    };
    if (!currentPassword || !newPassword) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing currentPassword or newPassword"));
      return;
    }

    const user = await getUserById(ctx.userId);
    if (!user || !user.passwordHash) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User has no password set"));
      return;
    }

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "当前密码不正确"));
      return;
    }

    if (currentPassword === newPassword) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "新密码不能与当前密码相同"));
      return;
    }

    const policy = validatePasswordStrength(newPassword, user.email);
    if (!policy.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, policy.message ?? "密码不符合安全策略"));
      return;
    }

    // Phase 2: reject reuse of any of the last N passwords
    if (await isPasswordInHistory(user.id, newPassword)) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "不能与最近 5 次使用过的密码相同",
      ));
      return;
    }

    // Archive the CURRENT hash before overwriting it
    if (user.passwordHash) {
      await archivePasswordHash(user.id, user.passwordHash);
    }
    await updateUserPassword(user.id, newPassword);
    await revokeAllUserTokens(user.id);
    await revokeAllResetTokens(user.id);

    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.password.changed",
    });

    respond(true, { ok: true });
  },

  // ==========================================================================
  // Auth Phase 1 — capability discovery (used by forgot-password page)
  // ==========================================================================

  /**
   * Tell the client whether the deployment can send password-reset emails.
   *
   * Returns: { email: boolean }
   *
   * Public + IP-rate-limited (reuses login limiter under a synthetic email).
   */
  "auth.capabilities": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const clientIp = client?.clientIp;
    const gate = loginRateLimiter.check(clientIp, "__capabilities__");
    if (!gate.allowed) {
      respond(false, undefined, errorShape(
        ErrorCodes.RATE_LIMITED,
        "Too many requests",
        { retryAfterMs: gate.retryAfterMs },
      ));
      return;
    }
    // Count this call against the IP bucket regardless of success.
    loginRateLimiter.recordFailure(clientIp, "__capabilities__");
    respond(true, { email: hasEmailCapability() });
  },

  // ==========================================================================
  // Auth Phase 1 — forgot password (path A: email)
  // ==========================================================================

  /**
   * Begin a forgot-password flow.  Always responds with `ok: true` regardless
   * of whether the email exists, to avoid user enumeration.
   *
   * Params: { email: string }
   */
  "auth.forgotPassword": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const { email } = params as { email: string };
    if (!email) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing email"));
      return;
    }

    // Capability + per-email throttle BEFORE any DB lookup, so cost is bounded.
    if (!hasEmailCapability()) {
      // Respond truthfully so the UI knows to show "contact admin" copy.
      respond(true, { ok: true, email: false });
      return;
    }

    if (shouldThrottleForgot(email)) {
      // Pretend success — don't leak that an in-flight token exists.
      respond(true, { ok: true, email: true });
      return;
    }

    const user = await findUserByEmail(email);
    // Only console-login roles can use forgot-password
    const eligible =
      user && user.status === "active" &&
      (user.role === "platform-admin" || user.role === "owner");

    if (eligible && user) {
      const issued = await issueResetToken(user.id, 30);
      const baseUrl = process.env.ENCLAWS_PUBLIC_BASE_URL ?? "";
      const resetUrl = `${baseUrl.replace(/\/$/, "")}/#/auth/reset-password?token=${encodeURIComponent(issued.token)}`;
      await sendPasswordResetEmail({
        to: user.email ?? email,
        resetUrl,
        expiresInMinutes: 30,
      }).catch((err) => {
        console.error("[auth.forgotPassword] sendPasswordResetEmail failed:", err);
      });
      noteForgotIssued(email);
      await createAuditLog({
        tenantId: user.tenantId,
        userId: user.id,
        action: "user.password.reset.requested",
        ipAddress: client?.clientIp,
      }).catch(() => undefined);
    }

    respond(true, { ok: true, email: true });
  },

  /**
   * Consume a reset token and set a new password.
   *
   * Params: { token: string, newPassword: string }
   */
  "auth.forgotPassword.verify": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const { token, newPassword } = params as { token: string; newPassword: string };
    if (!token || !newPassword) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing token or newPassword"));
      return;
    }

    const found = await findResetToken(token, "reset");
    if (!found) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "重置链接无效或已过期"));
      return;
    }

    const user = await getUserById(found.userId);
    if (!user) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User not found"));
      return;
    }

    const policy = validatePasswordStrength(newPassword, user.email);
    if (!policy.ok) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, policy.message ?? "密码不符合安全策略"));
      return;
    }

    // Bug fix: reject newPassword === current password.  The current hash
    // is NOT in password_history (history only contains *prior* hashes
    // that were rotated away), so the history check below wouldn't catch
    // this on its own — especially for fresh accounts where history is
    // empty.  Compare new plaintext against the stored current hash.
    if (user.passwordHash && await verifyPassword(newPassword, user.passwordHash)) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "新密码不能与当前密码相同",
      ));
      return;
    }

    // Phase 2: reject reuse of any of the last N passwords
    if (await isPasswordInHistory(user.id, newPassword)) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "不能与最近 5 次使用过的密码相同",
      ));
      return;
    }

    if (user.passwordHash) {
      await archivePasswordHash(user.id, user.passwordHash);
    }
    await updateUserPassword(user.id, newPassword);
    await consumeResetToken(found.id);
    await revokeAllUserTokens(user.id);
    await revokeAllResetTokens(user.id);

    await createAuditLog({
      tenantId: user.tenantId,
      userId: user.id,
      action: "user.password.reset.completed",
      ipAddress: client?.clientIp,
    }).catch(() => undefined);

    respond(true, { ok: true });
  },

  // ==========================================================================
  // Auth Phase 1 — admin reset (path B: one-time view link)
  // ==========================================================================

  /**
   * platform-admin generates a temporary password + one-time view link
   * for an owner who has lost access.
   *
   * Params: { userId: string }
   *
   * Returns: { viewToken, viewUrl, expiresAt }
   *           — the admin sends this URL to the owner via any channel.
   */
  "auth.adminResetPassword": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const ctx = (client as unknown as { tenant?: TenantContext })?.tenant;
    if (!ctx || ctx.role !== "platform-admin") {
      respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Only platform-admin can perform this action"));
      return;
    }

    const { userId } = params as { userId: string };
    if (!userId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing userId"));
      return;
    }

    const target = await getUserById(userId);
    if (!target) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "User not found"));
      return;
    }
    if (target.role !== "owner" && target.role !== "platform-admin") {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_REQUEST,
        "Admin reset is only available for owner / platform-admin accounts",
      ));
      return;
    }

    const tempPassword = generateTempPassword();
    await updateUserPassword(target.id, tempPassword, { keepForceFlag: true });
    await setForceChangePassword(target.id, true);
    await revokeAllUserTokens(target.id);
    await revokeAllResetTokens(target.id);

    const issued = await issueViewTempToken(target.id, tempPassword, 24 * 60);
    const baseUrl = process.env.ENCLAWS_PUBLIC_BASE_URL ?? "";
    const viewUrl = `${baseUrl.replace(/\/$/, "")}/#/auth/temp-password?token=${encodeURIComponent(issued.token)}`;

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "user.password.admin_reset",
      resource: `user:${target.id}`,
      detail: { targetUserId: target.id },
      ipAddress: client?.clientIp,
    }).catch(() => undefined);

    respond(true, {
      viewToken: issued.token,
      viewUrl,
      expiresAt: issued.expiresAt.toISOString(),
    });
  },

  /**
   * One-time view of an admin-issued temporary password.
   *
   * Params: { token: string }
   *
   * The first successful read marks the token consumed; subsequent reads
   * return 404.
   */
  "auth.viewTempPassword": async ({ params, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) return;

    const { token } = params as { token: string };
    if (!token) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing token"));
      return;
    }

    const found = await findResetToken(token, "view-temp");
    if (!found) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "链接无效或已过期"));
      return;
    }

    const tempPassword = decryptTempPasswordPayload(found.payload);
    if (!tempPassword) {
      // Payload missing or undecryptable — consume to prevent replay and bail.
      await consumeResetToken(found.id);
      respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, "无法解密临时密码（密钥已变更）"));
      return;
    }

    // Mark consumed BEFORE responding so a network retry can't read it twice.
    await consumeResetToken(found.id);

    respond(true, { tempPassword });
  },
};
