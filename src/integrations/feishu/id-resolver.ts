/**
 * Feishu union_id → open_id resolver.
 *
 * API: GET https://open.feishu.cn/open-apis/contact/v3/users/{union_id}?department_id_type=department_id&user_id_type=union_id
 * Requires scope: contact:user.base:readonly (or broader contact scope)
 *
 * Results are cached per (appId, unionId) for 30 minutes since open_id
 * is stable for a given app+user pair.
 */

import { logWarn } from "../../logger.js";

interface CachedOpenId {
  openId: string;
  expiresAt: number;
}

const cache = new Map<string, CachedOpenId>();
const CACHE_TTL_MS = 30 * 60 * 1000;

function cacheKey(appId: string, unionId: string): string {
  return `${appId}:${unionId}`;
}

/**
 * Resolve a single union_id to open_id using the Feishu contact API.
 * Returns null if the user cannot be resolved (not found, no permission, etc.).
 */
export async function resolveFeishuOpenId(
  accessToken: string,
  appId: string,
  unionId: string,
): Promise<string | null> {
  const key = cacheKey(appId, unionId);
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.openId;
  }

  try {
    const url = `https://open.feishu.cn/open-apis/contact/v3/users/${encodeURIComponent(unionId)}?department_id_type=department_id&user_id_type=union_id`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const json = (await res.json()) as {
      code: number;
      msg?: string;
      data?: { user?: { open_id?: string } };
    };

    if (json.code !== 0) {
      logWarn(`feishu: contact API error for unionId=${unionId}: code=${json.code} msg=${json.msg ?? ""}`);
      return null;
    }

    const openId = json.data?.user?.open_id;
    if (!openId) {
      return null;
    }

    cache.set(key, { openId, expiresAt: Date.now() + CACHE_TTL_MS });
    return openId;
  } catch (e) {
    logWarn(`feishu: resolveOpenId failed for unionId=${unionId}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/**
 * Batch resolve union_ids to open_ids. Calls the API per-user (Feishu contact
 * API v3 does not have a batch union_id→open_id endpoint). Results are cached
 * individually so subsequent calls for the same users are instant.
 *
 * Returns a Map<unionId, openId>. Missing/failed entries are omitted.
 */
export async function batchResolveFeishuOpenIds(
  accessToken: string,
  appId: string,
  unionIds: string[],
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Parallelize with concurrency limit to avoid rate limiting
  const CONCURRENCY = 5;
  const queue = [...unionIds];

  const worker = async () => {
    while (queue.length > 0) {
      const unionId = queue.shift();
      if (!unionId) break;
      const openId = await resolveFeishuOpenId(accessToken, appId, unionId);
      if (openId) {
        results.set(unionId, openId);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker()));
  return results;
}
