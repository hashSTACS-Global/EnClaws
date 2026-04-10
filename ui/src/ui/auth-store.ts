/**
 * Browser-side JWT auth store.
 *
 * Manages access tokens, refresh tokens, and user/tenant context
 * for multi-tenant mode. Stored in localStorage with automatic
 * token refresh before expiry.
 */

import { loadSettings } from "./storage.ts";
import { generateUUID } from "./uuid.ts";

const AUTH_KEY = "enclaws.auth.v1";

/**
 * Hash a password with SHA-256 before sending over the wire.
 * Returns a hex-encoded digest so plaintext never leaves the browser.
 */
export async function hashPasswordForTransport(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Shared gateway client for token refresh ──────────────────
// Set by app-gateway.ts when the main connection is established.
// Allows refreshAccessToken to reuse the existing WebSocket
// instead of creating a throwaway connection each time.
type RpcClient = { request<T>(method: string, params?: unknown): Promise<T> };
let sharedClient: RpcClient | null = null;

export function setRefreshClient(client: RpcClient | null): void {
  sharedClient = client;
}

/** Minimum interval between refresh attempts (throttle). */
const REFRESH_THROTTLE_MS = 300_000;

export interface AuthUser {
  id: string;
  email: string;
  role: string;
  displayName: string | null;
  tenantId: string;
  /** Phase 1 — set on first login after invite or admin reset. */
  forceChangePassword?: boolean;
}

/** Thrown by login() when the gateway returns RATE_LIMITED. */
export class LoginRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number, message: string) {
    super(message);
    this.name = "LoginRateLimitedError";
  }
}

export interface AuthTenant {
  id: string;
  name: string;
  slug: string;
  plan?: string;
}

export interface AuthState {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in ms
  user: AuthUser;
  tenant: AuthTenant;
  /** Phase 2: password expiry timestamp (epoch ms). Absent when policy is disabled. */
  pwExp?: number;
}

let currentAuth: AuthState | null = null;

/**
 * Load auth state from localStorage.
 */
