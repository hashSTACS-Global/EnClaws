/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pre-LLM 用户授权 gate（跨 IM 平台通用）。
 *
 * 触发位置：`src/auto-reply/reply/dispatch-from-config.ts` 在 `enrichTenantContext`
 * 之后调用 `coreAuthGate`。所有 IM 插件（飞书 / 企业微信 / 钉钉 / Slack / ...）
 * 入站消息都会路由到 `dispatchReplyFromConfig`，因此**只在这一处加 hook、所有
 * 平台自动复用**。
 *
 * 工作原理：
 *   1. 检查 ctx.SenderName 是否为空 / 占位符（没拿到名字）
 *   2. 按 ctx.Provider 选注册的 driver；没注册就放行（其他平台不影响）
 *   3. 检查 cooldown（5 分钟）—— 防止同一用户短时间内被反复推送
 *   4. 入队（覆盖式，同一用户只保留最新一条）
 *   5. 异步触发 driver.triggerAuth（发卡片 + 后台轮询 + 完成后写名字到 DB + 重放队列）
 *   6. 返回 skipDispatch=true，dispatch-from-config 早退，**LLM 不跑**
 *
 * Driver 失败时（例如飞书"陌生用户 DM 被拦截"230013）：清除 cooldown 允许下一条
 * 消息重新尝试，但仍然 skipDispatch=true（不让 LLM 跑无名消息）。
 *
 * 添加新平台：在 core 写一个 driver 实现 `AuthGateDriver` 接口，调
 * `registerAuthDriver(driver)`。**不需要改任何插件代码**。
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { FinalizedMsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { enqueuePendingAuth, type QueuedDispatchParams } from "./auth-gate-queue.js";

const log = createSubsystemLogger("auth-gate");

// ---------------------------------------------------------------------------
// Driver registry
// ---------------------------------------------------------------------------

/**
 * 平台特定的"轻量授权"驱动。每个 IM 平台实现一个，挂到 `ctx.Provider` 上。
 *
 * 例如飞书 driver 实现了 device flow + 通过 receive_id_type='open_id' 直接 DM
 * 卡片给陌生用户。企业微信 driver 走自己的 OAuth 流程。两者**互不影响**。
 */
export interface AuthGateDriver {
  /** 唯一 provider 标识，比如 "feishu" / "wecom" / "dingtalk"。匹配 `ctx.Provider`。 */
  provider: string;

  /**
   * 触发授权流程。
   *
   * driver 应当：
   *   1. 用 ctx 里的 senderId 构造授权卡片（仅申请获取用户名所需的最小 scope）
   *   2. 把卡片**私聊**发给用户（飞书是 receive_id_type='open_id'）
   *   3. 异步启动 OAuth 轮询
   *   4. 完成后调用 `onComplete(name)` —— gate 内部会把名字写 DB 并重放队列
   *
   * 返回 `delivered=false` 表示卡片连发都没发出去（用户被拦截 / API 报错），
   * gate 会清除 cooldown 让下一条消息重新尝试。
   */
  triggerAuth(params: {
    ctx: FinalizedMsgContext;
    cfg: OpenClawConfig;
    /** 完成授权拿到名字后由 driver 调用。gate 会持久化 + 重放。 */
    onComplete: (name: string) => Promise<void>;
  }): Promise<{ delivered: boolean; reason?: string }>;
}

const drivers = new Map<string, AuthGateDriver>();

/** Driver 在自己的模块顶层调用一次，把自己注册进来。 */
export function registerAuthDriver(driver: AuthGateDriver): void {
  drivers.set(driver.provider.toLowerCase(), driver);
  log.info(`auth driver registered: ${driver.provider}`);
}

function getDriver(provider: string | undefined): AuthGateDriver | undefined {
  if (!provider) return undefined;
  return drivers.get(provider.toLowerCase());
}

// ---------------------------------------------------------------------------
// Cooldown
// ---------------------------------------------------------------------------

/**
 * 同一用户两次授权尝试之间的冷却时间。设 5 分钟的理由：
 *   - 比飞书 device code 默认有效期（4min）略长，避免成功送达的卡片刚到就被新卡片覆盖
 *   - 短到 admin 给 bot 加了权限后用户能很快感知（至多等 5 分钟）
 *   - 不会触发飞书 IM API 的同对象 rate limit
 */
const COOLDOWN_MS = 5 * 60 * 1000;
const cooldownMap = new Map<string, number>();

function cooldownKey(provider: string, accountId: string, openId: string): string {
  return `${provider}:${accountId}:${openId}`;
}

function isInCooldown(key: string): boolean {
  const expireAt = cooldownMap.get(key);
  if (expireAt === undefined) return false;
  if (expireAt <= Date.now()) {
    cooldownMap.delete(key);
    return false;
  }
  return true;
}

function setCooldown(key: string): void {
  cooldownMap.set(key, Date.now() + COOLDOWN_MS);
}

function clearCooldown(key: string): void {
  cooldownMap.delete(key);
}

// ---------------------------------------------------------------------------
// Helper: 是否已有可读名字
// ---------------------------------------------------------------------------

/**
 * 名字是否还是"未解析"状态。
 *
 * - 空 / undefined → 未解析
 * - 以 `ou_` / `on_` 开头 → 飞书 openId / unionId 占位符（旧路径会写这种）
 *
 * 其他 IM 平台如果有自己的占位符模式，可以扩展这个函数；目前只覆盖飞书。
 */
function isMissingName(name: string | undefined | null): boolean {
  if (!name) return true;
  if (name.startsWith("ou_") || name.startsWith("on_")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Public: gate
// ---------------------------------------------------------------------------

export interface AuthGateResult {
  /** true 时调用方应当 return early，不要进 LLM。 */
  skipDispatch: boolean;
  /** 跳过原因（debugging 用）。 */
  reason?: string;
}

/**
 * 在 dispatch-from-config 里、enrichTenantContext 之后调用。
 *
 * 不阻塞调用方：driver 的真正授权流程（发卡片、轮询 token）都在 setImmediate
 * 异步跑；本函数只决定"是否要 skipDispatch"并立刻返回。
 */
export async function coreAuthGate(params: {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  /** 原 dispatchReplyFromConfig 的 dispatcher（替换重放时复用）。 */
  dispatcher: unknown;
  replyOptions?: unknown;
  replyResolver?: unknown;
}): Promise<AuthGateResult> {
  const { ctx, cfg } = params;

  // 1. 名字已经有了（来自 contact API 命中 / DB 命中 / 之前授权过的 UAT）→ 放行
  if (!isMissingName(ctx.SenderName)) {
    return { skipDispatch: false };
  }

  // 2. 选 driver；没注册 driver 的 provider 直接放行（不影响其他平台）
  const provider = (ctx.Provider ?? ctx.Surface ?? "").toLowerCase();
  const driver = getDriver(provider);
  if (!driver) {
    return { skipDispatch: false, reason: "no-driver" };
  }

  // 3. SenderId 必须有，否则 driver 没法工作
  const senderId = ctx.SenderId;
  if (!senderId) {
    return { skipDispatch: false, reason: "no-sender-id" };
  }

  const accountId = ctx.AccountId ?? "default";
  const key = cooldownKey(provider, accountId, senderId);

  // 4. 入队（无论有没有冷却都要存，这样授权完成后能重放）
  const queueParams: QueuedDispatchParams = {
    ctx,
    cfg,
    dispatcher: params.dispatcher,
    replyOptions: params.replyOptions,
    replyResolver: params.replyResolver,
  };
  enqueuePendingAuth(provider, accountId, senderId, queueParams);

  // 5. 在冷却期 → 不再发卡片，但消息已经入队；用户后续完成授权时仍会被重放
  if (isInCooldown(key)) {
    log.info(`skip dispatch (cooldown) — ${provider}:${senderId}`);
    return { skipDispatch: true, reason: "in-cooldown" };
  }

  // 6. 标记冷却并异步触发 driver
  setCooldown(key);
  setImmediate(async () => {
    try {
      const result = await driver.triggerAuth({
        ctx,
        cfg,
        onComplete: async (name: string) => {
          // ---------- 名字到手，写 DB + 清缓存 + 重放 ----------
          try {
            // 用现有的 user-profiles DB 路径持久化（tenant-enrich.ts 也在用这个）
            const { updateDisplayNameByOpenId } = await import("../db/models/user.js");
            await updateDisplayNameByOpenId(senderId, name);
            log.info(`persisted display name "${name}" for ${provider}:${senderId}`);
          } catch (err) {
            log.warn(`failed to persist display name for ${provider}:${senderId}: ${String(err)}`);
          }
          // 清掉 autoProvision 内存缓存：将来 OTHER 路径再读这个用户时能拿到
          // 最新的 displayName，而不是首次 dispatch 时缓存的 undefined。
          //
          // 注意：本次 replay 不依赖这个清理——我们直接把 name 注入 ctx，
          // 跳过整个 tenant-enrich + autoProvisionTenantUser 的查 DB 路径。
          try {
            const { clearAutoProvisionCache } = await import("./channel-auto-provision.js");
            clearAutoProvisionCache();
          } catch (err) {
            log.warn(`failed to clear auto-provision cache: ${String(err)}`);
          }
          try {
            const { replayPendingAuth } = await import("./auth-gate-queue.js");
            // 把刚拿到的名字传给 replay，让它直接注入 ctx.SenderName；
            // 否则 tenant-enrich 的早退逻辑会让 ctx.SenderName 仍然是空。
            await replayPendingAuth(provider, accountId, senderId, name);
          } catch (err) {
            log.error(`replay failed for ${provider}:${senderId}: ${String(err)}`);
          }
        },
      });

      if (!result.delivered) {
        // 卡片没发出去（API 拦截 / 网络错误）→ 清除冷却，让下一条消息重试
        clearCooldown(key);
        log.warn(
          `auth card not delivered for ${provider}:${senderId}: ${result.reason ?? "unknown"} (cooldown cleared, will retry on next message)`,
        );
      } else {
        log.info(`auth card delivered for ${provider}:${senderId}, awaiting user action`);
      }
    } catch (err) {
      clearCooldown(key);
      log.error(`driver.triggerAuth threw for ${provider}:${senderId}: ${String(err)}`);
    }
  });

  return { skipDispatch: true, reason: "auth-required" };
}
