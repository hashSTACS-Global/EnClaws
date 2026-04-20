import { runSubagentAnnounceFlow } from "../../agents/subagent-announce.js";
import { callGateway } from "../../gateway/call.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("cron/delivery-dispatch");
import { countActiveDescendantRuns } from "../../agents/subagent-registry.js";
import { SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import type { ReplyPayload } from "../../auto-reply/types.js";
import { createOutboundSendDeps, type CliDeps } from "../../cli/outbound-send-deps.js";
import type { OpenClawConfig } from "../../config/config.js";
import { resolveAgentMainSessionKey } from "../../config/sessions.js";
import { deliverOutboundPayloads } from "../../infra/outbound/deliver.js";
import { resolveAgentOutboundIdentity } from "../../infra/outbound/identity.js";
import { resolveOutboundSessionRoute } from "../../infra/outbound/outbound-session.js";
import { buildOutboundSessionContext } from "../../infra/outbound/session-context.js";
import type { CronJob, CronRunTelemetry } from "../types.js";
import type { DeliveryTargetResolution } from "./delivery-target.js";
import { pickSummaryFromOutput } from "./helpers.js";
import type { RunCronAgentTurnResult } from "./run.js";
import {
  expectsSubagentFollowup,
  isLikelyInterimCronMessage,
  readDescendantSubagentFallbackReply,
  waitForDescendantSubagentSummary,
} from "./subagent-followup.js";

export function matchesMessagingToolDeliveryTarget(
  target: { provider?: string; to?: string; accountId?: string },
  delivery: { channel?: string; to?: string; accountId?: string },
): boolean {
  if (!delivery.channel || !delivery.to || !target.to) {
    return false;
  }
  const channel = delivery.channel.trim().toLowerCase();
  const provider = target.provider?.trim().toLowerCase();
  if (provider && provider !== "message" && provider !== channel) {
    return false;
  }
  if (target.accountId && delivery.accountId && target.accountId !== delivery.accountId) {
    return false;
  }
  return target.to === delivery.to;
}

export function resolveCronDeliveryBestEffort(job: CronJob): boolean {
  if (typeof job.delivery?.bestEffort === "boolean") {
    return job.delivery.bestEffort;
  }
  if (job.payload.kind === "agentTurn" && typeof job.payload.bestEffortDeliver === "boolean") {
    return job.payload.bestEffortDeliver;
  }
  return false;
}

async function resolveCronAnnounceSessionKey(params: {
  cfg: OpenClawConfig;
  agentId: string;
  fallbackSessionKey: string;
  delivery: {
    channel: NonNullable<DeliveryTargetResolution["channel"]>;
    to?: string;
    accountId?: string;
    threadId?: string | number;
  };
}): Promise<string> {
  const to = params.delivery.to?.trim();
  if (!to) {
    return params.fallbackSessionKey;
  }
  try {
    const route = await resolveOutboundSessionRoute({
      cfg: params.cfg,
      channel: params.delivery.channel,
      agentId: params.agentId,
      accountId: params.delivery.accountId,
      target: to,
      threadId: params.delivery.threadId,
    });
    const resolved = route?.sessionKey?.trim();
    if (resolved) {
      return resolved;
    }
  } catch {
    // Fall back to main session routing if announce session resolution fails.
  }
  return params.fallbackSessionKey;
}

export type SuccessfulDeliveryTarget = Extract<DeliveryTargetResolution, { ok: true }>;

type DispatchCronDeliveryParams = {
  cfg: OpenClawConfig;
  cfgWithAgentDefaults: OpenClawConfig;
  deps: CliDeps;
  job: CronJob;
  agentId: string;
  agentSessionKey: string;
  runSessionId: string;
  runStartedAt: number;
  runEndedAt: number;
  timeoutMs: number;
  resolvedDelivery: DeliveryTargetResolution;
  deliveryRequested: boolean;
  skipHeartbeatDelivery: boolean;
  skipMessagingToolDelivery: boolean;
  deliveryBestEffort: boolean;
  deliveryPayloadHasStructuredContent: boolean;
  deliveryPayloads: ReplyPayload[];
  synthesizedText?: string;
  summary?: string;
  outputText?: string;
  telemetry?: CronRunTelemetry;
  abortSignal?: AbortSignal;
  isAborted: () => boolean;
  abortReason: () => string;
  withRunSession: (
    result: Omit<RunCronAgentTurnResult, "sessionId" | "sessionKey">,
  ) => RunCronAgentTurnResult;
  /** Multi-tenant context for tenant-scoped session key resolution. */
  tenantId?: string;
  userId?: string;
  /** Override the announce session key for multi-tenant webchat delivery. */
  tenantAnnounceSessionKey?: string;
};

export type DispatchCronDeliveryState = {
  result?: RunCronAgentTurnResult;
  delivered: boolean;
  deliveryAttempted: boolean;
  summary?: string;
  outputText?: string;
  synthesizedText?: string;
  deliveryPayloads: ReplyPayload[];
};

export async function dispatchCronDelivery(
  params: DispatchCronDeliveryParams,
): Promise<DispatchCronDeliveryState> {
  let summary = params.summary;
  let outputText = params.outputText;
  let synthesizedText = params.synthesizedText;
  let deliveryPayloads = params.deliveryPayloads;

  // Strip leading NO_REPLY prefix when followed by substantive content.
  // Some models incorrectly prepend NO_REPLY before their actual output
  // (e.g. "NO_REPLY\n\nHere is the summary..."). When this happens the
  // exact-match SILENT_REPLY_TOKEN check below won't suppress delivery, and
  // the NO_REPLY prefix leaks into the delivered message.  Strip it so the
  // user sees only the real content.
  if (synthesizedText) {
    const noReplyPrefixMatch = synthesizedText.match(
      new RegExp(`^\\s*${SILENT_REPLY_TOKEN}\\s*\\n+(.+)`, "is"),
    );
    if (noReplyPrefixMatch) {
      const remainder = noReplyPrefixMatch[1].trim();
      if (remainder) {
        synthesizedText = remainder;
        if (deliveryPayloads.length > 0) {
          deliveryPayloads = deliveryPayloads.map((p) =>
            p.text
              ? {
                  ...p,
                  text:
                    p.text
                      .replace(new RegExp(`^\\s*${SILENT_REPLY_TOKEN}\\s*\\n+`, "i"), "")
                      .trim() || p.text,
                }
              : p,
          );
        }
      }
    }
  }

  // `true` means we confirmed at least one outbound send reached the target.
  // Keep this strict so timer fallback can safely decide whether to wake main.
  let delivered = params.skipMessagingToolDelivery;
  let deliveryAttempted = params.skipMessagingToolDelivery;
  const failDeliveryTarget = (error: string) =>
    params.withRunSession({
      status: "error",
      error,
      errorKind: "delivery-target",
      summary,
      outputText,
      deliveryAttempted,
      ...params.telemetry,
    });

  const deliverViaDirect = async (
    delivery: SuccessfulDeliveryTarget,
  ): Promise<RunCronAgentTurnResult | null> => {
    const identity = resolveAgentOutboundIdentity(params.cfgWithAgentDefaults, params.agentId);
    try {
      const payloadsForDelivery =
        deliveryPayloads.length > 0
          ? deliveryPayloads
          : synthesizedText
            ? [{ text: synthesizedText }]
            : [];
      if (payloadsForDelivery.length === 0) {
        return null;
      }
      if (params.isAborted()) {
        return params.withRunSession({
          status: "error",
          error: params.abortReason(),
          deliveryAttempted,
          ...params.telemetry,
        });
      }
      deliveryAttempted = true;
      const deliverySession = buildOutboundSessionContext({
        cfg: params.cfgWithAgentDefaults,
        agentId: params.agentId,
        sessionKey: params.agentSessionKey,
      });
      const hasCfgChannelCreds = !!(
        params.cfgWithAgentDefaults.channels as Record<string, Record<string, unknown>> | undefined
      )?.feishu?.appId;
      log.info(
        `[cron-delivery] deliverViaDirect: channel=${delivery.channel} to=${delivery.to} accountId=${delivery.accountId ?? "(none)"} hasCfgChannelCreds=${hasCfgChannelCreds} bestEffort=${params.deliveryBestEffort}`,
      );
      const deliveryResults = await deliverOutboundPayloads({
        cfg: params.cfgWithAgentDefaults,
        channel: delivery.channel,
        to: delivery.to,
        accountId: delivery.accountId,
        threadId: delivery.threadId,
        payloads: payloadsForDelivery,
        session: deliverySession,
        identity,
        bestEffort: params.deliveryBestEffort,
        deps: createOutboundSendDeps(params.deps),
        abortSignal: params.abortSignal,
      });
      delivered = deliveryResults.length > 0;
      log.info(
        `[cron-delivery] deliverViaDirect: delivered=${delivered} results=${deliveryResults.length}`,
      );
      return null;
    } catch (err) {
      log.warn(`[cron-delivery] deliverViaDirect error: ${String(err)}`);
      if (!params.deliveryBestEffort) {
        return params.withRunSession({
          status: "error",
          summary,
          outputText,
          error: String(err),
          deliveryAttempted,
          ...params.telemetry,
        });
      }
      return null;
    }
  };

  const deliverViaAnnounce = async (
    delivery: SuccessfulDeliveryTarget,
  ): Promise<RunCronAgentTurnResult | null> => {
    if (!synthesizedText) {
      return null;
    }
    let announceMainSessionKey = resolveAgentMainSessionKey({
      cfg: params.cfg,
      agentId: params.agentId,
    });
    if (params.tenantId) {
      announceMainSessionKey = `t:${params.tenantId}:${announceMainSessionKey}`;
    }
    const announceSessionKey = await resolveCronAnnounceSessionKey({
      cfg: params.cfgWithAgentDefaults,
      agentId: params.agentId,
      fallbackSessionKey: announceMainSessionKey,
      delivery: {
        channel: delivery.channel,
        to: delivery.to,
        accountId: delivery.accountId,
        threadId: delivery.threadId,
      },
    });
    const taskLabel =
      typeof params.job.name === "string" && params.job.name.trim()
        ? params.job.name.trim()
        : `cron:${params.job.id}`;
    const initialSynthesizedText = synthesizedText.trim();
    let activeSubagentRuns = countActiveDescendantRuns(params.agentSessionKey);
    const expectedSubagentFollowup = expectsSubagentFollowup(initialSynthesizedText);
    const hadActiveDescendants = activeSubagentRuns > 0;
    if (activeSubagentRuns > 0 || expectedSubagentFollowup) {
      let finalReply = await waitForDescendantSubagentSummary({
        sessionKey: params.agentSessionKey,
        initialReply: initialSynthesizedText,
        timeoutMs: params.timeoutMs,
        observedActiveDescendants: activeSubagentRuns > 0 || expectedSubagentFollowup,
      });
      activeSubagentRuns = countActiveDescendantRuns(params.agentSessionKey);
      if (
        !finalReply &&
        activeSubagentRuns === 0 &&
        (hadActiveDescendants || expectedSubagentFollowup)
      ) {
        finalReply = await readDescendantSubagentFallbackReply({
          sessionKey: params.agentSessionKey,
          runStartedAt: params.runStartedAt,
        });
      }
      if (finalReply && activeSubagentRuns === 0) {
        outputText = finalReply;
        summary = pickSummaryFromOutput(finalReply) ?? summary;
        synthesizedText = finalReply;
        deliveryPayloads = [{ text: finalReply }];
      }
    }
    if (activeSubagentRuns > 0) {
      // Parent orchestration is still in progress; avoid announcing a partial
      // update to the main requester.
      return params.withRunSession({ status: "ok", summary, outputText, ...params.telemetry });
    }
    if (
      (hadActiveDescendants || expectedSubagentFollowup) &&
      synthesizedText.trim() === initialSynthesizedText &&
      isLikelyInterimCronMessage(initialSynthesizedText) &&
      initialSynthesizedText.toUpperCase() !== SILENT_REPLY_TOKEN.toUpperCase()
    ) {
      // Descendants existed but no post-orchestration synthesis arrived, so
      // suppress stale parent text like "on it, pulling everything together".
      return params.withRunSession({ status: "ok", summary, outputText, ...params.telemetry });
    }
    if (synthesizedText.toUpperCase() === SILENT_REPLY_TOKEN.toUpperCase()) {
      return params.withRunSession({
        status: "ok",
        summary,
        outputText,
        delivered: true,
        ...params.telemetry,
      });
    }
    try {
      if (params.isAborted()) {
        return params.withRunSession({
          status: "error",
          error: params.abortReason(),
          deliveryAttempted,
          ...params.telemetry,
        });
      }
      deliveryAttempted = true;
      const didAnnounce = await runSubagentAnnounceFlow({
        childSessionKey: params.agentSessionKey,
        childRunId: `${params.job.id}:${params.runSessionId}:${params.runStartedAt}`,
        requesterSessionKey: announceSessionKey,
        requesterOrigin: {
          channel: delivery.channel,
          to: delivery.to,
          accountId: delivery.accountId,
          threadId: delivery.threadId,
        },
        requesterDisplayKey: announceSessionKey,
        task: taskLabel,
        timeoutMs: params.timeoutMs,
        cleanup: params.job.deleteAfterRun ? "delete" : "keep",
        roundOneReply: synthesizedText,
        tenantId: params.tenantId,
        tenantUserId: params.userId,
        // Cron output is a finished completion message: send it directly to the
        // target channel via the completion-direct-send path rather than injecting
        // a trigger message into the (likely idle) main agent session.
        expectsCompletionMessage: true,
        // Keep delivery outcome truthful for cron state: if outbound send fails,
        // announce flow must report false so caller can apply best-effort policy.
        bestEffortDeliver: false,
        waitForCompletion: false,
        startedAt: params.runStartedAt,
        endedAt: params.runEndedAt,
        outcome: { status: "ok" },
        announceType: "cron job",
        signal: params.abortSignal,
      });
      if (didAnnounce) {
        delivered = true;
      } else {
        const message = "cron announce delivery failed";
        if (!params.deliveryBestEffort) {
          return params.withRunSession({
            status: "error",
            summary,
            outputText,
            error: message,
            deliveryAttempted,
            ...params.telemetry,
          });
        }
      }
    } catch (err) {
      if (!params.deliveryBestEffort) {
        return params.withRunSession({
          status: "error",
          summary,
          outputText,
          error: String(err),
          deliveryAttempted,
          ...params.telemetry,
        });
      }
    }
    return null;
  };

  /**
   * Announce cron output into the agent's main session without external
   * channel delivery.  This makes the output visible to web-UI users who
   * are connected via WebSocket but have no valid external delivery target.
   */
  const announceToMainSession = async (): Promise<RunCronAgentTurnResult | null> => {
    if (!synthesizedText) {
      return null;
    }
    let announceMainSessionKey =
      params.tenantAnnounceSessionKey ??
      resolveAgentMainSessionKey({
        cfg: params.cfg,
        agentId: params.agentId,
      });
    if (!params.tenantAnnounceSessionKey && params.tenantId) {
      announceMainSessionKey = `t:${params.tenantId}:${announceMainSessionKey}`;
    }
    const taskLabel =
      typeof params.job.name === "string" && params.job.name.trim()
        ? params.job.name.trim()
        : `cron:${params.job.id}`;
    try {
      if (params.isAborted()) {
        return params.withRunSession({
          status: "error",
          error: params.abortReason(),
          deliveryAttempted,
          ...params.telemetry,
        });
      }
      deliveryAttempted = true;
      // Inject cron output directly into the main session without external
      // delivery.  Using callGateway with deliver:false avoids the announce
      // flow's session-metadata-based delivery resolution, which would pick
      // up stale lastChannel/lastTo values (e.g. feishu + web-console user
      // name) and attempt an invalid external send.
      await callGateway({
        method: "agent",
        params: {
          sessionKey: announceMainSessionKey,
          message: `[${taskLabel}] ${synthesizedText}`,
          deliver: false,
          bestEffortDeliver: true,
          idempotencyKey: `cron-announce:${params.job.id}:${params.runSessionId}`,
          ...(params.tenantId && { _tenantId: params.tenantId }),
          ...(params.userId && { _tenantUserId: params.userId }),
        },
        expectFinal: true,
        timeoutMs: params.timeoutMs,
      });
      delivered = true;
    } catch {}
    return null;
  };

  if (
    params.deliveryRequested &&
    !params.skipHeartbeatDelivery &&
    !params.skipMessagingToolDelivery
  ) {
    if (!params.resolvedDelivery.ok) {
      // When the delivery target was implicitly inferred (e.g. from the
      // session store's lastChannel/lastTo) and turned out to be invalid,
      // treat it as best-effort: log a warning and let the cron run succeed.
      // The output stays in the session and is visible via the web UI.
      const treatAsBestEffort =
        params.deliveryBestEffort || params.resolvedDelivery.mode === "implicit";
      if (!treatAsBestEffort) {
        return {
          result: failDeliveryTarget(params.resolvedDelivery.error.message),
          delivered,
          deliveryAttempted,
          summary,
          outputText,
          synthesizedText,
          deliveryPayloads,
        };
      }
      // No valid external delivery target (e.g. web-console user with a
      // non-channel peer ID).  Announce into the main session so web-UI
      // users can see the cron output via their WebSocket connection.
      const announceResult = await announceToMainSession();
      if (announceResult) {
        return {
          result: announceResult,
          delivered,
          deliveryAttempted,
          summary,
          outputText,
          synthesizedText,
          deliveryPayloads,
        };
      }
      return {
        result: params.withRunSession({
          status: "ok",
          summary,
          outputText,
          deliveryAttempted,
          ...params.telemetry,
        }),
        delivered,
        deliveryAttempted,
        summary,
        outputText,
        synthesizedText,
        deliveryPayloads,
      };
    }

    // Route text-only cron announce output back through the main session so it
    // follows the same system-message injection path as subagent completions.
    // Keep direct outbound delivery only for structured payloads (media/channel
    // data), which cannot be represented by the shared announce flow.
    //
    // Forum/topic targets should also use direct delivery. Announce flow can
    // be swallowed by ANNOUNCE_SKIP/NO_REPLY in the target agent turn, which
    // silently drops cron output for topic-bound sessions.
    //
    // IM group chat targets must use direct delivery: multi-tenant sessions are
    // in tenant-scoped stores, not the global store that runSubagentAnnounceFlow
    // reads from, so the announce path cannot find the correct session and
    // silently drops the message.  This applies to Feishu (oc_), DingTalk
    // (group: or cid prefixed), and WeChat Work (group: prefixed) targets.
    const isFeishuGroupDelivery =
      (params.resolvedDelivery.channel === "feishu" ||
        params.resolvedDelivery.channel === "lark") &&
      (params.resolvedDelivery.to?.startsWith("oc_") ?? false);
    const isDingtalkGroupDelivery =
      params.resolvedDelivery.channel === "dingtalk" &&
      (params.resolvedDelivery.to?.startsWith("group:") ||
        params.resolvedDelivery.to?.startsWith("cid") ||
        false);
    const isWecomGroupDelivery =
      params.resolvedDelivery.channel === "wecom" &&
      (params.resolvedDelivery.to?.startsWith("group:") ?? false);
    // Agent-scoped cron (userId === agentId) must use direct delivery because:
    // 1. Tenant channel credentials are injected into cfgWithAgentDefaults but
    //    the announce flow calls callGateway which re-reads the global config.
    // 2. Agent has no real user session in the global store for announce to find.
    const isAgentScopedCron = params.tenantId && params.userId && params.userId === params.agentId;
    const useDirectDelivery =
      params.deliveryPayloadHasStructuredContent ||
      params.resolvedDelivery.threadId != null ||
      isFeishuGroupDelivery ||
      isDingtalkGroupDelivery ||
      isWecomGroupDelivery ||
      isAgentScopedCron;
    if (useDirectDelivery) {
      const directResult = await deliverViaDirect(params.resolvedDelivery);
      if (directResult) {
        return {
          result: directResult,
          delivered,
          deliveryAttempted,
          summary,
          outputText,
          synthesizedText,
          deliveryPayloads,
        };
      }
    } else {
      const announceResult = await deliverViaAnnounce(params.resolvedDelivery);
      if (announceResult) {
        return {
          result: announceResult,
          delivered,
          deliveryAttempted,
          summary,
          outputText,
          synthesizedText,
          deliveryPayloads,
        };
      }
    }
  }

  return {
    delivered,
    deliveryAttempted,
    summary,
    outputText,
    synthesizedText,
    deliveryPayloads,
  };
}