export function loadAuth(): AuthState | null {
  if (currentAuth) return currentAuth;
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    if (!parsed.accessToken || !parsed.refreshToken) return null;
    // Check if expired and no refresh possible
    if (parsed.expiresAt < Date.now() && !parsed.refreshToken) return null;
    currentAuth = parsed;
    // Ensure activity listener is running (covers page reload scenario)
    startActivityListener();
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Save auth state to localStorage and memory.
 */
export function saveAuth(auth: AuthState): void {
  currentAuth = auth;
  localStorage.setItem(AUTH_KEY, JSON.stringify(auth));
  // Prevent activity listener from triggering a refresh immediately after login/refresh
  lastRefreshAttempt = Date.now();
  startActivityListener();
}

/**
 * Clear auth state (logout).
 */
export function clearAuth(): void {
  currentAuth = null;
  localStorage.removeItem(AUTH_KEY);
  stopActivityListener();
}

/**
 * Check if the user is authenticated.
 */
export function isAuthenticated(): boolean {
  const auth = loadAuth();
  return auth !== null && (auth.expiresAt > Date.now() || !!auth.refreshToken);
}

/**
 * Get the current access token, or null if not authenticated.
 */
export function getAccessToken(): string | null {
  const auth = loadAuth();
  if (!auth) return null;
  if (auth.expiresAt > Date.now()) return auth.accessToken;
  return null; // Token expired, needs refresh
}

// ── Activity-based token refresh ──────────────────────────────
let activityListenerActive = false;
let lastRefreshAttempt = 0;
let refreshing = false;

/**
 * Called on user activity. If the token is within the refresh window,
 * trigger a refresh (throttled).
 */
async function onUserActivity(): Promise<void> {
  if (refreshing) return;
  const auth = currentAuth ?? loadAuth();
  if (!auth?.refreshToken) return;

  const now = Date.now();

  // Throttle: don't refresh too frequently
  if (now - lastRefreshAttempt < REFRESH_THROTTLE_MS) return;

  lastRefreshAttempt = now;
  refreshing = true;
  try {
    const result = await refreshAccessToken();
    if (!result && auth?.refreshToken) {
      // Refresh token was rejected (revoked or expired) — force re-login
      clearAuth();
      if (typeof window !== "undefined" && window.location.pathname !== "/login") {
        window.location.href = "/login";
      }
    }
  } catch {
    // silent — will retry on next user activity
  } finally {
    refreshing = false;
  }
}

function startActivityListener(): void {
  if (activityListenerActive) return;
  activityListenerActive = true;
  for (const evt of ["click", "keydown", "scroll", "mousemove", "touchstart"]) {
    document.addEventListener(evt, onUserActivity, { passive: true, capture: true });
  }
}

function stopActivityListener(): void {
  if (!activityListenerActive) return;
  activityListenerActive = false;
  for (const evt of ["click", "keydown", "scroll", "mousemove", "touchstart"]) {
    document.removeEventListener(evt, onUserActivity, true);
  }
}

/**
 * Refresh the access token using the refresh token.
 * Reuses the main gateway WebSocket when available; falls back to
 * a temporary connection otherwise (e.g. before the main client starts).
 */
export async function refreshAccessToken(): Promise<AuthState | null> {
  const auth = loadAuth();
  if (!auth?.refreshToken) return null;

  // Fast path: reuse the existing gateway connection
  if (sharedClient) {
    try {
      const p = await sharedClient.request<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      }>("auth.refresh", { refreshToken: auth.refreshToken });

      const newAuth: AuthState = {
        ...auth,
        accessToken: p.accessToken,
        refreshToken: p.refreshToken,
        expiresAt: Date.now() + p.expiresIn * 1000,
      };
      saveAuth(newAuth);
      return newAuth;
    } catch {
      // Main connection may be down — fall through to temporary WS
    }
  }

  // Fallback: temporary WebSocket (used during login/register flows)
  const settings = loadSettings();
  const wsUrl = settings.gatewayUrl;

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let handshakeDone = false;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "req",
          id: generateUUID(),
          method: "connect",
          params: buildConnectParams(),
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === "res" && !handshakeDone) {
          handshakeDone = true;
          ws.send(
            JSON.stringify({
              type: "req",
              id: generateUUID(),
              method: "auth.refresh",
              params: { refreshToken: auth.refreshToken },
            }),
          );
          return;
        }
        if (frame.type === "res" && handshakeDone) {
          ws.close();
          if (frame.ok && frame.payload) {
            const p = frame.payload as {
              accessToken: string;
              refreshToken: string;
              expiresIn: number;
            };
            const newAuth: AuthState = {
              ...auth,
              accessToken: p.accessToken,
              refreshToken: p.refreshToken,
              expiresAt: Date.now() + p.expiresIn * 1000,
            };
            saveAuth(newAuth);
            resolve(newAuth);
          } else {
            resolve(null);
          }
        }
      } catch {
        resolve(null);
      }
    };

    ws.onerror = () => resolve(null);

    setTimeout(() => {
      ws.close();
      resolve(null);
    }, 10_000);
  });
}

function buildConnectParams() {
  const settings = loadSettings();
  const gatewayToken = settings.token || undefined;
  return {
    minProtocol: 3,
    maxProtocol: 3,
    client: {
      id: "webchat",
      version: "dev",
      platform: navigator.platform ?? "web",
      mode: "webchat",
      instanceId: generateUUID(),
    },
    role: "operator",
    scopes: [],
    caps: [],
    auth: gatewayToken ? { token: gatewayToken } : undefined,
  };
}

/**
 * Login with email and password. Returns auth state on success.
 */
