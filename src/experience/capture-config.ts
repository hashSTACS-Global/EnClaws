import type { OpenClawConfig } from "../config/config.js";

export const DEFAULT_EXPERIENCE_CAPTURE_TURN_INTERVAL = 5;
export const DEFAULT_EXPERIENCE_CAPTURE_MAX_MESSAGES = 20;

export type ExperienceCaptureSettings = {
  enabled: boolean;
  turnInterval: number;
  model: string | null;
  maxMessages: number;
};

const normalizePositiveInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int > 0 ? int : null;
};

/**
 * Resolve experience capture settings from config.
 * Returns null if capture is disabled.
 */
export function resolveExperienceCaptureSettings(
  cfg?: OpenClawConfig,
): ExperienceCaptureSettings | null {
  const defaults = cfg?.agents?.defaults?.experience?.capture;
  const enabled = defaults?.enabled ?? true;
  if (!enabled) {
    return null;
  }
  const turnInterval =
    normalizePositiveInt(defaults?.turnInterval) ?? DEFAULT_EXPERIENCE_CAPTURE_TURN_INTERVAL;
  const maxMessages =
    normalizePositiveInt(defaults?.maxMessages) ?? DEFAULT_EXPERIENCE_CAPTURE_MAX_MESSAGES;
  const model = typeof defaults?.model === "string" ? defaults.model.trim() || null : null;

  return { enabled, turnInterval, model, maxMessages };
}
