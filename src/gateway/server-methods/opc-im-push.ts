/**
 * OPC notification push helpers.
 *
 * Direct calls to Feishu / WeCom REST APIs — no SDK or cross-package import.
 * Used by notification.dispatch to deliver an OPC notification to the boss's
 * IM after writing the audit record.
 *
 * Design note: we deliberately bypass EC's cron-based outbound stack here.
 * That stack is built around full agent turns (LLM invocation per message),
 * which is wasteful for a one-shot text push. Calling REST directly keeps
 * the dispatch path simple and avoids spawning isolated agent sessions just
 * to forward strings.
 */

const FEISHU_TOKEN_URL = "https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal";
const FEISHU_SEND_URL = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id";
const WECOM_WEBHOOK_URL = "https://qyapi.weixin.qq.com/cgi-bin/webhook/send";

/** In-memory cache for Feishu tenant_access_token (key=appId, value={token, expiresAt}). */
const feishuTokenCache = new Map<string, { token: string; expiresAt: number }>();

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    let body: Record<string, unknown> = {};
    try {
      body = (await res.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function getFeishuToken(appId: string, appSecret: string): Promise<string> {
  const cached = feishuTokenCache.get(appId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }
  const { status, body } = await fetchJson(FEISHU_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  if (status !== 200 || body.code !== 0) {
    throw new Error(`feishu token: code=${body.code ?? status} msg=${body.msg ?? "unknown"}`);
  }
  const token = body.tenant_access_token as string;
  const ttlSec = (body.expire as number) ?? 7200;
  feishuTokenCache.set(appId, { token, expiresAt: Date.now() + ttlSec * 1000 });
  return token;
}

/**
 * Push a plain text message to a single Feishu user identified by their open_id.
 * Caller must have captured the boss's open_id from a prior inbound message
 * (e.g. via the OPC notify-agent's first-touch handler).
 */
export async function pushFeishuText(params: {
  appId: string;
  appSecret: string;
  openId: string;
  text: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  try {
    const token = await getFeishuToken(params.appId, params.appSecret);
    const { status, body } = await fetchJson(FEISHU_SEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: params.openId,
        msg_type: "text",
        content: JSON.stringify({ text: params.text }),
      }),
    });
    if (status !== 200 || body.code !== 0) {
      return { ok: false, error: `feishu send: code=${body.code ?? status} msg=${body.msg ?? "unknown"}` };
    }
    const data = body.data as { message_id?: string } | undefined;
    return { ok: true, messageId: data?.message_id };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Push a plain text message to a WeCom group bot. The botId IS the webhook key
 * that work.weixin.qq.com/ai/qc returned during the QR registration. Anyone in
 * the group where the bot was added receives the message.
 */
export async function pushWecomText(params: {
  botId: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const url = `${WECOM_WEBHOOK_URL}?key=${encodeURIComponent(params.botId)}`;
    const { status, body } = await fetchJson(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        msgtype: "text",
        text: { content: params.text },
      }),
    });
    if (status !== 200 || body.errcode !== 0) {
      return { ok: false, error: `wecom send: errcode=${body.errcode ?? status} errmsg=${body.errmsg ?? "unknown"}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Look up the Feishu boss open_id stored on the opc-notify agent's config
 * (captured at first inbound message — see opc-im-inbound.ts).
 *
 * Returns null if not yet captured (boss hasn't said anything to the bot yet).
 * Callers should treat null as "skip Feishu push, file write is enough".
 */
export function readFeishuBossOpenId(agentConfig: Record<string, unknown> | null | undefined): string | null {
  if (!agentConfig) return null;
  const v = agentConfig.bossOpenId;
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
