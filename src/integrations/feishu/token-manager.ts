/**
 * Feishu tenant_access_token manager with auto-refresh caching.
 *
 * API: POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal
 * Tokens are cached per appId and refreshed 5 minutes before expiry.
 */

import { logWarn } from "../../logger.js";

interface CachedToken {
  token: string;
  expiresAt: number; // Date.now() based
}

const cache = new Map<string, CachedToken>();
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // refresh 5 min before expiry

export async function getFeishuAccessToken(
  appId: string,
  appSecret: string,
): Promise<string> {
  const cached = cache.get(appId);
  if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return cached.token;
  }

  try {
    const res = await fetch(
      "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
      },
    );

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      code: number;
      msg?: string;
      tenant_access_token?: string;
      expire?: number;
    };

    if (json.code !== 0 || !json.tenant_access_token) {
      throw new Error(`Feishu API error code=${json.code} msg=${json.msg ?? ""}`);
    }

    const token = json.tenant_access_token;
    const expireSeconds = json.expire ?? 7200;
    cache.set(appId, {
      token,
      expiresAt: Date.now() + expireSeconds * 1000,
    });

    return token;
  } catch (e) {
    // If refresh failed but stale token is still within TTL, return it
    if (cached && cached.expiresAt > Date.now()) {
      logWarn(
        `feishu: token refresh failed for appId=${appId}, using stale token: ${e instanceof Error ? e.message : String(e)}`,
      );
      return cached.token;
    }
    throw new Error(
      `feishu: failed to get tenant_access_token for appId=${appId}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
