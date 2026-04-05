import { handleDistill } from "../../experience/distill-command.js";
import type { CommandHandler } from "./commands-types.js";

export const handleDistillCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) {
    return null;
  }

  const normalized = params.command.commandBodyNormalized;
  if (!normalized.startsWith("/distill")) {
    return null;
  }

  if (!params.command.isAuthorizedSender) {
    return { shouldContinue: false };
  }

  const tenantId = params.ctx.TenantId;
  if (!tenantId) {
    return {
      shouldContinue: false,
      reply: { text: "Distill requires a multi-tenant environment." },
    };
  }

  const isTenantMode = normalized.includes("--tenant");

  const result = await handleDistill({
    cfg: params.cfg,
    tenantId,
    currentUserWorkspaceDir: params.workspaceDir,
    isTenantMode,
  });

  return {
    shouldContinue: false,
    reply: { text: result },
  };
};
