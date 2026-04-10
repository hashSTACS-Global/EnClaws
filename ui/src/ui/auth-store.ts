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
              },
              tenant: {
                id: p.user.tenantId,
                name: "",
                slug: "",
              },
            };
            saveAuth(auth);
            resolve(auth);
          } else {
            reject(new Error(frame.error?.message ?? "Login failed"));
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
