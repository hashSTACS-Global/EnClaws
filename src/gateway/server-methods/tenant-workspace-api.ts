/**
 * Gateway RPC handlers for tenant-scoped workspace file operations.
 *
 * Methods:
 *   workspace.read    - Read a single file (content + parsed frontmatter)
 *   workspace.write   - Write a file (create / overwrite / append)
 *   workspace.list    - List files in a collection (+ optional status filter)
 *   workspace.query   - Multi-condition query on frontmatter fields
 *   workspace.delete  - Soft delete (move to _trash/)
 *   workspace.stat    - Count + lastModifiedAt for a collection
 *
 * Storage layout:
 *   {TENANT_DIR}/workspace/{path}
 *
 * Path sandbox (applied to all methods):
 *   - No absolute paths
 *   - No `..` segments
 *   - No leading `/` or `\`
 *   - Resolved path must remain within {TENANT_DIR}/workspace/
 *   - No symlink escape on write (pre-lstat middle segments)
 *
 * Every write operation records an audit log entry.
 */

import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import YAML from "yaml";

import type {
  GatewayRequestHandlers,
  GatewayRequestHandlerOptions,
} from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";
import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

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

function getWorkspaceRoot(tenantId: string): string {
  return path.join(resolveTenantDir(tenantId), "workspace");
}

/**
 * Resolve a caller-provided relative path to an absolute filesystem path,
 * verifying it stays within the tenant's workspace sandbox.
 *
 * Throws a string error code on any violation (caller should map to
 * PERMISSION_DENIED response).
 */
function resolveSandboxPath(tenantId: string, requestedPath: string): string {
  if (typeof requestedPath !== "string" || !requestedPath) {
    throw new Error("path required");
  }
  if (path.isAbsolute(requestedPath)) {
    throw new Error("absolute path not allowed");
  }
  if (requestedPath.startsWith("/") || requestedPath.startsWith("\\")) {
    throw new Error("leading slash not allowed");
  }
  const parts = requestedPath.split(/[/\\]/);
  if (parts.includes("..")) {
    throw new Error("parent-relative path not allowed");
  }

  const root = path.resolve(getWorkspaceRoot(tenantId));
  const full = path.resolve(root, requestedPath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error("path escapes workspace root");
  }
  return full;
}

/**
 * Before writing, walk each intermediate directory and ensure none are symlinks
 * pointing outside the workspace. Blocks a symlink-planted escape.
 */