export async function login(params: {
  gatewayUrl: string;
  email: string;
  password: string;
  tenantSlug?: string;
}): Promise<AuthState> {
  const hashedPassword = await hashPasswordForTransport(params.password);
  return new Promise((resolve, reject) => {
    const wsUrl = params.gatewayUrl;
    const ws = new WebSocket(wsUrl);
    let handshakeDone = false;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "req",
          id: generateUUID(),
          method: "connect",
          params: buildConnectParams(),
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === "res" && !handshakeDone) {
          handshakeDone = true;
          ws.send(
            JSON.stringify({
              type: "req",
              id: generateUUID(),
              method: "auth.login",
              params: {
                email: params.email,
                password: hashedPassword,
                tenantSlug: params.tenantSlug,
              },
            }),
          );
          return;
        }
        if (frame.type === "res" && handshakeDone) {
          ws.close();
          if (frame.ok && frame.payload) {
            const p = frame.payload;
            const auth: AuthState = {
              accessToken: p.accessToken,
              refreshToken: p.refreshToken,
              expiresAt: Date.now() + p.expiresIn * 1000,
              user: {
                id: p.user.id,
                email: p.user.email,
                role: p.user.role,
                displayName: p.user.displayName,
                tenantId: p.user.tenantId,
                forceChangePassword: Boolean(p.user.forceChangePassword),
              },
              tenant: {
                id: p.user.tenantId,
                name: "",
                slug: "",
              },
              pwExp: typeof p.pwExp === "number" ? p.pwExp : undefined,
            };
            saveAuth(auth);
            resolve(auth);
          } else {
            const code = frame.error?.code;
            const msg = frame.error?.message ?? "Login failed";
            if (code === "RATE_LIMITED") {
              const wait = Number(frame.error?.retryAfterMs ?? 0);
              reject(new LoginRateLimitedError(wait, msg));
            } else {
              reject(new Error(msg));
            }
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = () => {
      reject(new Error("Connection failed"));
    };

    setTimeout(() => {
      ws.close();
      reject(new Error("Login timeout"));
    }, 15_000);
  });
}

// ===========================================================================
// Phase 1 — public RPC wrapper for unauthenticated flows
// (forgot password, reset, capabilities, view temp password)
// ===========================================================================

interface PublicRpcResult<T> {
  ok: boolean;
  payload?: T;
  errorMessage?: string;
  errorCode?: string;
}

/**
 * Open a temporary WebSocket, perform connect handshake, then issue a single
 * RPC.  Used by forgot-password / reset-password / view-temp flows that run
 * before login, and as a fallback for authenticated flows (force-change-password)
 * where the main shared gateway client isn't yet established.
 *
 * When `jwtToken` is provided, it is placed in `auth.token` of the connect
 * params — the gateway's early tenant-context resolver detects the "." in
 * a JWT and attaches the tenant context to the connection, so subsequent
 * calls on this socket carry authenticated state.
 */
export function callPublicRpc<T = unknown>(
  gatewayUrl: string,
  method: string,
  params: Record<string, unknown>,
  jwtToken?: string,
): Promise<PublicRpcResult<T>> {
  return new Promise((resolve) => {
    const ws = new WebSocket(gatewayUrl);
    let handshakeDone = false;
    let settled = false;
    const finish = (r: PublicRpcResult<T>) => {
      if (settled) return;
      settled = true;
      try { ws.close(); } catch { /* ignore */ }
      resolve(r);
    };

    ws.onopen = () => {
      const connectParams = buildConnectParams();
      if (jwtToken) {
        connectParams.auth = { ...(connectParams.auth ?? {}), token: jwtToken };
      }
      ws.send(JSON.stringify({
        type: "req",
        id: generateUUID(),
        method: "connect",
        params: connectParams,
      }));
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === "res" && !handshakeDone) {
          handshakeDone = true;
          ws.send(JSON.stringify({
            type: "req",
            id: generateUUID(),
            method,
            params,
          }));
          return;
        }
        if (frame.type === "res" && handshakeDone) {
          if (frame.ok) {
            finish({ ok: true, payload: frame.payload as T });
          } else {
            finish({
              ok: false,
              errorCode: frame.error?.code,
              errorMessage: frame.error?.message ?? "request failed",
            });
          }
        }
      } catch (err) {
        finish({ ok: false, errorMessage: String(err) });
      }
    };

    ws.onerror = () => finish({ ok: false, errorMessage: "Connection failed" });

    setTimeout(() => finish({ ok: false, errorMessage: "Request timeout" }), 15_000);
  });
}

/**
 * Authenticated RPC wrapper used by self-service password change.
 * Reuses the shared gateway connection when available; otherwise opens
 * a temporary WebSocket and performs an authenticated connect handshake
 * with the current access token.
 *
 * The fallback path matters for the force-change-password flow: those
 * users are logged in (fcp=true) but the main app shell skipped
 * state.connect() because it immediately routed to the overlay, so
 * sharedClient is null.
 */
