/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * 飞书"轻量授权" driver —— core 端实现，不依赖任何插件代码。
 *
 * 流程（被 `auth-gate.ts::coreAuthGate` 调用）：
 *   1. 用 OAuth Device Authorization Grant (RFC 8628) 申请最小 scope
 *      `offline_access`，拿到一个 device code + verification URL
 *   2. 把含 verification URL 的 interactive 卡片**通过 receive_id_type='open_id'
 *      DM 给用户**——飞书会自动定位到 bot↔user 的 p2p 会话（陌生用户会被
 *      230013 拦截，driver 返回 delivered=false 让 gate 清 cooldown 重试）
 *   3. 异步轮询 token endpoint 直到用户授权成功 / 拒绝 / 过期
 *   4. 拿到 UAT 后调 `/open-apis/authen/v1/user_info` 获取用户名（这个 endpoint
 *      不需要任何额外业务 scope，UAT 有效就能返回 name / en_name）
 *   5. 调 gate 给的 `onComplete(name)` —— gate 会写 DB + 重放暂存的入站消息
 *
 * 与插件 `extensions/openclaw-lark/src/tools/oauth.ts::executeAuthorize` 的区别：
 *   - 完全 fetch-based，不依赖 Lark SDK（保持 core 与插件解耦）
 *   - **不存 token**，拿到名字写完 DB 就丢弃（够用了，刷新场景极少）
 *   - 不复用插件的 cardkit（少一些卡片更新动效，换来零插件依赖）
 *   - 不做 owner 检查（任意用户可为自己授权，本来就是用户自己授权自己）
 *
 * 注册：模块顶层调用 `registerAuthDriver(feishuLiteAuthDriver)`，由
 * `auth-gate-bootstrap.ts` 在 boot 时 import 一下即可触发注册。
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { AuthGateDriver } from "./auth-gate.js";
import { registerAuthDriver } from "./auth-gate.js";
import { extractFeishuCredentials, getTenantAccessToken } from "./feishu-user-resolve.js";

const log = createSubsystemLogger("feishu-lite-auth");

const LITE_SCOPE = "offline_access";

// ---------------------------------------------------------------------------
// Lark/Feishu OAuth endpoints (国内版默认；lark 国际版 TODO)
// ---------------------------------------------------------------------------

const DEVICE_AUTH_URL = "https://accounts.feishu.cn/oauth/v1/device_authorization";
const TOKEN_URL = "https://open.feishu.cn/open-apis/authen/v2/oauth/token";
const USER_INFO_URL = "https://open.feishu.cn/open-apis/authen/v1/user_info";
const IM_MESSAGE_CREATE_URL = "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=open_id";

// ---------------------------------------------------------------------------
// Step 1: device authorization request
// ---------------------------------------------------------------------------

interface DeviceAuthResponse {
  deviceCode: string;
  verificationUriComplete: string;
  expiresIn: number; // seconds
  interval: number; // seconds
}

