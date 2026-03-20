import type { ChannelId } from "../../channels/plugins/types.js";
import type { OpenClawConfig } from "../../config/config.js";
import {
  loadSessionStore,
  resolveAgentMainSessionKey,
  resolveStorePath,
} from "../../config/sessions.js";
import { resolveMessageChannelSelection } from "../../infra/outbound/channel-selection.js";
import type { OutboundChannel } from "../../infra/outbound/targets.js";
import {
  resolveOutboundTarget,
  resolveSessionDeliveryTarget,
} from "../../infra/outbound/targets.js";
import { readChannelAllowFromStoreSync } from "../../pairing/pairing-store.js";
import { buildChannelAccountBindings } from "../../routing/bindings.js";
import { normalizeAccountId, normalizeAgentId } from "../../routing/session-key.js";
import { resolveWhatsAppAccount } from "../../web/accounts.js";
import { normalizeWhatsAppTarget } from "../../whatsapp/normalize.js";

export type DeliveryTargetResolution =
  | {
      ok: true;
      channel: Exclude<OutboundChannel, "none">;
      to: string;
      accountId?: string;
      threadId?: string | number;
      mode: "explicit" | "implicit";
    }
  | {
      ok: false;
      channel?: Exclude<OutboundChannel, "none">;
      to?: string;
      accountId?: string;
      threadId?: string | number;
      mode: "explicit" | "implicit";
      error: Error;
    };