export async function callAuthRpc<T = unknown>(
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  if (sharedClient) {
    return sharedClient.request<T>(method, params);
  }
  // Fallback: open a temporary WebSocket carrying the current JWT.
  const auth = loadAuth();
  if (!auth?.accessToken) {
    throw new Error("auth: not authenticated");
  }
  const settings = loadSettings();
  const gatewayUrl = settings.gatewayUrl;
  const result = await callPublicRpc<T>(gatewayUrl, method, params, auth.accessToken);
  if (!result.ok) {
    const err = new Error(result.errorMessage ?? `${method} failed`);
    (err as Error & { code?: string }).code = result.errorCode;
    throw err;
  }
  return result.payload as T;
}

// ---- Phase 1 helper wrappers ----

export async function getAuthCapabilities(gatewayUrl: string): Promise<{ email: boolean }> {
  const r = await callPublicRpc<{ email: boolean }>(gatewayUrl, "auth.capabilities", {});
  if (!r.ok) throw new Error(r.errorMessage ?? "capabilities failed");
  return r.payload ?? { email: false };
}

export async function requestForgotPassword(
  gatewayUrl: string,
  email: string,
): Promise<{ ok: boolean; email: boolean }> {
  const r = await callPublicRpc<{ ok: boolean; email: boolean }>(
    gatewayUrl,
    "auth.forgotPassword",
    { email },
  );
  if (!r.ok) throw new Error(r.errorMessage ?? "forgotPassword failed");
  return r.payload ?? { ok: false, email: false };
}

export async function verifyForgotPassword(
  gatewayUrl: string,
  token: string,
  newPassword: string,
): Promise<void> {
  const r = await callPublicRpc(gatewayUrl, "auth.forgotPassword.verify", {
    token,
    newPassword,
  });
  if (!r.ok) throw new Error(r.errorMessage ?? "reset failed");
}

export async function viewTempPassword(
  gatewayUrl: string,
  token: string,
): Promise<{ tempPassword: string }> {
  const r = await callPublicRpc<{ tempPassword: string }>(
    gatewayUrl,
    "auth.viewTempPassword",
    { token },
  );
  if (!r.ok) throw new Error(r.errorMessage ?? "view failed");
  if (!r.payload) throw new Error("empty response");
  return r.payload;
}

export async function changePasswordAuthed(
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await callAuthRpc("auth.changePassword", { currentPassword, newPassword });
  // After a successful change, the server has revoked all refresh tokens.
  // Clear local auth so the user is forced through a fresh login.
  clearAuth();
}

export async function adminResetPassword(
  userId: string,
): Promise<{ viewToken: string; viewUrl: string; expiresAt: string }> {
  return callAuthRpc("auth.adminResetPassword", { userId });
}

/**
 * Register a new tenant and owner account.
 */
export async function register(params: {
  gatewayUrl: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  password: string;
  displayName?: string;
}): Promise<AuthState> {
  const hashedPassword = await hashPasswordForTransport(params.password);
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(params.gatewayUrl);
    let handshakeDone = false;

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: "req",
          id: generateUUID(),
          method: "connect",
          params: buildConnectParams(),
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === "res" && !handshakeDone) {
          handshakeDone = true;
          ws.send(
            JSON.stringify({
              type: "req",
              id: generateUUID(),
              method: "auth.register",
              params: {
                tenantName: params.tenantName,
                tenantSlug: params.tenantSlug,
                email: params.email,
                password: hashedPassword,
                displayName: params.displayName,
              },
            }),
          );
          return;
        }
        if (frame.type === "res" && handshakeDone) {
          ws.close();
          if (frame.ok && frame.payload) {
            const p = frame.payload;
            const auth: AuthState = {
              accessToken: p.accessToken,
              refreshToken: p.refreshToken,
              expiresAt: Date.now() + p.expiresIn * 1000,
              user: {
                id: p.user.id,
                email: p.user.email,
                role: p.user.role,
                displayName: p.user.displayName,
                tenantId: p.tenant.id,
              },
              tenant: {
                id: p.tenant.id,
                name: p.tenant.name,
                slug: p.tenant.slug,
              },
            };
            saveAuth(auth);
            resolve(auth);
          } else {
            reject(new Error(frame.error?.message ?? "Registration failed"));
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = () => {
      reject(new Error("Connection failed"));
    };

    setTimeout(() => {
      ws.close();
      reject(new Error("Registration timeout"));
    }, 15_000);
  });
}
