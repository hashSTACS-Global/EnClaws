import { randomBytes } from "node:crypto";
import { createSubsystemLogger } from "../logging/subsystem.js";

const log = createSubsystemLogger("gateway-token-cache");

export type GatewayTokenEntry = {
  sessionLabel: string;
  internalSessionKey: string;
  tenantId: string;
  agentSlug: string;
  channel: string;
  userOpenId: string;
  userUnionId: string;
  userDisplayName?: string;
  createdAt: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

let ttlMs = DEFAULT_TTL_MS;
let nowFn: () => number = () => Date.now();

const tokenMap = new Map<string, GatewayTokenEntry>();
const sessionToTokenMap = new Map<string, string>();

function generateToken(): string {
  return `ectk_${randomBytes(32).toString("base64url")}`;
}

function removeToken(token: string, entry: GatewayTokenEntry): void {
  tokenMap.delete(token);
  if (sessionToTokenMap.get(entry.internalSessionKey) === token) {
    sessionToTokenMap.delete(entry.internalSessionKey);
  }
}

export function issueGatewayToken(entry: Omit<GatewayTokenEntry, "createdAt">): string {
  const oldToken = sessionToTokenMap.get(entry.internalSessionKey);
  if (oldToken) {
    tokenMap.delete(oldToken);
  }

  const token = generateToken();
  const full: GatewayTokenEntry = { ...entry, createdAt: nowFn() };
  tokenMap.set(token, full);
  sessionToTokenMap.set(entry.internalSessionKey, token);
  return token;
}

export function resolveGatewayToken(token: string): GatewayTokenEntry | null {
  const entry = tokenMap.get(token);
  if (!entry) {
    return null;
  }
  if (nowFn() - entry.createdAt > ttlMs) {
    removeToken(token, entry);
    return null;
  }
  return entry;
}

export function revokeGatewayToken(token: string): void {
  const entry = tokenMap.get(token);
  if (!entry) {
    return;
  }
  removeToken(token, entry);
}

export function sweepExpiredTokens(): number {
  const now = nowFn();
  let swept = 0;
  for (const [token, entry] of tokenMap.entries()) {
    if (now - entry.createdAt > ttlMs) {
      removeToken(token, entry);
      swept += 1;
    }
  }
  if (swept > 0) {
    log.info(`sweep cleaned ${swept} expired tokens`);
  }
  return swept;
}

export function __testOnlyReset(overrides?: { ttlMs?: number; nowFn?: () => number }): void {
  tokenMap.clear();
  sessionToTokenMap.clear();
  ttlMs = overrides?.ttlMs ?? DEFAULT_TTL_MS;
  nowFn = overrides?.nowFn ?? (() => Date.now());
}

export function __testOnlySize(): { tokenMap: number; sessionToTokenMap: number } {
  return { tokenMap: tokenMap.size, sessionToTokenMap: sessionToTokenMap.size };
}

let sweepTimer: NodeJS.Timeout | undefined;

export function startGatewayTokenSweep(intervalMs: number = DEFAULT_SWEEP_INTERVAL_MS): void {
  if (sweepTimer) {
    return;
  }
  sweepTimer = setInterval(() => {
    try {
      sweepExpiredTokens();
    } catch (err) {
      log.error(`sweep failed: ${String(err)}`);
    }
  }, intervalMs);
  sweepTimer.unref?.();
}

export function stopGatewayTokenSweep(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
}

if (process.env.NODE_ENV !== "test") {
  startGatewayTokenSweep();
}
