/**
 * Gateway RPC handlers for authentication (login, register, refresh, etc.).
 *
 * Methods:
 *   auth.register   - Register a new tenant + owner user
 *   auth.login      - Login with email + password
 *   auth.refresh    - Refresh access token
 *   auth.logout     - Revoke refresh token
 *   auth.me         - Get current user info
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
  toSafeUser,
} from "../../db/models/user.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { verifyPassword } from "../../auth/password.js";
import { generateTokenPair, verifyRefreshToken, revokeAllUserTokens } from "../../auth/jwt.js";
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
    if (!requireDb(respond)) {return;}

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

    // Validate password strength
    if (password.length < 8) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "Password must be at least 8 characters",
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
  "auth.login": async ({ params, respond }: GatewayRequestHandlerOptions) => {
    if (!requireDb(respond)) {return;}

    const { email, password, tenantSlug } = params as {
      email: string;
      password: string;
      tenantSlug?: string;
    };

    if (!email || !password) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "Missing email or password"));
      return;
    }

    let user;
    if (tenantSlug) {
      const tenant = await getTenantBySlug(tenantSlug);
      if (!tenant || tenant.status !== "active") {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Invalid credentials"));
        return;
      }
      user = await getUserByEmail(tenant.id, email);
    } else {
      user = await findUserByEmail(email);
    }

    if (!user || user.status !== "active") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Invalid credentials"));
      return;
    }

    const valid = user.passwordHash ? await verifyPassword(password, user.passwordHash) : false;
    if (!valid) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Invalid credentials"));
      return;
    }

    await updateLastLogin(user.id);

    const payload: JwtPayload = {
      sub: user.id,
      tid: user.tenantId,
      email: user.email,
      role: user.role,
      tslug: "", // Will be resolved below
    };

    // Resolve tenant slug
    const tenant = await import("../../db/models/tenant.js").then((m) =>
      m.getTenantById(user.tenantId),
    );
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
      },
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
    if (!requireDb(respond)) {return;}

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
    if (!requireDb(respond)) {return;}

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
    if (!requireDb(respond)) {return;}

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
};
