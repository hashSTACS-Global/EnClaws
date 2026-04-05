/**
 * Gateway RPC handlers for tenant settings management.
 *
 * Methods:
 *   tenant.settings.get    - Get current tenant settings (name, slug, identityPrompt)
 *   tenant.settings.update - Update tenant settings and sync IDENTITY.md to disk
 *   tenant.memory.get      - Get current tenant MEMORY.md content
 *   tenant.memory.update   - Update tenant MEMORY.md content
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { getTenantById, updateTenant } from "../../db/models/tenant.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";
import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";
import fs from "node:fs/promises";
import path from "node:path";

const IDENTITY_FILENAME = "IDENTITY.md";
const MEMORY_FILENAME = "MEMORY.md";

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

/** Sync identityPrompt to the tenant's IDENTITY.md file on disk. */
async function syncTenantIdentityFile(tenantId: string, identityPrompt: string): Promise<void> {
  const tenantDir = resolveTenantDir(tenantId);
  await fs.mkdir(tenantDir, { recursive: true });
  const filePath = path.join(tenantDir, IDENTITY_FILENAME);
  if (identityPrompt.trim()) {
    await fs.writeFile(filePath, identityPrompt, "utf-8");
  } else {
    // If empty, remove the file so it doesn't inject empty content
    try {
      await fs.unlink(filePath);
    } catch {
      // File may not exist, ignore
    }
  }
}

export const tenantSettingsHandlers: GatewayRequestHandlers = {
  "tenant.settings.get": async ({ client, respond }: GatewayRequestHandlerOptions) => {
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

    const tenant = await getTenantById(ctx.tenantId);
    if (!tenant) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Tenant not found"));
      return;
    }

    respond(true, {
      name: tenant.name,
      slug: tenant.slug,
      identityPrompt: tenant.identityPrompt,
    });
  },

  "tenant.settings.update": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) {return;}

    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { name, slug, identityPrompt } = params as {
      name?: string;
      slug?: string;
      identityPrompt?: string;
    };

    if (slug !== undefined && !/^[a-z0-9](?:[a-z0-9_-]{0,126}[a-z0-9])?$/.test(slug)) {
      respond(false, undefined, errorShape(
        ErrorCodes.INVALID_PARAMS,
        "slug 必须为小写字母数字，可包含连字符和下划线，长度 1-128",
      ));
      return;
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) {updates.name = name;}
    if (slug !== undefined) {updates.slug = slug;}
    if (identityPrompt !== undefined) {updates.identityPrompt = identityPrompt;}

    if (Object.keys(updates).length === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "No fields to update"));
      return;
    }

    const updated = await updateTenant(ctx.tenantId, updates as any);
    if (!updated) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Tenant not found"));
      return;
    }

    // Sync IDENTITY.md to disk
    if (identityPrompt !== undefined) {
      await syncTenantIdentityFile(ctx.tenantId, identityPrompt);
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "tenant.settings.update",
      resource: `tenant:${ctx.tenantId}`,
      detail: { name, slug, hasIdentityPrompt: identityPrompt !== undefined },
    });

    respond(true, {
      name: updated.name,
      slug: updated.slug,
      identityPrompt: updated.identityPrompt,
    });
  },

  "tenant.memory.get": async ({ client, respond }: GatewayRequestHandlerOptions) => {
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

    const tenantDir = resolveTenantDir(ctx.tenantId);
    const memoryPath = path.join(tenantDir, MEMORY_FILENAME);
    let content = "";
    try {
      content = await fs.readFile(memoryPath, "utf-8");
    } catch {
      // File may not exist yet
    }

    respond(true, { content });
  },

  "tenant.memory.update": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) {return;}

    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { content } = params as { content?: string };
    if (content === undefined) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "content is required"));
      return;
    }

    const tenantDir = resolveTenantDir(ctx.tenantId);
    await fs.mkdir(tenantDir, { recursive: true });
    const memoryPath = path.join(tenantDir, MEMORY_FILENAME);

    if (content.trim()) {
      await fs.writeFile(memoryPath, content, "utf-8");
    } else {
      try {
        await fs.unlink(memoryPath);
      } catch {
        // File may not exist
      }
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "tenant.memory.update",
      resource: `tenant:${ctx.tenantId}`,
      detail: { contentLength: content.length },
    });

    respond(true, { content });
  },
};