export async function resolveDeliveryTarget(
  cfg: OpenClawConfig,
  agentId: string,
  jobPayload: {
    channel?: "last" | ChannelId;
    to?: string;
    accountId?: string;
    sessionKey?: string;
  },
): Promise<DeliveryTargetResolution> {
  const requestedChannel = typeof jobPayload.channel === "string" ? jobPayload.channel : "last";
  const explicitTo = typeof jobPayload.to === "string" ? jobPayload.to : undefined;
  const allowMismatchedLastTo = requestedChannel === "last";

  const sessionCfg = cfg.session;
  const mainSessionKey = resolveAgentMainSessionKey({ cfg, agentId });
  const storePath = resolveStorePath(sessionCfg?.store, { agentId });
  const store = loadSessionStore(storePath);

  // Look up thread-specific session first (e.g. agent:main:main:thread:1234),
  // then fall back to the main session entry.
  const threadSessionKey = jobPayload.sessionKey?.trim();
  const threadEntry = threadSessionKey ? store[threadSessionKey] : undefined;
  const main = threadEntry ?? store[mainSessionKey];

  const preliminary = resolveSessionDeliveryTarget({
    entry: main,
    requestedChannel,
    explicitTo,
    allowMismatchedLastTo,
  });

  let fallbackChannel: Exclude<OutboundChannel, "none"> | undefined;
  let channelResolutionError: Error | undefined;
  if (!preliminary.channel) {
    if (preliminary.lastChannel) {
      fallbackChannel = preliminary.lastChannel;
    } else {
      try {
        const selection = await resolveMessageChannelSelection({ cfg });
        fallbackChannel = selection.channel;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        channelResolutionError = new Error(
          `${detail} Set delivery.channel explicitly or use a main session with a previous channel.`,
        );
      }
    }
  }

  const resolved = fallbackChannel
    ? resolveSessionDeliveryTarget({
        entry: main,
        requestedChannel,
        explicitTo,
        fallbackChannel,
        allowMismatchedLastTo,
        mode: preliminary.mode,
      })
    : preliminary;

  const channel = resolved.channel ?? fallbackChannel;
  const mode = resolved.mode as "explicit" | "implicit";
  let toCandidate = resolved.to;

  // Prefer an explicit accountId from the job's delivery config (set via
  // --account on cron add/edit). Fall back to the session's lastAccountId,
  // then to the agent's bound account from bindings config.
  const explicitAccountId =
    typeof jobPayload.accountId === "string" && jobPayload.accountId.trim()
      ? jobPayload.accountId.trim()
      : undefined;
  let accountId = explicitAccountId ?? resolved.accountId;
  if (!accountId && channel) {
    const bindings = buildChannelAccountBindings(cfg);
    const byAgent = bindings.get(channel);
    const boundAccounts = byAgent?.get(normalizeAgentId(agentId));
    if (boundAccounts && boundAccounts.length > 0) {
      accountId = boundAccounts[0];
    }
  }

  // Carry threadId when it was explicitly set (from :topic: parsing or config)
  // or when delivering to the same recipient as the session's last conversation.
  // Session-derived threadIds are dropped when the target differs to prevent
  // stale thread IDs from leaking to a different chat.
  const threadId =
    resolved.threadId &&
    (resolved.threadIdExplicit || (resolved.to && resolved.to === resolved.lastTo))
      ? resolved.threadId
      : undefined;

  if (!channel) {
    return {
      ok: false,
      channel: undefined,
      to: undefined,
      accountId,
      threadId,
      mode,
      error:
        channelResolutionError ??
        new Error("Channel is required when delivery.channel=last has no previous channel."),
    };
  }

  if (!toCandidate) {
    return {
      ok: false,
      channel,
      to: undefined,
      accountId,
      threadId,
      mode,
      error:
        channelResolutionError ??
        new Error(`No delivery target resolved for channel "${channel}". Set delivery.to.`),
    };
  }

  let allowFromOverride: string[] | undefined;
  if (channel === "whatsapp") {
    const resolvedAccountId = normalizeAccountId(accountId);
    const configuredAllowFromRaw =
      resolveWhatsAppAccount({ cfg, accountId: resolvedAccountId }).allowFrom ?? [];
    const configuredAllowFrom = configuredAllowFromRaw
      .map((entry) => String(entry).trim())
      .filter((entry) => entry && entry !== "*")
      .map((entry) => normalizeWhatsAppTarget(entry))
      .filter((entry): entry is string => Boolean(entry));
    const storeAllowFrom = readChannelAllowFromStoreSync("whatsapp", process.env, resolvedAccountId)
      .map((entry) => normalizeWhatsAppTarget(entry))
      .filter((entry): entry is string => Boolean(entry));
    allowFromOverride = [...new Set([...configuredAllowFrom, ...storeAllowFrom])];

    if (mode === "implicit" && allowFromOverride.length > 0) {
      const normalizedCurrentTarget = normalizeWhatsAppTarget(toCandidate);
      if (!normalizedCurrentTarget || !allowFromOverride.includes(normalizedCurrentTarget)) {
        toCandidate = allowFromOverride[0];
      }
    }
  }

  // Reject peer IDs that are clearly invalid for the resolved channel.
  // In multi-tenant setups, the session store may record a web-console user
  // name (e.g. "heartbeat") as `lastTo` while `lastChannel` points to an
  // external provider (e.g. "feishu").  Attempting delivery with such an ID
  // will always fail at the provider API level.  Clear the candidate so the
  // existing "no target" path handles it gracefully — cron output stays in
  // the session and is visible via the web UI.
  if (!isPlausibleDeliveryTarget(channel, toCandidate)) {
    toCandidate = undefined;
  }

  const docked = resolveOutboundTarget({
    channel,
    to: toCandidate,
    cfg,
    accountId,
    mode,
    allowFrom: allowFromOverride,
  });
  if (!docked.ok) {
    return {
      ok: false,
      channel,
      to: undefined,
      accountId,
      threadId,
      mode,
      error: docked.error,
    };
  }
  return {
    ok: true,
    channel,
    to: docked.to,
    accountId,
    threadId,
    mode,
  };
}

/**
 * Lightweight format check: does `to` look like a plausible delivery target
 * for `channel`?  Only rejects IDs that are clearly invalid; unknown channels
 * pass through.
 */
function isPlausibleDeliveryTarget(channel: string, to: string): boolean {
  const id = to.trim().toLowerCase();
  if (!id) {
    return false;
  }
  switch (channel) {
    case "feishu":
    case "lark":
      // ou_ = open_id, on_ = union_id, oc_ = chat_id
      // Also accept prefixed forms stored by session: user:ou_, user:on_, chat:oc_
      return /^((user:|chat:)?(ou_|on_|oc_))/.test(id);
    case "telegram":
      return /^-?\d+/.test(id);
    case "discord":
      return /^\d+$/.test(id);
    case "slack":
      return /^[uwcdg]/i.test(id);
    default:
      return true;
  }
}
