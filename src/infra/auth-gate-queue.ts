/**
 * Copyright (c) 2026 ByteDance Ltd. and/or its affiliates
 * SPDX-License-Identifier: MIT
 *
 * Pre-LLM auth gate 的待重放队列。
 *
 * 当某个用户因为没授权被 gate 拦下时，他刚发的那条入站消息会被存进这个队列。
 * 等他完成授权（驱动 driver 拿到名字写进 DB 之后），队列会把这条消息按原参数
 * 重新喂给 `dispatchReplyFromConfig`——这次 enrichTenantContext 会从 DB 读到名字、
 * gate 不再触发、LLM 正常处理。
 *
 * 设计要点：
 *   - **覆盖式**：每个用户只保留最后一条消息（用户授权期间连发多条，授权完
 *     成后只回复最近一条，避免被翻旧账刷屏）
 *   - **跨 IM 平台通用**：key 用 `${provider}:${accountId}:${openId}`，所以飞书
 *     和未来的企业微信、钉钉等共用同一份队列，互不干扰
 *   - **30 分钟 TTL**：device flow 一般 4 分钟过期，30 分钟兜底所有重试场景
 *   - **重放时精确删 dedupe entry**：原 MessageSid 已经在 `inboundDedupeCache` 里，
 *     不删的话二次 dispatch 会被 `shouldSkipDuplicateInbound` 拦截。我们调用
 *     `deleteInboundDedupeEntry(ctx)` 只删这一条 key，不影响其他用户。
 *     **不要改 ctx.MessageSid**——会破坏 tenant-enrich 里 messageId fallback 的 chatId 反查。
 *   - **避免循环依赖**：通过动态 import 拿 `dispatchReplyFromConfig`
 */

