/**
 * Shared WebSocket RPC helper for tenant management views.
 *
 * Handles the mandatory connect handshake before sending the actual request.
 */

import { clearAuth, getAccessToken, loadAuth, refreshAccessToken } from "../../auth-store.ts";
import { loadSettings } from "../../storage.ts";
import { generateUUID } from "../../uuid.ts";

export function resolveGatewayUrl(override?: string): string {
  return override || loadSettings().gatewayUrl;
}

function buildConnectParams(jwtToken: string | null) {
  const settings = loadSettings();
  const gatewayToken = settings.token || undefined;
  // Send gateway token for legacy connect auth, and JWT separately for tenant context
  const auth: Record<string, string> = {};
  if (gatewayToken) auth.token = gatewayToken;
  if (jwtToken) auth.jwt = jwtToken;
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
    scopes: ["operator.admin"],
    caps: [],
    auth: Object.keys(auth).length > 0 ? auth : undefined,
  };
}

async function resolveToken(): Promise<string | null> {
  // Try cached access token first
  const token = getAccessToken();
  if (token) return token;
  // Access token expired — try refresh
  const auth = loadAuth();
  if (auth?.refreshToken) {
    const refreshed = await refreshAccessToken();
    if (refreshed) return refreshed.accessToken;
  }
  return null;
}

/**
 * WebSocket RPC helper for streaming responses.
 *
 * Sends a request, stays open to receive push event frames.
 * The caller closes the connection by returning true from onEvent.
 * Returns a cancel function for cleanup.
 *
 * 流式 RPC 辅助函数：发送请求后保持连接，通过 onEvent 回调接收服务端推送帧。
 * onEvent 返回 true 即关闭连接。返回取消函数供调用方主动关闭。
 */
export function tenantRpcStream(
  method: string,
  params: Record<string, unknown>,
  options: {
    /** Called once with the initial RPC response payload (the ACK). */
    onAck: (payload: unknown) => void;
    /** Called for each push event frame; return true to close the connection. */
    onEvent: (event: string, payload: unknown) => boolean;
    /** Max wait time in ms (default: 60 000). */
    timeoutMs?: number;
    gatewayUrl?: string;
  },
): () => void {
  const { onAck, onEvent, timeoutMs = 60_000, gatewayUrl } = options;
  let ws: WebSocket | null = null;
  let closed = false;

  const cleanup = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    ws?.close();
    ws = null;
  };

  // eslint-disable-next-line prefer-const
  let timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    cleanup();
    onEvent("timeout", null);
  }, timeoutMs);

  // Token resolution is async; run in background.
  // Token 解析异步执行，WS 连接延后建立。
  (async () => {
    const token = await resolveToken();
    if (closed) return;

    ws = new WebSocket(resolveGatewayUrl(gatewayUrl));
    let handshakeDone = false;
    let ackReceived = false;

    ws.onopen = () => {
      ws!.send(JSON.stringify({
        type: "req",
        id: generateUUID(),
        method: "connect",
        params: buildConnectParams(token),
      }));
    };

    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data as string);
        if (frame.type === "res" && !handshakeDone) {
          handshakeDone = true;
          ws!.send(JSON.stringify({ type: "req", id: generateUUID(), method, params }));
          return;
        }
        if (frame.type === "res" && !ackReceived) {
          ackReceived = true;
          if (frame.ok) {
            onAck(frame.payload);
          } else {
            cleanup();
            onEvent("error", frame.error);
          }
          return;
        }
        if (frame.type === "event") {
          const shouldClose = onEvent(frame.event as string, frame.payload);
          if (shouldClose) cleanup();
        }
      } catch (err) {
        cleanup();
        onEvent("error", err);
      }
    };

    ws.onerror = () => {
      cleanup();
      onEvent("error", new Error("连接失败"));
    };
  })();

  return cleanup;
}

export async function tenantRpc(
  method: string,
  params: Record<string, unknown> = {},
  gatewayUrl?: string,
): Promise<unknown> {
  const token = await resolveToken();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(resolveGatewayUrl(gatewayUrl));
    let handshakeDone = false;

    ws.onopen = () => {
      // Gateway requires connect as the first message
      ws.send(JSON.stringify({
        type: "req",
        id: generateUUID(),
        method: "connect",
        params: buildConnectParams(token),
      }));
    };

    ws.onmessage = (event) => {
      try {
        const frame = JSON.parse(event.data);
        if (frame.type === "res" && !handshakeDone) {
          // Connect handshake response — now send the actual request
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
          ws.close();
          if (frame.ok) {
            resolve(frame.payload);
          } else {
            const msg = frame.error?.message ?? "请求失败";
            if (msg === "Authentication required") {
              clearAuth();
              window.location.reload();
            }
            const err = new Error(msg);
            // Preserve the structured error code so callers can branch on it
            // (e.g. translate QUOTA_EXCEEDED into a localized "upgrade" message).
            if (frame.error?.code) {
              (err as any).code = frame.error.code;
            }
            if (frame.error?.details && typeof frame.error.details === "object") {
              (err as any).details = frame.error.details;
            }
            reject(err);
          }
        }
      } catch (err) {
        reject(err);
      }
    };

    ws.onerror = () => reject(new Error("连接失败"));
    setTimeout(() => { ws.close(); reject(new Error("请求超时")); }, 15_000);
  });
}

/**
 * Detect a structured QUOTA_EXCEEDED error returned by the gateway and
 * map it to an i18n key + params suitable for `showError(key, params)`.
 *
 * The optional `contactLink` from error.details is forwarded as a param
 * so the i18n string can render a clickable upgrade link.
 *
 * Returns null if the error is not a quota error, so callers can fall
 * back to their generic error handling.
 */
export function quotaErrorKey(
  err: unknown,
): { key: string; params: Record<string, string> } | null {
  const e = err as {
    code?: string;
    details?: { resource?: string; current?: number; max?: number; contactLink?: string };
  };
  if (e?.code !== "QUOTA_EXCEEDED") return null;
  const resource = String(e.details?.resource ?? "");
  const params: Record<string, string> = {
    current: String(e.details?.current ?? 0),
    max: String(e.details?.max ?? 0),
    contactLink: e.details?.contactLink ?? "",
  };
  const known = ["agents", "channels", "users", "tokensPerMonth"];
  return {
    key: known.includes(resource)
      ? `errors.quotaExceeded.${resource}`
      : "errors.quotaExceeded.generic",
    params,
  };
}
