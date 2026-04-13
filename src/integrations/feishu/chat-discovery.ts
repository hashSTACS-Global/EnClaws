/**
 * Feishu bot chat discovery — list all groups the bot belongs to.
 *
 * API: GET https://open.feishu.cn/open-apis/im/v1/chats?page_size=50
 * Requires scope: im:chat:readonly
 * Results are cached per token for 10 minutes.
 */

import { logWarn } from "../../logger.js";

interface CachedChats {
  chatIds: string[];
  expiresAt: number;
}

const cache = new Map<string, CachedChats>();
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function listFeishuBotChats(
  accessToken: string,
): Promise<string[]> {
  const cached = cache.get(accessToken);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.chatIds;
  }

  const chatIds: string[] = [];
  let pageToken: string | undefined;

  try {
    do {
      const url = new URL("https://open.feishu.cn/open-apis/im/v1/chats");
      url.searchParams.set("page_size", "50");
      if (pageToken) {
        url.searchParams.set("page_token", pageToken);
      }

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        code: number;
        msg?: string;
        data?: {
          items?: Array<{ chat_id: string }>;
          has_more?: boolean;
          page_token?: string;
        };
      };

      if (json.code !== 0) {
        throw new Error(`Feishu API error code=${json.code} msg=${json.msg ?? ""}`);
      }

      for (const item of json.data?.items ?? []) {
        if (item.chat_id) {
          chatIds.push(item.chat_id);
        }
      }

      pageToken = json.data?.has_more ? json.data.page_token : undefined;
    } while (pageToken);
  } catch (e) {
    logWarn(
      `feishu: chat discovery failed: ${e instanceof Error ? e.message : String(e)}`,
    );
    // Return whatever we got so far (may be partial)
    if (chatIds.length === 0) {
      // Return cached if available
      if (cached) return cached.chatIds;
      return [];
    }
  }

  cache.set(accessToken, {
    chatIds,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return chatIds;
}
