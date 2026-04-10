import type { ErrorShape } from "./types.js";

export const ErrorCodes = {
  NOT_LINKED: "NOT_LINKED",
  NOT_PAIRED: "NOT_PAIRED",
  AGENT_TIMEOUT: "AGENT_TIMEOUT",
  INVALID_REQUEST: "INVALID_REQUEST",
  INVALID_PARAMS: "INVALID_PARAMS",
  INTERNAL_ERROR: "INTERNAL_ERROR",
  UNAUTHORIZED: "UNAUTHORIZED",
  UNAVAILABLE: "UNAVAILABLE",
  /** Auth Phase 1: returned by auth.login when rate-limited / in backoff. */
  RATE_LIMITED: "RATE_LIMITED",
  /**
   * Tenant quota exceeded — returned by createAgent / createChannel /
   * inviteUser / onboarding setup when the tenant's plan limit is hit.
   * `details` carries `{ resource: "agents"|"channels"|"users"|"tokensPerMonth", current: number, max: number }`
   * so the frontend can render a localized message.
   */
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export function errorShape(
  code: ErrorCode,
  message: string,
  opts?: { details?: unknown; retryable?: boolean; retryAfterMs?: number },
): ErrorShape {
  return {
    code,
    message,
    ...opts,
  };
}
