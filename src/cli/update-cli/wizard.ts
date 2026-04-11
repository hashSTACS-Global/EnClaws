import { confirm, isCancel } from "@clack/prompts";
import {
  formatUpdateTrackLabel,
  resolveEffectiveUpdateTrack,
} from "../../infra/update-channels.js";
import { checkUpdateStatus } from "../../infra/update-check.js";
import { getStoredUpdateTrack } from "../../infra/update-settings.js";
import { defaultRuntime } from "../../runtime.js";
import { selectStyled } from "../../terminal/prompt-select-styled.js";
import { stylePromptMessage } from "../../terminal/prompt-style.js";
import { theme } from "../../terminal/theme.js";
import { pathExists } from "../../utils.js";
import {
  isEmptyDir,
  isGitCheckout,
  parseTimeoutMsOrExit,
  resolveGitInstallDir,
  resolveUpdateRoot,
  type UpdateWizardOptions,
} from "./shared.js";
import { updateCommand } from "./update-command.js";

export async function updateWizardCommand(opts: UpdateWizardOptions = {}): Promise<void> {
  if (!process.stdin.isTTY) {
    defaultRuntime.error(
      "Update wizard requires a TTY. Use `enclaws update --track <stable|beta|dev>` instead.",
    );
    defaultRuntime.exit(1);
    return;
  }

  const timeoutMs = parseTimeoutMsOrExit(opts.timeout);
  if (timeoutMs === null) {
    return;
  }

  const root = await resolveUpdateRoot();
  const [updateStatus, storedTrack] = await Promise.all([
    checkUpdateStatus({
      root,
      timeoutMs: timeoutMs ?? 3500,
      fetchGit: false,
      includeRegistry: false,
    }),
    getStoredUpdateTrack(),
  ]);

  const trackInfo = resolveEffectiveUpdateTrack({
    storedTrack,
    installKind: updateStatus.installKind,
    git: updateStatus.git
      ? { tag: updateStatus.git.tag, branch: updateStatus.git.branch }
      : undefined,
  });
  const trackLabel = formatUpdateTrackLabel({
    track: trackInfo.track,
    source: trackInfo.source,
    gitTag: updateStatus.git?.tag ?? null,
    gitBranch: updateStatus.git?.branch ?? null,
  });

  const pickedTrack = await selectStyled({
    message: "Release track",
    options: [
      {
        value: "keep",
        label: `Keep current (${trackInfo.track})`,
        hint: trackLabel,
      },
      {
        value: "stable",
        label: "Stable",
        hint: "Tagged releases (npm latest)",
      },
      {
        value: "beta",
        label: "Beta",
        hint: "Prereleases (npm beta)",
      },
      {
        value: "dev",
        label: "Dev",
        hint: "Git main",
      },
    ],
    initialValue: "keep",
  });

  if (isCancel(pickedTrack)) {
    defaultRuntime.log(theme.muted("Update cancelled."));
    defaultRuntime.exit(0);
    return;
  }

  const requestedTrack = pickedTrack === "keep" ? null : pickedTrack;

  if (requestedTrack === "dev" && updateStatus.installKind !== "git") {
    const gitDir = resolveGitInstallDir();
    const hasGit = await isGitCheckout(gitDir);
    if (!hasGit) {
      const dirExists = await pathExists(gitDir);
      if (dirExists) {
        const empty = await isEmptyDir(gitDir);
        if (!empty) {
          defaultRuntime.error(
            `ENCLAWS_GIT_DIR points at a non-git directory: ${gitDir}. Set ENCLAWS_GIT_DIR to an empty folder or an enclaws checkout.`,
          );
          defaultRuntime.exit(1);
          return;
        }
      }

      const ok = await confirm({
        message: stylePromptMessage(
          `Create a git checkout at ${gitDir}? (override via ENCLAWS_GIT_DIR)`,
        ),
        initialValue: true,
      });
      if (isCancel(ok) || !ok) {
        defaultRuntime.log(theme.muted("Update cancelled."));
        defaultRuntime.exit(0);
        return;
      }
    }
  }

  const restart = await confirm({
    message: stylePromptMessage("Restart the gateway service after update?"),
    initialValue: true,
  });
  if (isCancel(restart)) {
    defaultRuntime.log(theme.muted("Update cancelled."));
    defaultRuntime.exit(0);
    return;
  }

  try {
    await updateCommand({
      track: requestedTrack ?? undefined,
      restart: Boolean(restart),
      timeout: opts.timeout,
    });
  } catch (err) {
    defaultRuntime.error(String(err));
    defaultRuntime.exit(1);
  }
}