async function assertNoSymlinkEscape(tenantId: string, absPath: string): Promise<void> {
  const root = path.resolve(getWorkspaceRoot(tenantId));
  let cur = root;
  const rel = path.relative(root, absPath);
  const parts = rel.split(path.sep);
  // Exclude the terminal filename; only walk dirs.
  for (let i = 0; i < parts.length - 1; i++) {
    cur = path.join(cur, parts[i]);
    try {
      const st = await fs.lstat(cur);
      if (st.isSymbolicLink()) {
        throw new Error("symlink on path");
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") continue; // not yet created; fine
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Frontmatter parse / serialize
// ---------------------------------------------------------------------------

const FRONTMATTER_DELIM = "---";

/** Split a file's raw text into { frontmatter, body }. Returns null frontmatter if absent. */
function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown> | null; body: string } {
  if (!raw.startsWith(`${FRONTMATTER_DELIM}\n`) && !raw.startsWith(`${FRONTMATTER_DELIM}\r\n`)) {
    return { frontmatter: null, body: raw };
  }
  // Find closing delim
  const lines = raw.split(/\r?\n/);
  let closeIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === FRONTMATTER_DELIM) {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) {
    return { frontmatter: null, body: raw };
  }
  const yamlBlock = lines.slice(1, closeIdx).join("\n");
  let fm: Record<string, unknown> | null = null;
  try {
    const parsed = YAML.parse(yamlBlock, { schema: "core" }) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      fm = parsed as Record<string, unknown>;
    }
  } catch {
    fm = null;
  }
  const body = lines.slice(closeIdx + 1).join("\n");
  return { frontmatter: fm, body };
}

function buildFileContent(frontmatter: Record<string, unknown> | undefined, body: string): string {
  if (!frontmatter || Object.keys(frontmatter).length === 0) {
    return body;
  }
  const yamlStr = YAML.stringify(frontmatter).trimEnd();
  return `${FRONTMATTER_DELIM}\n${yamlStr}\n${FRONTMATTER_DELIM}\n${body}`;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function audit(
  tenant: TenantContext,
  action: string,
  relPath: string,
  detail: Record<string, unknown> = {},
): Promise<void> {
  try {
    await createAuditLog({
      tenantId: tenant.tenantId,
      userId: tenant.userId,
      action,
      resource: relPath,
      detail,
    });
  } catch {
    // swallow - audit is best-effort
  }
}

// ---------------------------------------------------------------------------
// History (for overwrite mode)
// ---------------------------------------------------------------------------

async function saveHistoryCopy(tenantId: string, relPath: string, existingContent: string): Promise<string> {
  const root = getWorkspaceRoot(tenantId);
  const historyDir = path.join(root, "_history", path.dirname(relPath));
  await fs.mkdir(historyDir, { recursive: true });
  const base = path.basename(relPath);
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const historyPath = path.join(historyDir, `${base}.${ts}`);
  await fs.writeFile(historyPath, existingContent, "utf8");
  return path.relative(root, historyPath);
}

// ---------------------------------------------------------------------------
// List / Query helpers
// ---------------------------------------------------------------------------

interface FileEntry {
  path: string;
  frontmatter: Record<string, unknown> | null;
  modifiedAt: string;
  size: number;
}

async function enumerateCollection(
  tenantId: string,
  collection: string,
  opts: { recursive?: boolean } = {},
): Promise<FileEntry[]> {
  const root = getWorkspaceRoot(tenantId);
  const colAbs = resolveSandboxPath(tenantId, collection);

  let entries: fsSync.Dirent[];
  try {
    entries = await fs.readdir(colAbs, { withFileTypes: true });
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw e;
  }

  const out: FileEntry[] = [];
  for (const ent of entries) {
    const entAbs = path.join(colAbs, ent.name);
    const relFromRoot = path.relative(root, entAbs).split(path.sep).join("/");
    if (ent.isDirectory()) {
      if (opts.recursive) {
        const nested = await enumerateCollection(tenantId, relFromRoot, opts);
        out.push(...nested);
      }
      continue;
    }
    if (!ent.isFile()) continue;
    if (!ent.name.endsWith(".md")) continue;

    let raw = "";
    let st;
    try {
      st = await fs.stat(entAbs);
      raw = await fs.readFile(entAbs, "utf8");
    } catch {
      continue;
    }
    const { frontmatter } = splitFrontmatter(raw);
    out.push({
      path: relFromRoot,
      frontmatter,
      modifiedAt: st.mtime.toISOString(),
      size: st.size,
    });
  }
  // default sort: modified desc
  out.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
  return out;
}

type FilterOp = "eq" | "neq" | "gt" | "lt" | "gte" | "lte" | "in" | "contains";
interface Filter {
  field: string;
  op: FilterOp;
  value: unknown;
}

function applyFilter(fm: Record<string, unknown> | null, f: Filter): boolean {
  if (!fm) return false;
  const v = fm[f.field];
  switch (f.op) {
    case "eq":       return v === f.value;
    case "neq":      return v !== f.value;
    case "gt":       return typeof v === "number" && typeof f.value === "number" ? v > f.value : String(v) > String(f.value);
    case "lt":       return typeof v === "number" && typeof f.value === "number" ? v < f.value : String(v) < String(f.value);
    case "gte":      return typeof v === "number" && typeof f.value === "number" ? v >= f.value : String(v) >= String(f.value);
    case "lte":      return typeof v === "number" && typeof f.value === "number" ? v <= f.value : String(v) <= String(f.value);
    case "in":       return Array.isArray(f.value) && (f.value as unknown[]).includes(v);
    case "contains": return typeof v === "string" && typeof f.value === "string" && v.includes(f.value);
    default:         return false;
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const tenantWorkspaceHandlers: GatewayRequestHandlers = {
  // -----------------------------------------------------------------------
  // workspace.read
  // -----------------------------------------------------------------------
  "workspace.read": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = (params as { path?: string })?.path;
    if (!p) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path required"));

    let abs: string;
    try {
      abs = resolveSandboxPath(ctx.tenantId, p);
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, (e as Error).message));
    }

    try {
      const raw = await fs.readFile(abs, "utf8");
      const { frontmatter, body } = splitFrontmatter(raw);
      return respond(true, {
        path: p,
        exists: true,
        content: body,
        frontmatter: frontmatter ?? null,
      });
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return respond(true, { path: p, exists: false, content: "", frontmatter: null });
      }
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, err.message));
    }
  },

  // -----------------------------------------------------------------------
  // workspace.write
  // -----------------------------------------------------------------------
  "workspace.write": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = params as {
      path?: string;
      content?: string;
      frontmatter?: Record<string, unknown>;
      mode?: "create" | "overwrite" | "append";
    };
    const relPath = p?.path;
    const content = p?.content ?? "";
    const frontmatter = p?.frontmatter;
    const mode = p?.mode ?? "create";

    if (!relPath) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path required"));
    if (!["create", "overwrite", "append"].includes(mode)) {
      return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `invalid mode: ${mode}`));
    }

    let abs: string;
    try {
      abs = resolveSandboxPath(ctx.tenantId, relPath);
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, (e as Error).message));
    }

    try {
      await assertNoSymlinkEscape(ctx.tenantId, abs);
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, (e as Error).message));
    }

    let exists = false;
    let existingRaw = "";
    try {
      existingRaw = await fs.readFile(abs, "utf8");
      exists = true;
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code !== "ENOENT") {
        return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, err.message));
      }
    }

    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    let historyPath: string | null = null;
    let finalContent: string;
    let version = 1;

    if (mode === "create") {
      if (exists) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "file exists (mode=create)"));
      }
      finalContent = buildFileContent(frontmatter, content);
    } else if (mode === "overwrite") {
      if (exists) {
        try {
          historyPath = await saveHistoryCopy(ctx.tenantId, relPath, existingRaw);
        } catch {
          // don't block the write if history snapshot failed
        }
        version = countHistoryVersions(ctx.tenantId, relPath) + 1;
      }
      finalContent = buildFileContent(frontmatter, content);
    } else {
      // append
      if (!exists) {
        finalContent = buildFileContent(frontmatter, content);
      } else {
        const split = splitFrontmatter(existingRaw);
        const mergedFm = frontmatter
          ? { ...(split.frontmatter ?? {}), ...frontmatter }
          : split.frontmatter;
        const mergedBody = (split.body ?? "") + (split.body?.endsWith("\n") ? "" : "\n") + content;
        finalContent = buildFileContent(mergedFm ?? undefined, mergedBody);
      }
    }

    try {
      await fs.writeFile(abs, finalContent, "utf8");
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    await audit(ctx, "workspace.write", relPath, {
      mode,
      bytes: Buffer.byteLength(finalContent),
      historyPath,
      version,
    });

    return respond(true, { path: relPath, version, historyPath });
  },

  // -----------------------------------------------------------------------
  // workspace.list
  // -----------------------------------------------------------------------
  "workspace.list": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = params as {
      collection?: string;
      since?: string;
      limit?: number;
      status?: string;
      recursive?: boolean;
    };
    const collection = p?.collection;
    if (!collection) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "collection required"));

    let files: FileEntry[];
    try {
      files = await enumerateCollection(ctx.tenantId, collection, { recursive: !!p.recursive });
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    if (p.since) {
      const sinceMs = Date.parse(p.since);
      if (!isNaN(sinceMs)) {
        files = files.filter(f => Date.parse(f.modifiedAt) >= sinceMs);
      }
    }
    if (p.status) {
      files = files.filter(f => f.frontmatter && f.frontmatter.status === p.status);
    }
    if (typeof p.limit === "number" && p.limit > 0) {
      files = files.slice(0, p.limit);
    }

    return respond(true, { files });
  },

  // -----------------------------------------------------------------------
  // workspace.query
  // -----------------------------------------------------------------------
  "workspace.query": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = params as {
      collection?: string;
      filter?: Filter[];
      limit?: number;
      recursive?: boolean;
    };
    const collection = p?.collection;
    if (!collection) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "collection required"));
    const filters = Array.isArray(p.filter) ? p.filter : [];

    let files: FileEntry[];
    try {
      files = await enumerateCollection(ctx.tenantId, collection, { recursive: !!p.recursive });
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    if (filters.length) {
      files = files.filter(f => filters.every(flt => applyFilter(f.frontmatter, flt)));
    }
    if (typeof p.limit === "number" && p.limit > 0) {
      files = files.slice(0, p.limit);
    }

    return respond(true, { files });
  },

  // -----------------------------------------------------------------------
  // workspace.delete (soft: move to _trash/)
  // -----------------------------------------------------------------------
  "workspace.delete": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.update");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = (params as { path?: string })?.path;
    if (!p) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path required"));

    let abs: string;
    try {
      abs = resolveSandboxPath(ctx.tenantId, p);
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, (e as Error).message));
    }

    try {
      const stat = await fs.stat(abs);
      if (!stat.isFile()) {
        return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "path is not a file"));
      }
    } catch (e: unknown) {
      const err = e as NodeJS.ErrnoException;
      if (err.code === "ENOENT") {
        return respond(true, { ok: true, alreadyAbsent: true });
      }
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, err.message));
    }

    const root = getWorkspaceRoot(ctx.tenantId);
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const trashDir = path.join(root, "_trash", path.dirname(p));
    const trashPath = path.join(trashDir, `${path.basename(p)}.${ts}`);

    try {
      await fs.mkdir(trashDir, { recursive: true });
      await fs.rename(abs, trashPath);
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    await audit(ctx, "workspace.delete", p, {
      trashPath: path.relative(root, trashPath),
    });

    return respond(true, { ok: true, trashPath: path.relative(root, trashPath) });
  },

  // -----------------------------------------------------------------------
  // workspace.stat
  // -----------------------------------------------------------------------
  "workspace.stat": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const collection = (params as { collection?: string })?.collection;
    if (!collection) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "collection required"));

    let files: FileEntry[];
    try {
      files = await enumerateCollection(ctx.tenantId, collection, { recursive: true });
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    const count = files.length;
    const lastModifiedAt = files.length ? files[0].modifiedAt : null;
    return respond(true, { count, lastModifiedAt });
  },
};

// ---------------------------------------------------------------------------
// Sync helpers for version calc (sync fs ok here since only used on write path)
// ---------------------------------------------------------------------------

function countHistoryVersions(tenantId: string, relPath: string): number {
  const root = getWorkspaceRoot(tenantId);
  const historyDir = path.join(root, "_history", path.dirname(relPath));
  const base = path.basename(relPath);
  try {
    const items = fsSync.readdirSync(historyDir);
    return items.filter(x => x.startsWith(`${base}.`)).length;
  } catch {
    return 0;
  }
}
