/**
 * Browser-side JWT auth store.
 *
 * Manages access tokens, refresh tokens, and user/tenant context
 * for multi-tenant mode. Stored in localStorage with automatic
 * token refresh before expiry.
 */

import { loadSettings } from "./storage.ts";
import { generateUUID } from "./uuid.ts";

const AUTH_KEY = "openclaw.auth.v1";

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
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

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
  scheduleRefresh(auth);
}

/**
 * Clear auth state (logout).
 */
export function clearAuth(): void {
  currentAuth = null;
  localStorage.removeItem(AUTH_KEY);
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
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

/**
 * Schedule automatic token refresh before expiry.
 */
function scheduleRefresh(auth: AuthState): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }
  // Refresh 60 seconds before expiry
  const refreshAt = auth.expiresAt - 60_000;
  const delay = refreshAt - Date.now();
  if (delay <= 0) return; // Already expired or about to

  refreshTimer = setTimeout(async () => {
    try {
      await refreshAccessToken();
    } catch {
      // Refresh failed — keep auth state so JWT can still be sent
      // to the gateway for server-side verification.
    }
  }, delay);
}

/**
 * Refresh the access token using the refresh token.
 * Called automatically before expiry, or manually when needed.
 */
export async function refreshAccessToken(): Promise<AuthState | null> {
  const auth = loadAuth();
  if (!auth?.refreshToken) return null;

  // Use HTTP endpoint instead of WebSocket for token refresh
  const baseUrl = window.location.origin;
  try {
    const response = await fetch(`${baseUrl}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: auth.refreshToken }),
    });

    if (!response.ok) {
      // Don't clear auth on HTTP failure — the endpoint may not exist.
      // Let the token stay so it can be sent to the gateway for server-side verification.
      return null;
    }

    const data = await response.json();
    const newAuth: AuthState = {
      ...auth,
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresAt: Date.now() + data.expiresIn * 1000,
    };
    saveAuth(newAuth);
    return newAuth;
  } catch {
    // If HTTP refresh fails, try via gateway WebSocket
    return null;
  }
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
                password: params.password,
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
                password: params.password,
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
