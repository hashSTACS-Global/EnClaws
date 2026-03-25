import type { ToolLoopDetectionConfig } from "../config/types.tools.js";
import type { SessionState } from "../logging/diagnostic-session-state.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { isPlainObject } from "../utils.js";
import { normalizeToolName } from "./tool-policy.js";
import type { AnyAgentTool } from "./tools/common.js";

export type HookContext = {
  agentId?: string;
  sessionKey?: string;
  loopDetection?: ToolLoopDetectionConfig;
  /** Tenant user role for permission checks (e.g. blocking skill writes for non-admin). */
  tenantUserRole?: string;
};

/**
 * Runtime tenant role registry, keyed by tenantId:userId.
 * Uses globalThis to survive Vite code-splitting (module may be duplicated across chunks).
 * Entries have a TTL to pick up role changes (e.g., admin demoting a user).
 */
const GLOBAL_KEY = "__openclaw_tenant_user_roles__";
const MAX_TENANT_ROLE_ENTRIES = 1024;
const ROLE_TTL_MS = 10 * 60 * 1000; // 10 minutes, aligned with auto-provision cache

type RoleEntry = { role: string; expiresAt: number };

function getTenantUserRoleMap(): Map<string, RoleEntry> {
  const g = globalThis as Record<string, unknown>;
  if (!g[GLOBAL_KEY]) {
    g[GLOBAL_KEY] = new Map<string, RoleEntry>();
  }
  return g[GLOBAL_KEY] as Map<string, RoleEntry>;
}

