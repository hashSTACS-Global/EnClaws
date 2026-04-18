import type { MsgContext } from "../auto-reply/templating.js";
import { parseAgentSessionKey } from "../sessions/session-key-utils.js";

/**
 * External session label for downstream skills/subprocesses.
 *
 * This is a human-readable, pipe-separated string injected as ENCLAWS_SESSION_KEY.
 * It is completely separate from the internal sessionKey (colon-separated, used for
 * persistence/routing) — the internal key is never modified.
 *
 * Format:
 *   agent:{agentId} | channel:{channel} | group:{groupId|"single"} | union:{unionId} | open:{openId} | name:{encodedDisplayName}
 *
 * The `name` field is encodeURIComponent-encoded to safely carry UTF-8 display names
 * across shell/Docker/env-var boundaries without encoding ambiguity.
 */

export interface SessionLabelParts {
  agentId: string;
  /** IM platform: feishu | wecom | dingtalk | slack | telegram | discord */
  channel: string;
  /** Group/chat ID for group chats; "single" for DMs */
  group: string;
  /** Cross-app stable user ID (union_id). Falls back to open when platform has no union ID. */
  union: string;
  /** Platform-local user ID (open_id / userid / staffId / userId) */
  open: string;
  /** Raw display name — will be encodeURIComponent-encoded in the output */
  name: string;
}

export function buildSessionLabel(parts: SessionLabelParts): string {
  return [
    `agent:${parts.agentId}`,
    `channel:${parts.channel}`,
    `group:${parts.group}`,
    `union:${parts.union}`,
    `open:${parts.open}`,
    `name:${encodeURIComponent(parts.name || parts.open)}`,
  ].join("|");
}

/**
 * Parse the new pipe-separated session label format into its component parts.
 * Returns partial fields; missing keys are undefined.
 *
 * Used in buildExecExtraEnv() for forward-compatible field extraction —
 * when the new format is present, extract name/union/etc from it;
 * when the old colon-separated format is present, returns {}.
 */
/**
 * Derive a SessionLabel from the already-populated FinalizedMsgContext.
 *
 * Called once at the get-reply boundary — no IM plugin changes required.
 * All fields are reconstructed from fields every channel already sets:
 *   agentId  ← parseAgentSessionKey(ctx.SessionKey).agentId
 *   channel  ← ctx.Provider ?? ctx.Surface
 *   group    ← SessionKey rest: kind=direct→"single", else peerId segment
 *   union    ← ctx.SenderUnionId ?? ctx.SenderId  (falls back for non-Feishu)
 *   open     ← ctx.SenderId
 *   name     ← ctx.SenderName
 */
export function buildSessionLabelFromContext(ctx: MsgContext): string | undefined {
  const channel = ctx.Provider ?? ctx.Surface;
  if (!channel) {
    return undefined;
  }

  const parsed = parseAgentSessionKey(ctx.SessionKey);
  if (!parsed) {
    return undefined;
  }

  // rest = "{channel}:{kind}:{peerId}:..."  e.g. "feishu:group:oc_xxx:sender:ou_xxx"
  const parts = parsed.rest.split(":");
  const kind = parts[1]; // "direct" | "group" | "channel" | ...
  const group = !kind || kind === "direct" || kind === "dm" ? "single" : (parts[2] ?? "single");

  const open = ctx.SenderId?.trim() || "";
  const union = ctx.SenderUnionId?.trim() || open;
  const name = ctx.SenderName?.trim() ?? "";

  return buildSessionLabel({ agentId: parsed.agentId, channel, group, union, open, name });
}

export function parseSessionKeySegments(sessionKey?: string): Partial<SessionLabelParts> {
  if (!sessionKey?.includes("|")) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const part of sessionKey.split("|")) {
    const colon = part.indexOf(":");
    if (colon === -1) {
      continue;
    }
    const key = part.slice(0, colon).trim();
    const value = part.slice(colon + 1).trim();
    if (key && value) {
      out[key] = value;
    }
  }
  return {
    agentId: out["agent"],
    channel: out["channel"],
    group: out["group"],
    union: out["union"],
    open: out["open"],
    name: out["name"]
      ? (() => {
          try {
            return decodeURIComponent(out["name"]);
          } catch {
            return out["name"];
          }
        })()
      : undefined,
  } as Partial<SessionLabelParts>;
}
