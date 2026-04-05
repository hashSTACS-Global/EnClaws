import fs from "node:fs";
import path from "node:path";
import type { OpenClawConfig } from "../config/config.js";
import { resolveTenantDir } from "../config/sessions/tenant-paths.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveDistillSettings } from "./distill-config.js";
import { runDistill, type DistillResult } from "./distill.js";

const log = createSubsystemLogger("experience/distill-command");

/**
 * List all user workspace directories under a tenant.
 * Scans tenants/{tid}/users/ for subdirectories with a workspace/ child.
 */
function listTenantUserWorkspaceDirs(tenantDir: string): string[] {
  const usersDir = path.join(tenantDir, "users");
  try {
    const entries = fs.readdirSync(usersDir, { withFileTypes: true });
    const dirs: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const workspaceDir = path.join(usersDir, entry.name, "workspace");
      try {
        fs.accessSync(workspaceDir);
        dirs.push(workspaceDir);
      } catch {
        // No workspace dir for this user, skip
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

function formatDistillResult(result: DistillResult): string {
  if (result.totalCandidates === 0) {
    return "No pending candidates to distill.";
  }

  const lines = ["Distilling experience candidates..."];
  const kinds = ["fact", "preference", "workflow", "policy_hint", "failure_pattern", "tool_recipe"];
  const skipped: string[] = [];

  for (const kind of kinds) {
    const data = result.byKind[kind];
    if (data && data.candidates > 0) {
      lines.push(`  - ${kind}: ${data.candidates} candidates → ${data.records} records`);
    } else {
      skipped.push(kind);
    }
  }

  if (skipped.length > 0) {
    lines.push(`  - (${skipped.join(", ")}: 0 candidates, skipped)`);
  }

  lines.push(
    `Done: ${result.totalCandidates} candidates distilled into ${result.totalRecords} records.`,
  );
  if (result.outputPath) {
    lines.push(`Saved to ${result.outputPath}`);
  }

  return lines.join("\n");
}

/**
 * Handle /distill command.
 * Returns a user-visible result string.
 */
export async function handleDistill(params: {
  cfg: OpenClawConfig;
  tenantId: string;
  currentUserWorkspaceDir: string;
  isTenantMode: boolean;
}): Promise<string> {
  const settings = resolveDistillSettings(params.cfg);
  if (!settings) {
    return "Experience distillation is disabled.";
  }

  const tenantDir = resolveTenantDir(params.tenantId);

  let userWorkspaceDirs: string[];
  if (params.isTenantMode) {
    userWorkspaceDirs = listTenantUserWorkspaceDirs(tenantDir);
    if (userWorkspaceDirs.length === 0) {
      return "No user workspaces found for this tenant.";
    }
  } else {
    userWorkspaceDirs = [params.currentUserWorkspaceDir];
  }

  try {
    const result = await runDistill({
      cfg: params.cfg,
      tenantId: params.tenantId,
      tenantDir,
      userWorkspaceDirs,
      settings,
    });
    return formatDistillResult(result);
  } catch (err) {
    log.error("Distill command failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return `Distillation failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}
