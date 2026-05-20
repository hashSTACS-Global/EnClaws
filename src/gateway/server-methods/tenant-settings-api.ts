/**
 * Gateway RPC handlers for tenant settings management.
 *
 * Methods:
 *   tenant.settings.get    - Get current tenant settings (name, identityPrompt)
 *   tenant.settings.update - Update tenant settings and sync IDENTITY.md to disk
 *   tenant.memory.get      - Get current tenant MEMORY.md content
 *   tenant.memory.update   - Update tenant MEMORY.md content
 *   tenant.memory.list     - List enterprise knowledge Markdown files
 *   tenant.memory.file.get - Get one enterprise knowledge Markdown file
 *   tenant.memory.file.set - Create/update one enterprise knowledge Markdown file
 *   tenant.memory.delete   - Delete one enterprise knowledge Markdown file
 */

import type { GatewayRequestHandlers, GatewayRequestHandlerOptions } from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { getTenantById, updateTenant } from "../../db/models/tenant.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";
import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";
import { buildFileEntry, listMemoryFiles } from "../../memory/internal.js";
import { movePathToTrash } from "../../browser/trash.js";
import { isNotFoundPathError } from "../../infra/path-guards.js";
import fs from "node:fs/promises";
import path from "node:path";

const IDENTITY_FILENAME = "IDENTITY.md";
const MEMORY_FILENAME = "MEMORY.md";

function resolveTenantMemoryIoPath(
  tenantDir: string,
  reqPath: string,
): { target: string; rel: string } | null {
  const target = path.resolve(tenantDir, reqPath);
  if (!target.endsWith(".md")) {
    return null;
  }
  const rel = path.relative(tenantDir, target).replace(/\\/g, "/");
  if (rel.startsWith("../") || path.isAbsolute(rel)) {
    return null;
  }
  if (rel === "MEMORY.md" || rel === "memory.md" || rel.startsWith("memory/")) {
    return { target, rel };
  }
  return null;
}

function readTenantMemoryFileName(params: unknown): string | null {
  const raw = params as { name?: unknown; path?: unknown };
  const name = typeof raw?.name === "string" ? raw.name : raw?.path;
  return typeof name === "string" && name.trim() ? name : null;
}

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
    if (!ctx) return;

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
      identityPrompt: tenant.identityPrompt,
    });
  },

  "tenant.settings.update": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const { name, identityPrompt } = params as {
      name?: string;
      identityPrompt?: string;
    };

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (identityPrompt !== undefined) updates.identityPrompt = identityPrompt;

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
      detail: { name, hasIdentityPrompt: identityPrompt !== undefined },
    });

    respond(true, {
      name: updated.name,
      identityPrompt: updated.identityPrompt,
    });
  },

  "tenant.memory.get": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

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
    if (!ctx) return;

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

  "tenant.memory.list": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

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
    const absPaths = await listMemoryFiles(tenantDir);
    const files = [];
    for (const absPath of absPaths) {
      const entry = await buildFileEntry(absPath, tenantDir);
      if (!entry) {
        continue;
      }
      const rel = path.relative(tenantDir, entry.absPath).replace(/\\/g, "/");
      files.push({
        name: rel,
        path: rel,
        missing: false,
        size: entry.size,
        updatedAtMs: entry.mtimeMs,
      });
    }

    respond(true, {
      workspace: tenantDir,
      files,
    });
  },

  "tenant.memory.file.get": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const name = readTenantMemoryFileName(params);
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "name is required"));
      return;
    }
    const tenantDir = resolveTenantDir(ctx.tenantId);
    const resolved = resolveTenantMemoryIoPath(tenantDir, name);
    if (!resolved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid memory file path"));
      return;
    }

    const entry = await buildFileEntry(resolved.target, tenantDir);
    if (!entry) {
      respond(true, {
        workspace: tenantDir,
        file: { name: resolved.rel, path: resolved.rel, missing: true },
      });
      return;
    }

    let content = "";
    try {
      content = await fs.readFile(resolved.target, "utf-8");
    } catch (err) {
      if (!isNotFoundPathError(err)) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to read file"));
        return;
      }
    }

    respond(true, {
      workspace: tenantDir,
      file: {
        name: resolved.rel,
        path: resolved.rel,
        missing: false,
        size: entry.size,
        updatedAtMs: entry.mtimeMs,
        content,
      },
    });
  },

  "tenant.memory.file.set": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const raw = params as { name?: unknown; content?: unknown };
    const name = readTenantMemoryFileName(params);
    if (!name || typeof raw.content !== "string") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "name and content are required"));
      return;
    }

    const tenantDir = resolveTenantDir(ctx.tenantId);
    const resolved = resolveTenantMemoryIoPath(tenantDir, name);
    if (!resolved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid memory file path"));
      return;
    }

    await fs.mkdir(path.dirname(resolved.target), { recursive: true });
    await fs.writeFile(resolved.target, raw.content, "utf-8");

    const entry = await buildFileEntry(resolved.target, tenantDir);
    if (!entry) {
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to stat written file"));
      return;
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "tenant.memory.file.set",
      resource: `tenant:${ctx.tenantId}:memory:${resolved.rel}`,
      detail: { contentLength: raw.content.length },
    });

    respond(true, {
      ok: true,
      workspace: tenantDir,
      file: {
        name: resolved.rel,
        path: resolved.rel,
        missing: false,
        size: entry.size,
        updatedAtMs: entry.mtimeMs,
        content: raw.content,
      },
    });
  },

  "tenant.memory.delete": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;

    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (err) {
      if (err instanceof RbacError) {
        respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, err.message));
        return;
      }
      throw err;
    }

    const name = readTenantMemoryFileName(params);
    if (!name) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_PARAMS, "name is required"));
      return;
    }
    const tenantDir = resolveTenantDir(ctx.tenantId);
    const resolved = resolveTenantMemoryIoPath(tenantDir, name);
    if (!resolved) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "invalid memory file path"));
      return;
    }

    try {
      await movePathToTrash(resolved.target);
    } catch (err) {
      if (!isNotFoundPathError(err)) {
        respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "failed to delete file"));
        return;
      }
    }

    await createAuditLog({
      tenantId: ctx.tenantId,
      userId: ctx.userId,
      action: "tenant.memory.delete",
      resource: `tenant:${ctx.tenantId}:memory:${resolved.rel}`,
      detail: {},
    });

    respond(true, { ok: true, name: resolved.rel });
  },
};
