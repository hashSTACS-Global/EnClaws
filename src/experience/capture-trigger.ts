import type { OpenClawConfig } from "../config/config.js";
import type { SessionEntry } from "../config/sessions.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveExperienceCaptureSettings } from "./capture-config.js";
import { extractCandidates } from "./capture.js";

const log = createSubsystemLogger("experience/capture-trigger");

/**
 * Check whether experience capture should run after this turn,
 * and if so, fire-and-forget the extraction.
 *
 * Call this AFTER incrementing turnCount and persisting the session entry.
 *
 * @param force  If true, skip the turnInterval gate (used by boundary capture).
 */
export function maybeRunExperienceCapture(params: {
  cfg: OpenClawConfig;
  sessionEntry: SessionEntry;
  sessionKey: string;
  workspaceDir: string;
  force?: boolean;
}): void {
  const settings = resolveExperienceCaptureSettings(params.cfg);
  if (!settings) {
    return;
  }

  const { sessionEntry, sessionKey } = params;

  // Skip subagent turns
  if (sessionEntry.spawnDepth != null && sessionEntry.spawnDepth > 0) {
    return;
  }

  const turn = sessionEntry.turnCount ?? 0;
  const rawLastCapture = sessionEntry.experienceCaptureAtTurn ?? 0;
  const lastCapture = rawLastCapture > turn ? 0 : rawLastCapture;
  const turnsSinceLastCapture = turn - lastCapture;

  log.info("maybeRunExperienceCapture gate", {
    turn,
    rawLastCapture,
    lastCapture,
    turnsSinceLastCapture,
    force: params.force,
    hasSessionFile: Boolean(sessionEntry.sessionFile),
  });

  if (turnsSinceLastCapture < 1) {
    log.info("Skipped: turnsSinceLastCapture < 1");
    return;
  }

  if (!params.force && turnsSinceLastCapture < settings.turnInterval) {
    return;
  }

  const sessionFilePath = sessionEntry.sessionFile;
  if (!sessionFilePath) {
    return;
  }

  const sessionId = sessionEntry.sessionId;

  // Fire-and-forget
  extractCandidates({
    workspaceDir: params.workspaceDir,
    sessionKey,
    sessionId,
    sessionFilePath,
    turnsSinceLastCapture,
    maxMessages: settings.maxMessages,
    cfg: params.cfg,
    modelOverride: settings.model,
  }).catch((err) => {
    log.warn("Async experience extraction failed", {
      sessionKey,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