async function requestDeviceAuthorization(
  appId: string,
  appSecret: string,
): Promise<DeviceAuthResponse | null> {
  try {
    const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString("base64");
    const body = new URLSearchParams();
    body.set("client_id", appId);
    body.set("scope", LITE_SCOPE);

    const res = await fetch(DEVICE_AUTH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${basicAuth}`,
      },
      body: body.toString(),
    });

    const text = await res.text();
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      log.warn(`device authorization response not JSON: status=${res.status} body=${text.slice(0, 200)}`);
      return null;
    }

    if (!res.ok || data.error) {
      log.warn(`device authorization failed: ${data.error_description ?? data.error ?? "unknown"}`);
      return null;
    }

    return {
      deviceCode: data.device_code as string,
      verificationUriComplete:
        (data.verification_uri_complete as string) ?? (data.verification_uri as string),
      expiresIn: (data.expires_in as number) ?? 240,
      interval: (data.interval as number) ?? 5,
    };
  } catch (err) {
    log.warn(`requestDeviceAuthorization fetch failed: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 2: poll token endpoint
// ---------------------------------------------------------------------------

interface PolledToken {
  accessToken: string;
  expiresIn: number;
  scope: string;
}

async function pollDeviceToken(
  appId: string,
  appSecret: string,
  deviceCode: string,
  interval: number,
  expiresIn: number,
): Promise<PolledToken | null> {
  const deadline = Date.now() + expiresIn * 1000;
  let currentInterval = Math.max(1, interval);

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, currentInterval * 1000));

    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: appId,
          client_secret: appSecret,
        }).toString(),
      });
      const data = (await res.json()) as Record<string, unknown>;

      if (!data.error && data.access_token) {
        return {
          accessToken: data.access_token as string,
          expiresIn: (data.expires_in as number) ?? 7200,
          scope: (data.scope as string) ?? "",
        };
      }

      const error = data.error as string | undefined;
      if (error === "authorization_pending") {
        continue;
      }
      if (error === "slow_down") {
        currentInterval = Math.min(currentInterval + 5, 60);
        continue;
      }
      if (error === "access_denied" || error === "expired_token" || error === "invalid_grant") {
        log.info(`device flow ended: ${error}`);
        return null;
      }
      log.warn(`unexpected token poll error: ${error ?? JSON.stringify(data).slice(0, 200)}`);
      return null;
    } catch (err) {
      log.warn(`token poll fetch failed: ${String(err)}`);
      // 网络抖动，下一轮继续
    }
  }
  log.info(`device flow timed out after ${expiresIn}s`);
  return null;
}

// ---------------------------------------------------------------------------
// Step 3: fetch user_info to get the display name
// ---------------------------------------------------------------------------

async function fetchUserName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(USER_INFO_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const data = (await res.json()) as {
      code?: number;
      data?: { name?: string; en_name?: string };
    };
    if (data.code !== 0) {
      log.warn(`/authen/v1/user_info returned code=${data.code}`);
      return null;
    }
    return data.data?.name || data.data?.en_name || null;
  } catch (err) {
    log.warn(`fetchUserName failed: ${String(err)}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Step 4: build interactive auth card and send via DM
// ---------------------------------------------------------------------------

function buildLiteAuthCard(verificationUrl: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "请授权以继续" },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: "我需要获取你的基本资料（如昵称、头像）。授权范围最小，可随时撤销。",
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "前往授权" },
            type: "primary",
            multi_url: {
              url: verificationUrl,
              pc_url: verificationUrl,
              android_url: verificationUrl,
              ios_url: verificationUrl,
            },
          },
        ],
      },
    ],
  };
}

async function sendInteractiveDm(
  tenantToken: string,
  receiverOpenId: string,
  card: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string; messageId?: string }> {
  try {
    const res = await fetch(IM_MESSAGE_CREATE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({
        receive_id: receiverOpenId,
        msg_type: "interactive",
        content: JSON.stringify(card),
      }),
    });
    const data = (await res.json()) as { code?: number; msg?: string; data?: { message_id?: string } };
    if (data.code !== 0) {
      return { ok: false, reason: `feishu code=${data.code} msg=${data.msg ?? ""}` };
    }
    return { ok: true, messageId: data.data?.message_id };
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Step 5: build "授权完成" success card and patch the original DM card in place
// ---------------------------------------------------------------------------

/**
 * 构造授权成功后用于替换原卡片的"完成"卡片。
 * 不带按钮，避免用户再次点击早已失效的 OAuth 链接。
 */
function buildLiteAuthSuccessCard(name: string): Record<string, unknown> {
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: "✅ 授权完成" },
      template: "green",
    },
    elements: [
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `你好 **${name}**，已成功获取你的基本资料～现在可以正常对话了。`,
        },
      },
      {
        tag: "note",
        elements: [
          {
            tag: "plain_text",
            content: "如需撤销授权，可随时告诉我。",
          },
        ],
      },
    ],
  };
}

/**
 * 用 `PATCH /open-apis/im/v1/messages/{message_id}` 把已经发出去的卡片内容替换掉。
 * 飞书要求 PATCH 请求 body 是 `{ content: "<json string>" }`，content 是新卡片的
 * JSON 字符串。
 */
async function patchInteractiveCard(
  tenantToken: string,
  messageId: string,
  newCard: Record<string, unknown>,
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(`https://open.feishu.cn/open-apis/im/v1/messages/${messageId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tenantToken}`,
      },
      body: JSON.stringify({
        content: JSON.stringify(newCard),
      }),
    });
    const data = (await res.json()) as { code?: number; msg?: string };
    if (data.code !== 0) {
      return { ok: false, reason: `feishu code=${data.code} msg=${data.msg ?? ""}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${String(err)}` };
  }
}

