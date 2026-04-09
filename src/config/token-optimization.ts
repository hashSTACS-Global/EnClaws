const PHASE_TOGGLES = {
  P1: "ENCLAWS_TOKEN_OPT_P1",
  CACHE: "ENCLAWS_TOKEN_OPT_CACHE",
  TRIM: "ENCLAWS_TOKEN_OPT_TRIM",
  WORKER: "ENCLAWS_TOKEN_OPT_WORKER",
  COMPRESS: "ENCLAWS_TOKEN_OPT_COMPRESS",
  DEDUP: "ENCLAWS_TOKEN_OPT_DEDUP",
} as const;

/**
 * Check whether a specific token optimization phase is enabled.
 * Each phase is controlled by an independent env var, allowing
 * granular rollback without affecting other optimizations.
 */
export function isOptEnabled(key: keyof typeof PHASE_TOGGLES): boolean {
  return process.env[PHASE_TOGGLES[key]] === "true";
}