import { createSubsystemLogger } from "../logging/subsystem.js";
import type { FinalizedMsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

const log = createSubsystemLogger("auth-gate-queue");

const PENDING_TTL_MS = 30 * 60 * 1000;

/**
 * 重放所需的全部参数。这就是 `dispatchReplyFromConfig` 的入参，**原样存原样取**。
 * 用 `unknown` 类型描述 dispatcher / replyOptions / replyResolver 是为了避免本
 * 模块对 `auto-reply/reply` 子树产生编译期循环依赖（实际类型由 dynamic import
 * 在 replay 时拿到）。
 */
export interface QueuedDispatchParams {
  ctx: FinalizedMsgContext;
  cfg: OpenClawConfig;
  dispatcher: unknown;
  replyOptions?: unknown;
  replyResolver?: unknown;
}

interface Entry {
  params: QueuedDispatchParams;
  expiresAt: number;
}

/** Key: `${provider}:${accountId}:${openId}`。每个用户只保留 1 条。 */
const queue = new Map<string, Entry>();

function makeKey(provider: string, accountId: string, openId: string): string {
  return `${provider}:${accountId}:${openId}`;
}

/**
 * 入队（覆盖式）：同一用户的新消息直接替换之前那条。
 */
export function enqueuePendingAuth(
  provider: string,
  accountId: string,
  openId: string,
  params: QueuedDispatchParams,
): void {
  const key = makeKey(provider, accountId, openId);
  const existed = queue.has(key);
  queue.set(key, { params, expiresAt: Date.now() + PENDING_TTL_MS });
  if (existed) {
    log.info(`replaced queued message for ${provider}:${openId} (only the latest is kept)`);
  } else {
    log.info(`queued message for replay after lite-auth, provider=${provider} user=${openId}`);
  }
}

/**
 * 取出并重放某用户暂存的最后一条消息。
 *
 * 由 driver 在授权完成（名字已写入 DB）后调用。**直接把刚拿到的名字注入
 * ctx.SenderName**，跳过 tenant-enrich 那套早退逻辑：
 *   - tenant-enrich Branch A 要求 `!ctx.TenantUserRole`，但首次 dispatch 已经
 *     设过 TenantUserRole，Branch A 不会重跑 DB lookup
 *   - tenant-enrich Branch B 要求 `!ctx.TenantId`，同理早退
 *   - 如果不预先注入名字，replay 走完 tenant-enrich 名字仍然是空，gate 又触发
 *
 * 注入名字后：tenant-enrich 看到 SenderName 已填，不再调 resolveFeishuSenderName；
 * gate 看到 SenderName 已填，不再触发；dispatch 正常进 LLM。
 */
export async function replayPendingAuth(
  provider: string,
  accountId: string,
  openId: string,
  resolvedName?: string,
): Promise<void> {
  const key = makeKey(provider, accountId, openId);
  const entry = queue.get(key);
  queue.delete(key);

  if (!entry) {
    return;
  }
  if (entry.expiresAt <= Date.now()) {
    log.warn(`pending message for ${provider}:${openId} expired before replay, dropping`);
    return;
  }

  // 直接注入名字到 ctx —— 绕开 tenant-enrich 的早退逻辑
  if (resolvedName) {
    const ctx = entry.params.ctx as FinalizedMsgContext & { SenderName?: string };
    ctx.SenderName = resolvedName;
    log.info(`injected resolved name "${resolvedName}" into ctx for ${provider}:${openId}`);
  }

  log.info(`replaying latest pending message for ${provider}:${openId}`);

  try {
    // 删掉这条消息之前留在 dedupe 里的 entry，否则 shouldSkipDuplicateInbound
    // 会以为是重复消息直接 skip。仅删这一条 key，不影响其他用户。
    const { deleteInboundDedupeEntry } = await import("../auto-reply/reply/inbound-dedupe.js");
    deleteInboundDedupeEntry(entry.params.ctx);

    // 动态 import 避免循环依赖（auth-gate-queue ↔ dispatch-from-config）
    const mod = await import("../auto-reply/reply/dispatch-from-config.js");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (mod.dispatchReplyFromConfig as any)({
      ctx: entry.params.ctx,
      cfg: entry.params.cfg,
      dispatcher: entry.params.dispatcher,
      replyOptions: entry.params.replyOptions,
      replyResolver: entry.params.replyResolver,
    });

    // 关键：把 dispatcher 推进到完全收尾状态，触发 streaming card 转 complete
    // 以及 typing emoji 移除。
    //
    // 背景：plugin 的 reply-dispatcher.ts 用一个 streaming card 控制器（StreamingCardController）
    // 管理"思考中..."卡片的状态机；卡片从 thinking → streaming → complete 的最后一跳
    // 由 dispatcher 的 `onIdle` 触发，进而调 `controller.onIdle()` 完成 finalizeCard。
    //
    // dispatcher 的 onIdle 何时触发？通过两条路径：
    //   1. enqueue 的 `.finally()` 检测到 pending===0
    //   2. 调用方手动调 `markDispatchIdle()` 强制驱动
    //
    // Plugin 自己的 dispatch.ts 走第 2 条（在 dispatchReplyFromConfig 之后手动调
    // markFullyComplete + markDispatchIdle），但 markDispatchIdle 是 plugin 包装的方法，
    // 不在 core ReplyDispatcher 接口里，我从 core 拿不到。
    //
    // 解决：调 `dispatcher.markComplete()`——这是 core 接口提供的方法。它会：
    //   - 标记 completeCalled=true
    //   - 调度一个微任务，把 pending 从 reservation=1 减到 0
    //   - pending===0 → 触发 dispatcher 内部 onIdle
    //   - 内部 onIdle → 调 typingController.markDispatchIdle()（清理 typing emoji）
    //                → 调 plugin 的 resolvedOnIdle wrapper
    //                → wrapper 检查 dispatchFullyComplete（已经在第一次 dispatch
    //                  被 plugin 设为 true）→ 调 controller.onIdle()
    //                → controller.onIdle() 把 streaming card 转到 complete 状态
    //
    // 注意：plugin 在它自己的正常路径里**不会**调 dispatcher.markComplete()，所以 replay
    // 调一次不会和 plugin 的逻辑冲突；markComplete 内部有 idempotent guard
    // (`if (completeCalled) return;`)，多调也无害。
    const dispatcher = entry.params.dispatcher as
      | {
          waitForIdle?: () => Promise<void>;
          markComplete?: () => void;
        }
      | undefined;

    if (dispatcher && typeof dispatcher.waitForIdle === "function") {
      try {
        await dispatcher.waitForIdle();
      } catch (err) {
        log.warn(`waitForIdle failed for ${provider}:${openId}: ${String(err)}`);
      }
    }

    if (dispatcher && typeof dispatcher.markComplete === "function") {
      try {
        dispatcher.markComplete();
        // markComplete 调度的是微任务。等几次 microtask tick + 再 await 一次 waitForIdle，
        // 让 onIdle 链路有机会跑起来（包括 plugin 异步 finalizeCard 的初始几步）。
        await Promise.resolve();
        await Promise.resolve();
        if (typeof dispatcher.waitForIdle === "function") {
          await dispatcher.waitForIdle();
        }
      } catch (err) {
        log.warn(`markComplete failed for ${provider}:${openId}: ${String(err)}`);
      }
    }

    log.info(`replay completed for ${provider}:${openId}`);
  } catch (err) {
    log.error(`replay failed for ${provider}:${openId}: ${String(err)}`);
  }
}

/** 清空所有队列（teardown 用）。 */
export function clearPendingAuth(): void {
  queue.clear();
}