// ---------------------------------------------------------------------------
// Driver implementation
// ---------------------------------------------------------------------------

export const feishuLiteAuthDriver: AuthGateDriver = {
  provider: "feishu",

  async triggerAuth(params) {
    const { ctx, cfg, onComplete } = params;
    const senderId = ctx.SenderId;
    if (!senderId) {
      return { delivered: false, reason: "no-sender-id" };
    }

    // 1. 找出对应 account 的 appId / appSecret
    const accountId = (ctx as Record<string, unknown>).AccountId as string | undefined;
    const creds = extractFeishuCredentials(cfg as unknown as Record<string, unknown>, "feishu", accountId);
    if (!creds) {
      return { delivered: false, reason: "no-credentials" };
    }

    // 2. 拿 tenant access token（用来调 IM 发卡片）
    const tenantToken = await getTenantAccessToken(creds.appId, creds.appSecret);
    if (!tenantToken) {
      return { delivered: false, reason: "tenant-token-failed" };
    }

    // 3. 申请 device authorization
    const deviceAuth = await requestDeviceAuthorization(creds.appId, creds.appSecret);
    if (!deviceAuth) {
      return { delivered: false, reason: "device-auth-failed" };
    }

    // 4. 构造卡片 + DM 给用户
    const card = buildLiteAuthCard(deviceAuth.verificationUriComplete);
    const sendResult = await sendInteractiveDm(tenantToken, senderId, card);
    if (!sendResult.ok) {
      log.warn(`DM send failed for ${senderId}: ${sendResult.reason}`);
      return { delivered: false, reason: sendResult.reason };
    }
    // 记录原卡片的 message_id，用于授权完成后 PATCH 替换为"授权完成"卡片
    const originalCardMessageId = sendResult.messageId;
    log.info(
      `lite-auth DM delivered to ${senderId} (message_id=${originalCardMessageId ?? "unknown"}), polling device flow in background`,
    );

    // 5. 后台轮询 token；拿到名字后回调 onComplete（gate 会写 DB + 重放）
    setImmediate(async () => {
      const token = await pollDeviceToken(
        creds.appId,
        creds.appSecret,
        deviceAuth.deviceCode,
        deviceAuth.interval,
        deviceAuth.expiresIn,
      );
      if (!token) {
        return;
      }
      const name = await fetchUserName(token.accessToken);
      if (!name) {
        log.warn(`got UAT for ${senderId} but /authen/v1/user_info returned no name`);
        return;
      }
      log.info(`lite-auth complete: ${senderId} → "${name}"`);

      // 5a. 把原 DM 卡片 PATCH 成"授权完成"卡片，避免按钮一直显示"前往授权"
      //     需要先刷新 tenant token（前面那个 token 可能已经过期，特别是用户拖了很久才点）
      if (originalCardMessageId) {
        try {
          const freshTenantToken = await getTenantAccessToken(creds.appId, creds.appSecret);
          if (freshTenantToken) {
            const successCard = buildLiteAuthSuccessCard(name);
            const patchResult = await patchInteractiveCard(freshTenantToken, originalCardMessageId, successCard);
            if (patchResult.ok) {
              log.info(`lite-auth card patched to "授权完成" for ${senderId}`);
            } else {
              log.warn(`failed to patch lite-auth card for ${senderId}: ${patchResult.reason}`);
            }
          }
        } catch (err) {
          log.warn(`patch lite-auth card threw for ${senderId}: ${String(err)}`);
        }
      }

      // 5b. 触发 gate 的 onComplete（写 DB + replay 之前暂存的消息）
      try {
        await onComplete(name);
      } catch (err) {
        log.error(`onComplete callback threw for ${senderId}: ${String(err)}`);
      }
    });

    return { delivered: true };
  },
};

// 模块加载时自动注册
registerAuthDriver(feishuLiteAuthDriver);
