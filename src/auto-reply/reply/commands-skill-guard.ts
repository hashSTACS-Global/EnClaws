import { logVerbose } from "../../globals.js";
import type { CommandHandler } from "./commands-types.js";

/**
 * Natural-language skill-install intent patterns (中/英).
 *
 * Paired with a role check so member/viewer can't drive the AI to install skills
 * via free-form messages (e.g. "帮我装一下飞书技能包", "install the feishu skill
 * from github …"). Slash commands (/install-skill) are handled separately.
 *
 * Patterns require BOTH an install-intent verb AND a skill noun (or a strong
 * repo-install context with a skill noun) to reduce false positives from casual
 * mentions like "我已经装好飞书了".
 */
const INSTALL_INTENT_PATTERNS: RegExp[] = [
  // 中文动词 + 技能名词（20 字内近邻）
  /(?:安装|部署|添加|加装|下载|装上|装个|帮.*?装|给.*?装)[^。！？\n]{0,20}(?:技能|技能包|技能集|skill)/i,
  // 技能名词 + 中文动词
  /(?:技能|技能包|技能集|skill)[^。！？\n]{0,20}(?:安装|部署|添加|加装|装上|装好)/i,
  // English install/deploy/add + skill(s)
  /\b(?:install|deploy|add|set\s*up|setup)\b[^.!?\n]{0,40}\bskills?\b/i,
  // 仓库来源 + 技能/skill
  /(?:github|gitee|gitlab|bitbucket|仓库|repository|repo|git\s+clone)[^.!?\n]{0,60}(?:技能|技能包|skill)/i,
];

function hasSkillInstallIntent(text: string): boolean {
  if (!text) return false;
  return INSTALL_INTENT_PATTERNS.some((p) => p.test(text));
}

/**
 * Layer-2 guard that runs BEFORE handleInstallSkillCommand in the HANDLERS chain.
 *
 * - Slash commands fall through to dedicated handlers (we only care about NL).
 * - owner/admin or undefined role → allow the message to reach the agent.
 * - member/viewer matching install intent → short-circuit with a friendly notice.
 *
 * Defense-in-depth layer; not a hard security boundary. The agent-side tool
 * guard (checkSkillWritePermission) remains the authoritative stop.
 */
export const handleSkillInstallGuard: CommandHandler = async (params) => {
  const tenantRole = params.ctx.TenantUserRole;
  // Back-compat: no tenant context (CLI / single-user) → never block here.
  if (!tenantRole) return null;
  // owner/admin may install — let the message flow to the agent or slash handler.
  if (tenantRole === "owner" || tenantRole === "admin") return null;

  const raw = params.command.rawBodyNormalized || params.command.commandBodyNormalized || "";
  // Skip slash commands — their own handlers enforce role checks.
  if (raw.startsWith("/")) return null;

  if (!hasSkillInstallIntent(raw)) return null;

  logVerbose(
    `Blocking NL skill-install intent: tenantRole=${tenantRole} sender=${params.command.senderId || "<unknown>"}`,
  );
  return {
    shouldContinue: false,
    reply: {
      text: "权限不足：仅管理员（owner/admin）可安装或部署技能。如需安装，请联系管理员使用 /install-skill 命令。",
    },
  };
};
