/**
 * Customer Service Widget RPC handlers.
 *
 * 客服 Widget RPC 处理器。
 *
 * Methods:
 *   cs.widget.connect  — resume existing session (session created lazily on first send)
 *   cs.widget.send     — customer message → RAG → reply
 *   cs.widget.history  — paginated message history
 */

import { randomUUID } from "node:crypto";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers } from "./types.js";
import { createCSSession, findActiveCSSession, updateCSSessionNotifiedAt, getCSSession } from "../../db/models/cs-session.js";
import { createCSMessage, listCSMessages } from "../../db/models/cs-message.js";
import { transition } from "../../customer-service/session-state-machine.js";
import { runCSAgentReply } from "../../customer-service/rag/cs-agent-runner.js";
import { CS_ROLE_LABELS } from "../../customer-service/types.js";
import { sendCSNotification } from "../../customer-service/feishu/notify.js";
import { readCSConfig } from "./cs-admin.js";
import { loadTenantConfig } from "../../config/tenant-config.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import { generateVisitorToken, verifyVisitorToken } from "../../customer-service/widget/widget-auth.js";

const log = createSubsystemLogger("cs-widget-handler");

export const csWidgetHandlers: GatewayRequestHandlers = {
  /**
   * cs.widget.connect — resume existing session if any; do NOT create a new one.
   * Session is created lazily on the visitor's first message (cs.widget.send).
   * This prevents empty session records when a visitor opens the widget but never sends a message.
   *
   * 连接时只恢复已有会话，不主动创建。首次发消息时才建 session，避免空会话记录。
   *
   * Params: { tenantId, visitorId }
   * Response: { sessionId | null, state, messages }
   */
  "cs.widget.connect": async ({ params, respond }) => {
    const tenantId = params.tenantId as string;
    const visitorId = params.visitorId as string;

    if (!tenantId || !visitorId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId and visitorId are required"));
      return;
    }

    try {
      // Only resume — do not create. Creation happens in cs.widget.send.
      // 只恢复，不创建。session 在 cs.widget.send 中按需创建。
      const session = await findActiveCSSession(tenantId, visitorId);
      const messages = session ? await listCSMessages(session.id, { limit: 50 }) : [];

      // Issue a visitor token (HMAC-SHA256 of visitorId) so subsequent requests
      // can be authenticated without the visitor needing to register.
      // Client stores the token in localStorage and sends it with every request.
      // 生成访客 token，后续请求携带以证明身份。客户端存储在 localStorage 中。
      const token = generateVisitorToken(visitorId);

      respond(true, {
        sessionId: session?.id ?? null,
        state: session?.state ?? "ai_active",
        messages,
        token,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`cs.widget.connect failed: ${message}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Failed to connect"));
    }
  },

  /**
   * cs.widget.send — customer sends a message.
   * Creates session lazily on first message.
   * Sends Feishu notification only on the first customer message of the session.
   *
   * 按需建 session；飞书通知只在每个会话的第一条消息时发送一次。
   *
   * Params: { tenantId, visitorId, text }
   * Response: { messageId, role, text, roleLabel }
   */
  "cs.widget.send": async ({ params, respond, context, client }) => {
    const tenantId = params.tenantId as string;
    const visitorId = params.visitorId as string;
    const token = params.token as string | undefined;
    const text = (params.text as string)?.trim();

    if (!tenantId || !visitorId || !text) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "tenantId, visitorId, and text are required"));
      return;
    }

    // Verify visitor token if provided. Reject if token is present but invalid.
    // Missing token is tolerated during the S1→S2 rollout window; remove this
    // tolerance once all clients have been updated.
    // token 存在时必须验证通过；S2 过渡期允许缺失，客户端全量升级后移除此豁免。
    if (token !== undefined && !verifyVisitorToken(visitorId, token)) {
      respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Invalid visitor token"));
      return;
    }

    try {
      // Find or create session lazily.
      // 懒加载：找到已有 session 或按需创建。
      let session = await findActiveCSSession(tenantId, visitorId);
      const isNewSession = !session;
      if (!session) {
        session = await createCSSession({
          tenantId,
          visitorId,
          visitorName: params.visitorName as string | undefined,
          channel: (params.channel as string | undefined) ?? "web_widget",
          metadata: params.metadata as Record<string, unknown> | undefined,
        });
        log.info(`created cs session ${session.id} for visitor ${visitorId}`);
      }

      // Check if this is the first message in the session (for Feishu notify).
      // New sessions always have 0 prior messages; existing sessions may have some.
      // 检查是否为 session 第一条消息，用于飞书通知去重。
      const priorMessages = isNewSession ? [] : await listCSMessages(session.id, { limit: 1 });
      const isFirstMessage = priorMessages.length === 0;

      // Save customer message
      // 保存客户消息
      await createCSMessage({
        sessionId: session.id,
        tenantId,
        role: "customer",
        content: text,
      });

      // State machine transition
      // 状态机转换
      const { action } = transition(session.state, { type: "customer_message", text });

      if (action === "run_rag") {
        // Widget is a visitor connection (no authenticated user), so client.tenant
        // is always undefined. Load tenant config directly by the tenantId sent from
        // the widget — this is the CS operator tenant whose agent/model we must use.
        // Using resolveRequestConfig(client?.tenant) here would fall back to the
        // platform-level config and miss all tenant-configured agents/models,
        // causing the LLM call to fail with "Model Not Exist".
        // Widget 是游客连接（无用户 auth），client.tenant 永远 undefined；必须用
        // params.tenantId 直接加载租户 config（即客服运营方租户的配置），
        // 否则会 fallback 到平台级 config，找不到租户配置的 agent/model，
        // 导致 LLM 调用报 "Model Not Exist"。
        const cfg = await loadTenantConfig(tenantId);
        // Read CS config for skillsEnabled flag (and notify settings used below).
        // 读客服配置获取 skillsEnabled，与飞书通知配置一并加载。
        const csCfg = await readCSConfig(tenantId);

        const connId = client?.connId;
        const streamId = randomUUID();

        if (connId) {
          // Streaming path: ACK immediately, then push partial replies via cs-delta.
          // 流式路径：立即 ACK，通过 cs-delta 推送片段，避免长时间挂起 RPC 请求。
          respond(true, { streamId, sessionId: session.id });

          const THROTTLE_MS = 150;
          let lastBroadcastAt = 0;

          // Fire-and-forget; errors broadcast a done+error frame to the client.
          // 后台异步执行，错误通过 cs-delta done+error 帧通知客户端。
          (async () => {
            const { reply, sourceChunks, confidence, clarifyOptions, isFallback } =
              await runCSAgentReply({
                tenantId,
                sessionId: session.id,
                customerMessage: text,
                visitorName: session.visitorName ?? undefined,
                cfg,
                restrictions: csCfg.restrictions,
                customSystemPrompt: csCfg.customSystemPrompt,
                confidencePreset: csCfg.confidencePreset,
                onPartialReply: ({ text: chunk }) => {
                  if (!chunk) return;
                  const now = Date.now();
                  if (now - lastBroadcastAt < THROTTLE_MS) return;
                  lastBroadcastAt = now;
                  context.broadcastToConnIds(
                    "cs-delta",
                    { streamId, text: chunk, done: false },
                    new Set([connId]),
                  );
                },
              });

            // Save AI reply after streaming completes.
            // 流式结束后保存 AI 回复，含置信度与 source chunks。
            const aiMessage = await createCSMessage({
              sessionId: session.id,
              tenantId,
              role: "ai",
              content: reply,
              confidence,
              sourceChunks,
            });

            // Send final frame with full text + message metadata + clarify options.
            // 推送最终帧，包含完整文本、消息元数据和澄清选项（若有）。
            context.broadcastToConnIds(
              "cs-delta",
              {
                streamId,
                text: reply,
                done: true,
                messageId: aiMessage.id,
                roleLabel: CS_ROLE_LABELS.ai,
                clarifyOptions,
                isFallback,
              },
              new Set([connId]),
            );

            // Feishu notify (same throttle logic as non-streaming path).
            // 飞书通知，与非流式路径相同的限频逻辑。
            const { appId, appSecret, chatId } = csCfg.feishu ?? {};
            if (appId && appSecret && chatId) {
              const intervalMs = (csCfg.notifyIntervalMinutes ?? 10) * 60 * 1000;
              const lastNotifiedAt = session!.metadata?.lastNotifiedAt as string | undefined;
              const lastNotifiedMs = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : 0;
              if (Date.now() - lastNotifiedMs >= intervalMs) {
                await updateCSSessionNotifiedAt(session!.id, new Date().toISOString());
                await sendCSNotification({
                  appId, appSecret, chatId,
                  customerMessage: text,
                  aiReply: reply,
                  sessionId: session!.id,
                  visitorName: session!.visitorName ?? undefined,
                  channel: session!.channel,
                });
              }
            }
          })().catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`cs streaming failed: ${errMsg}`);
            context.broadcastToConnIds(
              "cs-delta",
              { streamId, done: true, error: true },
              new Set([connId]),
            );
          });
        } else {
          // Synchronous fallback when connId is unavailable (non-WS client).
          // 无 connId 时回退为同步模式（非 WebSocket 客户端）。
          const { reply, sourceChunks, confidence, clarifyOptions, isFallback } =
            await runCSAgentReply({
              tenantId,
              sessionId: session.id,
              customerMessage: text,
              visitorName: session.visitorName ?? undefined,
              cfg,
              restrictions: csCfg.restrictions,
              customSystemPrompt: csCfg.customSystemPrompt,
              confidencePreset: csCfg.confidencePreset,
            });

          const aiMessage = await createCSMessage({
            sessionId: session.id,
            tenantId,
            role: "ai",
            content: reply,
            confidence,
            sourceChunks,
          });

          // Feishu notify
          Promise.resolve().then(async () => {
            const { appId, appSecret, chatId } = csCfg.feishu ?? {};
            if (!appId || !appSecret || !chatId) return;
            const intervalMs = (csCfg.notifyIntervalMinutes ?? 10) * 60 * 1000;
            const lastNotifiedAt = session!.metadata?.lastNotifiedAt as string | undefined;
            const lastNotifiedMs = lastNotifiedAt ? new Date(lastNotifiedAt).getTime() : 0;
            if (Date.now() - lastNotifiedMs < intervalMs) return;
            await updateCSSessionNotifiedAt(session!.id, new Date().toISOString());
            return sendCSNotification({
              appId, appSecret, chatId,
              customerMessage: text,
              aiReply: reply,
              sessionId: session!.id,
              visitorName: session!.visitorName ?? undefined,
              channel: session!.channel,
            });
          }).catch((err) => {
            const errMsg = err instanceof Error ? err.message : String(err);
            log.error(`feishu notification failed: ${errMsg}`);
          });

          respond(true, {
            sessionId: session.id,
            messageId: aiMessage.id,
            role: "ai",
            text: reply,
            roleLabel: CS_ROLE_LABELS.ai,
            clarifyOptions,
            isFallback,
          });
        }
      } else if (action === "forward_to_boss") {
        // S3: forward to boss
        respond(true, { forwarded: true });
      } else {
        respond(true, { action });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`cs.widget.send failed: ${message}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Failed to process message"));
    }
  },

  /**
   * cs.widget.history — paginated message history.
   * Requires visitorId + token to prevent cross-visitor session reads.
   *
   * Params: { sessionId, visitorId, token?, limit?, beforeId? }
   * Response: { messages }
   */
  "cs.widget.history": async ({ params, respond }) => {
    const sessionId = params.sessionId as string;
    const visitorId = params.visitorId as string;
    const token = params.token as string | undefined;

    if (!sessionId || !visitorId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "sessionId and visitorId are required"));
      return;
    }

    // Token verification — same tolerance policy as cs.widget.send.
    // token 验证，与 send 保持相同的过渡期豁免策略。
    if (token !== undefined && !verifyVisitorToken(visitorId, token)) {
      respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Invalid visitor token"));
      return;
    }

    try {
      // Session ownership check: confirm this session belongs to the requesting visitor.
      // Prevents a visitor who knows a sessionId from reading another visitor's history.
      // 归属校验：确认 session 属于请求方访客，防止跨访客越权读取。
      const session = await getCSSession(sessionId);
      if (!session || session.visitorId !== visitorId) {
        // Return the same error for "not found" and "wrong visitor" to avoid
        // leaking whether a session ID exists.
        // 不区分"不存在"和"不属于你"，避免枚举探测。
        respond(false, undefined, errorShape(ErrorCodes.UNAUTHORIZED, "Session not accessible"));
        return;
      }

      const messages = await listCSMessages(sessionId, {
        limit: (params.limit as number) ?? 50,
        beforeId: params.beforeId as string | undefined,
      });
      respond(true, { messages });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`cs.widget.history failed: ${message}`);
      respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, "Failed to load history"));
    }
  },
};
