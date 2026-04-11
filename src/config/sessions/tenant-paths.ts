/**
 * Tenant-scoped path resolution.
 *
 * New directory layout (v1.0.1+):
 *
 *   ~/.enclaws/tenants/{tenantId}/
 *     ├── IDENTITY.md                        # enterprise identity (from tenant settings)
 *     ├── TOOLS.md                           # enterprise-level tool notes
 *     ├── MEMORY.md                          # enterprise memory (auto-maintained by LLM + UI editable)
 *     ├── agents/
 *     │   └── {agentId}/
 *     │       ├── AGENT.md                   # agent capabilities (was AGENTS.md)
 *     │       ├── SOUL.md                    # agent personality
 *     │       ├── IDENTITY.md               # agent identity
 *     │       ├── HEARTBEAT.md              # agent heartbeat checklist
 *     │       └── BOOTSTRAP.md              # agent first-run ceremony
 *     ├── skills/                            # tenant-level skills (stateless)
 *     │   └── {skillName}/
 *     │       └── SKILL.md
 *     └── users/
 *         └── {unionId}/
 *             ├── USER.md                    # user profile
 *             ├── sessions/
 *             │   ├── sessions.json          # session index (all agents)
 *             │   └── {sessionId}.jsonl      # session transcripts
 *             └── workspace/
 *                 ├── MEMORY.md              # user long-term memory
 *                 └── memory/               # user daily fragmented memory
 *
 * Agents are stateless — they live at the tenant level.
 * Sessions and workspace belong to the user, not to any specific agent.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveRequiredHomeDir } from "../../infra/home-dir.js";
import { DEFAULT_AGENT_ID, normalizeAgentId } from "../../routing/session-key.js";
import { resolveStateDir } from "../paths.js";

// ============================================================================
// Tenant-level paths
// ============================================================================

/**
 * Resolve the base directory for a tenant.
 *
 * ~/.enclaws/tenants/{tenantId}/
 */
export function resolveTenantDir(
  tenantId: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  const root = resolveStateDir(env, homedir);
  return path.join(root, "tenants", tenantId);
}

/**
 * Resolve the tenant-level agent directory (stateless, tenant-scoped).
 *
 * ~/.enclaws/tenants/{tenantId}/agents/{agentId}/
 */
export function resolveTenantAgentDir(tenantId: string, agentId?: string): string {
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  return path.join(resolveTenantDir(tenantId), "agents", id);
}

/**
 * Resolve the tenant-level skills directory.
 *
 * ~/.enclaws/tenants/{tenantId}/skills/
 */
export function resolveTenantSkillsDir(
  tenantId: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  return path.join(resolveTenantDir(tenantId, env, homedir), "skills");
}

// ============================================================================
// User-level paths
// ============================================================================

/**
 * Resolve the base directory for a tenant user.
 *
 * ~/.enclaws/tenants/{tenantId}/users/{userId}/
 */
export function resolveTenantUserDir(
  tenantId: string,
  userId?: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  const root = resolveStateDir(env, homedir);
  if (!userId) {
    throw new Error(
      `resolveTenantUserDir: userId is required for tenant '${tenantId}'. Cannot fall back to _shared.`,
    );
  }
  return path.join(root, "tenants", tenantId, "users", userId);
}

/**
 * Resolve the sessions directory for a tenant user.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/sessions/
 * Single-tenant: ~/.enclaws/agents/{agentId}/sessions/ (unchanged)
 */
export function resolveTenantAgentSessionsDir(
  tenantId: string | undefined,
  agentId?: string,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => resolveRequiredHomeDir(env, os.homedir),
  userId?: string,
): string {
  if (tenantId) {
    const userDir = resolveTenantUserDir(tenantId, userId, env, homedir);
    return path.join(userDir, "sessions");
  }
  // Fall back to original path for single-tenant mode
  const id = normalizeAgentId(agentId ?? DEFAULT_AGENT_ID);
  const root = resolveStateDir(env, homedir);
  return path.join(root, "agents", id, "sessions");
}

/**
 * Resolve the session store JSON path for a tenant user.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/sessions/sessions.json
 */
export function resolveTenantSessionStorePath(
  tenantId: string | undefined,
  agentId?: string,
  userId?: string,
): string {
  return path.join(
    resolveTenantAgentSessionsDir(tenantId, agentId, undefined, undefined, userId),
    "sessions.json",
  );
}

/**
 * Resolve session transcript path for a tenant user.
 */
export function resolveTenantSessionTranscriptPath(
  tenantId: string | undefined,
  sessionId: string,
  agentId?: string,
  topicId?: string | number,
  userId?: string,
): string {
  const sessionsDir = resolveTenantAgentSessionsDir(
    tenantId,
    agentId,
    undefined,
    undefined,
    userId,
  );
  const safeTopicId =
    typeof topicId === "string"
      ? encodeURIComponent(topicId)
      : typeof topicId === "number"
        ? String(topicId)
        : undefined;
  const fileName =
    safeTopicId !== undefined ? `${sessionId}-topic-${safeTopicId}.jsonl` : `${sessionId}.jsonl`;
  return path.join(sessionsDir, fileName);
}

/**
 * Ensure the tenant user's session directories exist.
 */
export function ensureTenantSessionDirs(tenantId: string, agentId?: string, userId?: string): void {
  const dir = resolveTenantAgentSessionsDir(tenantId, agentId, undefined, undefined, userId);
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * Resolve the tenant user's workspace directory.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/workspace/
 */
export function resolveTenantAgentWorkspaceDir(
  tenantId: string,
  agentId?: string,
  userId?: string,
): string {
  const userDir = resolveTenantUserDir(tenantId, userId);
  return path.join(userDir, "workspace");
}

// ============================================================
// Multi-tenant path resolution: devices / credentials / cron
// ============================================================

/**
 * Resolve the tenant user's devices directory.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/devices/
 */
export function resolveTenantDevicesDir(
  tenantId: string,
  userId?: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  const userDir = resolveTenantUserDir(tenantId, userId, env, homedir);
  return path.join(userDir, "devices");
}

/**
 * Resolve the tenant user's credentials directory.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/credentials/
 */
export function resolveTenantCredentialsDir(
  tenantId: string,
  userId?: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  const userDir = resolveTenantUserDir(tenantId, userId, env, homedir);
  return path.join(userDir, "credentials");
}

/**
 * Resolve the tenant user's cron directory.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/cron/
 */
export function resolveTenantCronDir(
  tenantId: string,
  userId?: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  const userDir = resolveTenantUserDir(tenantId, userId, env, homedir);
  return path.join(userDir, "cron");
}

/**
 * Resolve the tenant user's cron store file path.
 *
 * Multi-tenant: ~/.enclaws/tenants/{tenantId}/users/{userId}/cron/jobs.json
 */
export function resolveTenantCronStorePath(
  tenantId: string,
  userId?: string,
  env?: NodeJS.ProcessEnv,
  homedir?: () => string,
): string {
  return path.join(resolveTenantCronDir(tenantId, userId, env, homedir), "jobs.json");
}

/**
 * List all agent IDs that exist on disk for a tenant.
 */
export function listTenantAgentIdsFromDisk(tenantId: string, _userId?: string): string[] {
  const tenantDir = resolveTenantDir(tenantId);
  const agentsDir = path.join(tenantDir, "agents");
  try {
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeAgentId(entry.name))
      .filter(Boolean);
  } catch {
    return [];
  }
}