export function setTenantUserRole(tenantId: string, userId: string, role: string): void {
  const map = getTenantUserRoleMap();
  const key = `${tenantId}:${userId}`;
  map.set(key, { role, expiresAt: Date.now() + ROLE_TTL_MS });
  if (map.size > MAX_TENANT_ROLE_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

export function getTenantUserRole(tenantId: string, userId: string): string | undefined {
  const entry = getTenantUserRoleMap().get(`${tenantId}:${userId}`);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    getTenantUserRoleMap().delete(`${tenantId}:${userId}`);
    return undefined;
  }
  return entry.role;
}

/** Extract tenantId from a file path like .../tenants/{tenantId}/skills/... */
function extractTenantIdFromPath(filePath: string): string | undefined {
  const match = filePath.replace(/\\/g, "/").match(/tenants\/([^/]+)\//);
  return match?.[1];
}

type HookOutcome = { blocked: true; reason: string } | { blocked: false; params: unknown };

const log = createSubsystemLogger("agents/tools");
const BEFORE_TOOL_CALL_WRAPPED = Symbol("beforeToolCallWrapped");
const adjustedParamsByToolCallId = new Map<string, unknown>();
const MAX_TRACKED_ADJUSTED_PARAMS = 1024;
const LOOP_WARNING_BUCKET_SIZE = 10;
const MAX_LOOP_WARNING_KEYS = 256;

function shouldEmitLoopWarning(state: SessionState, warningKey: string, count: number): boolean {
  if (!state.toolLoopWarningBuckets) {
    state.toolLoopWarningBuckets = new Map();
  }
  const bucket = Math.floor(count / LOOP_WARNING_BUCKET_SIZE);
  const lastBucket = state.toolLoopWarningBuckets.get(warningKey) ?? 0;
  if (bucket <= lastBucket) {
    return false;
  }
  state.toolLoopWarningBuckets.set(warningKey, bucket);
  if (state.toolLoopWarningBuckets.size > MAX_LOOP_WARNING_KEYS) {
    const oldest = state.toolLoopWarningBuckets.keys().next().value;
    if (oldest) {
      state.toolLoopWarningBuckets.delete(oldest);
    }
  }
  return true;
}

async function recordLoopOutcome(args: {
  ctx?: HookContext;
  toolName: string;
  toolParams: unknown;
  toolCallId?: string;
  result?: unknown;
  error?: unknown;
}): Promise<void> {
  if (!args.ctx?.sessionKey) {
    return;
  }
  try {
    const { getDiagnosticSessionState } = await import("../logging/diagnostic-session-state.js");
    const { recordToolCallOutcome } = await import("./tool-loop-detection.js");
    const sessionState = getDiagnosticSessionState({
      sessionKey: args.ctx.sessionKey,
      sessionId: args.ctx?.agentId,
    });
    recordToolCallOutcome(sessionState, {
      toolName: args.toolName,
      toolParams: args.toolParams,
      toolCallId: args.toolCallId,
      result: args.result,
      error: args.error,
      config: args.ctx.loopDetection,
    });
  } catch (err) {
    log.warn(`tool loop outcome tracking failed: tool=${args.toolName} error=${String(err)}`);
  }
}

/** File-level tools that directly write/modify files. */
const FILE_WRITE_TOOLS = new Set(["write", "edit", "apply_patch"]);

/**
 * Destructive shell verbs that modify/delete files.
 * Covers both Unix (rm, mv, cp …) and PowerShell (Remove-Item, Move-Item …)
 * to distinguish "exec runs a skill script" (allowed for member)
 * from "exec deletes/modifies skill files" (blocked for member).
 */
const DESTRUCTIVE_EXEC_PATTERN =
  /\b(rm|rmdir|del|mv|cp|unlink|chmod|chown|truncate|shred|Remove-Item|Move-Item|Copy-Item|Rename-Item|Set-Content|Clear-Content|ri|mi|ci|rni)\b/i;

/**
 * Resolve role for the current tool call.
 * Uses the exact tenantId:userId key — never falls back to "any user in this tenant".
 */
function resolveRoleForToolCall(toolName: string, params: unknown, ctx?: HookContext): { role: string | undefined; isTenantPath: boolean } {
  // Static context (set at tool creation time, usually empty for long-lived tools)
  if (ctx?.tenantUserRole) return { role: ctx.tenantUserRole, isTenantPath: true };

  // Extract tenantId from the tool params path
  const p = params as Record<string, unknown> | undefined;
  if (!p) return { role: undefined, isTenantPath: false };

  const pathStr = String(p.file_path ?? p.filePath ?? p.path ?? p.command ?? p.cmd ?? "");

  const tenantId = extractTenantIdFromPath(pathStr);
  if (!tenantId) return { role: undefined, isTenantPath: false };

  // Look up role by exact tenantId:userId key
  const map = getTenantUserRoleMap();
  const now = Date.now();
  for (const [key, entry] of map) {
    if (key.startsWith(`${tenantId}:`)) {
      if (entry.expiresAt < now) {
        map.delete(key);
        continue;
      }
      return { role: entry.role, isTenantPath: true };
    }
  }
  // Path is under a tenant dir but no role found
  return { role: undefined, isTenantPath: true };
}

/**
 * Check if a tool call targets a skills directory and the user lacks permission.
 *
 * For file-level tools (write/edit/apply_patch): any operation on a skills path
 * is treated as a write and subject to role checks.
 *
 * For exec/process: only destructive commands (rm, mv, etc.) targeting skills
 * paths are blocked. Running a skill script from the skills directory is allowed.
 */
function checkSkillWritePermission(toolName: string, params: unknown, ctx?: HookContext): string | null {
  const p = params as Record<string, unknown> | undefined;
  if (!p) return null;

  let targetsSkills = false;

  if (FILE_WRITE_TOOLS.has(toolName)) {
    // File-level tool: check file path
    const targetPath = String(p.file_path ?? p.filePath ?? p.path ?? "");
    targetsSkills = /[/\\]skills[/\\]/i.test(targetPath);
  } else if (toolName === "exec" || toolName === "process") {
    // Shell command: only block destructive operations targeting skills paths
    const command = String(p.command ?? p.cmd ?? "");
    targetsSkills = /[/\\]skills[/\\]/i.test(command) && DESTRUCTIVE_EXEC_PATTERN.test(command);
  }

  if (!targetsSkills) return null;

  // Targets skills dir — resolve role (fail-closed for tenant paths)
  const { role, isTenantPath } = resolveRoleForToolCall(toolName, params, ctx);

  // Non-tenant path (single-user mode): allow
  if (!isTenantPath) return null;

  // Owner and admin: allow
  if (role === "owner" || role === "admin") return null;

  // Role is member/viewer: deny
  if (role) {
    const reason = `Permission denied: role '${role}' cannot modify skills. Only owner and admin can manage skills.`;
    log.warn(`[skill-permission] blocked ${toolName} for role=${role}`);
    return reason;
  }

  // Tenant path but role unknown (DB lookup failed, context lost, etc.): deny
  log.warn(`[skill-permission] blocked ${toolName}: tenant path detected but role could not be resolved`);
  return "Permission denied: unable to verify skill management permission. Please contact an administrator.";
}

export async function runBeforeToolCallHook(args: {
  toolName: string;
  params: unknown;
  toolCallId?: string;
  ctx?: HookContext;
}): Promise<HookOutcome> {
  const toolName = normalizeToolName(args.toolName || "tool");
  const params = args.params;

  // Check skill write permission before any other processing
  const skillDenied = checkSkillWritePermission(toolName, params, args.ctx);
  if (skillDenied) {
    return { blocked: true, reason: skillDenied };
  }

  if (args.ctx?.sessionKey) {
    const { getDiagnosticSessionState } = await import("../logging/diagnostic-session-state.js");
    const { logToolLoopAction } = await import("../logging/diagnostic.js");
    const { detectToolCallLoop, recordToolCall } = await import("./tool-loop-detection.js");

    const sessionState = getDiagnosticSessionState({
      sessionKey: args.ctx.sessionKey,
      sessionId: args.ctx?.agentId,
    });

    const loopResult = detectToolCallLoop(sessionState, toolName, params, args.ctx.loopDetection);

    if (loopResult.stuck) {
      if (loopResult.level === "critical") {
        log.error(`Blocking ${toolName} due to critical loop: ${loopResult.message}`);
        logToolLoopAction({
          sessionKey: args.ctx.sessionKey,
          sessionId: args.ctx?.agentId,
          toolName,
          level: "critical",
          action: "block",
          detector: loopResult.detector,
          count: loopResult.count,
          message: loopResult.message,
          pairedToolName: loopResult.pairedToolName,
        });
        return {
          blocked: true,
          reason: loopResult.message,
        };
      } else {
        const warningKey = loopResult.warningKey ?? `${loopResult.detector}:${toolName}`;
        if (shouldEmitLoopWarning(sessionState, warningKey, loopResult.count)) {
          log.warn(`Loop warning for ${toolName}: ${loopResult.message}`);
          logToolLoopAction({
            sessionKey: args.ctx.sessionKey,
            sessionId: args.ctx?.agentId,
            toolName,
            level: "warning",
            action: "warn",
            detector: loopResult.detector,
            count: loopResult.count,
            message: loopResult.message,
            pairedToolName: loopResult.pairedToolName,
          });
        }
      }
    }

    recordToolCall(sessionState, toolName, params, args.toolCallId, args.ctx.loopDetection);
  }

  const hookRunner = getGlobalHookRunner();
  if (!hookRunner?.hasHooks("before_tool_call")) {
    return { blocked: false, params: args.params };
  }

  try {
    const normalizedParams = isPlainObject(params) ? params : {};
    const hookResult = await hookRunner.runBeforeToolCall(
      {
        toolName,
        params: normalizedParams,
      },
      {
        toolName,
        agentId: args.ctx?.agentId,
        sessionKey: args.ctx?.sessionKey,
      },
    );

    if (hookResult?.block) {
      return {
        blocked: true,
        reason: hookResult.blockReason || "Tool call blocked by plugin hook",
      };
    }

    if (hookResult?.params && isPlainObject(hookResult.params)) {
      if (isPlainObject(params)) {
        return { blocked: false, params: { ...params, ...hookResult.params } };
      }
      return { blocked: false, params: hookResult.params };
    }
  } catch (err) {
    const toolCallId = args.toolCallId ? ` toolCallId=${args.toolCallId}` : "";
    log.warn(`before_tool_call hook failed: tool=${toolName}${toolCallId} error=${String(err)}`);
  }

  return { blocked: false, params };
}

export function wrapToolWithBeforeToolCallHook(
  tool: AnyAgentTool,
  ctx?: HookContext,
): AnyAgentTool {
  const execute = tool.execute;
  if (!execute) {
    return tool;
  }
  const toolName = tool.name || "tool";
  const wrappedTool: AnyAgentTool = {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const outcome = await runBeforeToolCallHook({
        toolName,
        params,
        toolCallId,
        ctx,
      });
      if (outcome.blocked) {
        throw new Error(outcome.reason);
      }
      if (toolCallId) {
        adjustedParamsByToolCallId.set(toolCallId, outcome.params);
        if (adjustedParamsByToolCallId.size > MAX_TRACKED_ADJUSTED_PARAMS) {
          const oldest = adjustedParamsByToolCallId.keys().next().value;
          if (oldest) {
            adjustedParamsByToolCallId.delete(oldest);
          }
        }
      }
      const normalizedToolName = normalizeToolName(toolName || "tool");
      try {
        const result = await execute(toolCallId, outcome.params, signal, onUpdate);
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          toolCallId,
          result,
        });
        return result;
      } catch (err) {
        await recordLoopOutcome({
          ctx,
          toolName: normalizedToolName,
          toolParams: outcome.params,
          toolCallId,
          error: err,
        });
        throw err;
      }
    },
  };
  Object.defineProperty(wrappedTool, BEFORE_TOOL_CALL_WRAPPED, {
    value: true,
    enumerable: true,
  });
  return wrappedTool;
}

export function isToolWrappedWithBeforeToolCallHook(tool: AnyAgentTool): boolean {
  const taggedTool = tool as unknown as Record<symbol, unknown>;
  return taggedTool[BEFORE_TOOL_CALL_WRAPPED] === true;
}

export function consumeAdjustedParamsForToolCall(toolCallId: string): unknown {
  const params = adjustedParamsByToolCallId.get(toolCallId);
  adjustedParamsByToolCallId.delete(toolCallId);
  return params;
}

export const __testing = {
  BEFORE_TOOL_CALL_WRAPPED,
  adjustedParamsByToolCallId,
  runBeforeToolCallHook,
  isPlainObject,
};
