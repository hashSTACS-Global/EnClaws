/**
 * HTTP POST /api/rpc endpoint for CLI/external API access.
 *
 * Authenticates via ptk token (Authorization: Bearer ptk_xxx),
 * then dispatches to existing app.* RPC handlers.
 *
 * Supports two method formats:
 *   1. "app.invoke" with params {app, pipeline, params} — standard
 *   2. "app.<appName>.<pipelineName>" with params — shortcut (CLI uses this)
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import { verifyPivotToken } from "../db/models/user.js";
import { logWarn } from "../logger.js";

// oxlint-disable-next-line typescript/no-explicit-any
type RpcHandlers = Record<string, (opts: { params: Record<string, unknown>; client: unknown }) => Promise<unknown>>;

let registeredHandlers: RpcHandlers = {};

/**
 * Register the app API handlers for /api/rpc dispatch.
 * Called once during gateway startup from server.impl.ts.
 */
export function registerRpcHandlers(handlers: RpcHandlers): void {
  registeredHandlers = handlers;
}

/**
 * Parse "app.<appName>.<pipelineName>" into app.invoke params.
 * Returns null if the method doesn't match the shortcut format.
 */
function parseShortcutMethod(method: string, params: Record<string, unknown>):
  { resolvedMethod: string; resolvedParams: Record<string, unknown> } | null {
  // Match: app.<appName>.<pipelineName> (at least 3 segments starting with "app.")
  if (!method.startsWith("app.")) return null;
  const parts = method.split(".");
  if (parts.length < 3) return null;
  // "app.list", "app.install" etc. are standard methods, not shortcuts
  if (parts.length === 2) return null;
  // "app.invoke" is standard
  if (parts[1] === "invoke" || parts[1] === "list" || parts[1] === "install" || parts[1] === "uninstall" || parts[1] === "configure") {
    return null;
  }
  // app.<appName>.<pipelineName> → app.invoke {app, pipeline, params}
  const appName = parts[1];
  const pipelineName = parts.slice(2).join("-"); // e.g. app.pivot.discuss-list → discuss-list
  return {
    resolvedMethod: "app.invoke",
    resolvedParams: {
      app: appName,
      pipeline: pipelineName,
      params,
    },
  };
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function jsonResponse(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

/**
 * Handle HTTP requests for /api/rpc.
 * Returns true if the request was handled, false to pass to next handler.
 */
export async function handleHttpRpc(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (url.pathname !== "/api/rpc" || req.method !== "POST") {
    return false;
  }

  // CORS preflight
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Extract Bearer token
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (!token) {
    jsonResponse(res, 401, { ok: false, error: { message: "Missing Authorization: Bearer <token>" } });
    return true;
  }

  // Verify ptk token
  let user;
  try {
    user = await verifyPivotToken(token);
  } catch (e) {
    logWarn(`/api/rpc: token verification error: ${e instanceof Error ? e.message : String(e)}`);
    jsonResponse(res, 500, { ok: false, error: { message: "Token verification failed" } });
    return true;
  }
  if (!user) {
    jsonResponse(res, 401, { ok: false, error: { message: "Invalid or expired token" } });
    return true;
  }

  // Parse request body
  let body: { method?: string; params?: Record<string, unknown> };
  try {
    const raw = await readBody(req);
    body = JSON.parse(raw);
  } catch {
    jsonResponse(res, 400, { ok: false, error: { message: "Invalid JSON body" } });
    return true;
  }

  const method = body.method;
  if (typeof method !== "string" || !method) {
    jsonResponse(res, 400, { ok: false, error: { message: "Missing 'method' field" } });
    return true;
  }

  const params = (body.params ?? {}) as Record<string, unknown>;

  // Try shortcut format: app.<appName>.<pipelineName>
  const shortcut = parseShortcutMethod(method, params);
  const resolvedMethod = shortcut?.resolvedMethod ?? method;
  const resolvedParams = shortcut?.resolvedParams ?? params;

  // Find handler
  const handler = registeredHandlers[resolvedMethod];
  if (!handler) {
    jsonResponse(res, 404, { ok: false, error: { message: `Unknown method: ${method}` } });
    return true;
  }

  // Build client object matching what WS handlers expect
  const client = {
    tenant: {
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
    },
  };

  logWarn(`/api/rpc: method=${method}${shortcut ? ` → ${resolvedMethod}` : ""} user=${user.displayName ?? user.id} tenant=${user.tenantId}`);

  try {
    const result = await handler({ params: resolvedParams, client });
    jsonResponse(res, 200, { ok: true, payload: result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logWarn(`/api/rpc: ${method} failed: ${msg}`);
    jsonResponse(res, 500, { ok: false, error: { message: msg } });
  }
  return true;
}
