import fs from "node:fs";
import path from "node:path";
import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";
import { handleDistill } from "../../experience/distill-command.js";
import { isAutoDistillEvent } from "../../experience/distill-cron.js";
import { handleExperiencePromote, handleExperienceRollback } from "../../experience/promote-command.js";
import { handleExperienceReview, handleExperienceApprove, handleExperienceReject } from "../../experience/review-command.js";
import { handleExperienceReviewApproved, handleExperienceReviewPromoted } from "../../experience/review-command.js";
import { handleExperienceStatus } from "../../experience/status-command.js";
import type { CommandHandler } from "./commands-types.js";

function parseIndices(args: string): number[] {
  return args
    .split(/[,\s]+/)
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

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
        // skip
      }
    }
    return dirs;
  } catch {
    return [];
  }
}

export const handleExperienceCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const normalized = params.command.commandBodyNormalized;

  // Handle cron auto-distill event (systemEvent payload)
  if (isAutoDistillEvent(normalized, (params.ctx as Record<string, unknown>).Trigger as string | undefined)) {
    const tenantId = params.ctx.TenantId;
    if (!tenantId) {
      return { shouldContinue: false };
    }
    await handleDistill({
      cfg: params.cfg,
      tenantId,
      currentUserWorkspaceDir: params.workspaceDir,
      isTenantMode: true,
    });
    return { shouldContinue: false };
  }

  if (!normalized.startsWith("/experience")) {
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    return { shouldContinue: false };
  }

  const tenantId = params.ctx.TenantId;
  if (!tenantId) {
    return {
      shouldContinue: false,
      reply: { text: "Experience commands require a multi-tenant environment." },
    };
  }

  const tenantDir = resolveTenantDir(tenantId);
  const args = normalized.slice("/experience".length).trim();
  const subcommand = args.split(/\s+/)[0]?.toLowerCase() ?? "";
  const subargs = args.slice(subcommand.length).trim();

  if (subcommand === "status") {
    const userWorkspaceDirs = listTenantUserWorkspaceDirs(tenantDir);
    if (!userWorkspaceDirs.includes(params.workspaceDir)) {
      userWorkspaceDirs.push(params.workspaceDir);
    }
    const result = await handleExperienceStatus({
      tenantId,
      tenantDir,
      userWorkspaceDirs,
    });
    return { shouldContinue: false, reply: { text: result } };
  }

  if (subcommand === "review") {
    if (subargs === "approved") {
      const result = await handleExperienceReviewApproved({ tenantId, tenantDir });
      return { shouldContinue: false, reply: { text: result } };
    }
    if (subargs === "promoted") {
      const result = await handleExperienceReviewPromoted({ tenantId, tenantDir });
      return { shouldContinue: false, reply: { text: result } };
    }
    const result = await handleExperienceReview({ tenantId, tenantDir });
    return { shouldContinue: false, reply: { text: result } };
  }

  if (subcommand === "approve") {
    const indices = parseIndices(subargs);
    if (indices.length === 0) {
      return { shouldContinue: false, reply: { text: "Usage: /experience approve 1,2,3" } };
    }
    const result = await handleExperienceApprove({ tenantId, tenantDir, indices });
    return { shouldContinue: false, reply: { text: result } };
  }

  if (subcommand === "reject") {
    const indices = parseIndices(subargs);
    if (indices.length === 0) {
      return { shouldContinue: false, reply: { text: "Usage: /experience reject 1,2,3" } };
    }
    const result = await handleExperienceReject({ tenantId, tenantDir, indices });
    return { shouldContinue: false, reply: { text: result } };
  }

  if (subcommand === "promote") {
    const force = subargs.includes("--force");
    const cleanArgs = subargs.replace("--force", "").trim();
    const indices = cleanArgs ? parseIndices(cleanArgs) : undefined;
    const result = await handleExperiencePromote({
      tenantId,
      tenantDir,
      indices: indices?.length ? indices : undefined,
      cfg: params.cfg,
      force,
    });
    return { shouldContinue: false, reply: { text: result } };
  }

  if (subcommand === "rollback") {
    const indices = parseIndices(subargs);
    if (indices.length === 0) {
      return { shouldContinue: false, reply: { text: "Usage: /experience rollback 1,2,3" } };
    }
    const result = await handleExperienceRollback({ tenantId, tenantDir, indices });
    return { shouldContinue: false, reply: { text: result } };
  }

  return {
    shouldContinue: false,
    reply: { text: "Usage: /experience status | review [approved|promoted] | approve <n> | reject <n> | promote [n] | rollback <n>" },
  };
};
