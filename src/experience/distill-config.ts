import type { OpenClawConfig } from "../config/config.js";

export const DEFAULT_DISTILL_MAX_CANDIDATES_PER_BATCH = 50;
export const DEFAULT_DISTILL_CRON = "0 3 * * *";

export type DistillSettings = {
  enabled: boolean;
  model: string | null;
  maxCandidatesPerBatch: number;
  cron: string;
};

const normalizePositiveInt = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const int = Math.floor(value);
  return int > 0 ? int : null;
};

/**
 * Resolve distillation settings from config.
 * Returns null if distillation is disabled.
 */
export function resolveDistillSettings(cfg?: OpenClawConfig): DistillSettings | null {
  const defaults = cfg?.agents?.defaults?.experience?.distill;
  const enabled = defaults?.enabled ?? true;
  if (!enabled) {
    return null;
  }
  const maxCandidatesPerBatch =
    normalizePositiveInt(defaults?.maxCandidatesPerBatch) ??
    DEFAULT_DISTILL_MAX_CANDIDATES_PER_BATCH;
  const model = typeof defaults?.model === "string" ? defaults.model.trim() || null : null;
  const cron = typeof defaults?.cron === "string" && defaults.cron.trim() ? defaults.cron.trim() : DEFAULT_DISTILL_CRON;

  return { enabled, model, maxCandidatesPerBatch, cron };
}
