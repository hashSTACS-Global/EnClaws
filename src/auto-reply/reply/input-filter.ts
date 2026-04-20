import { createSubsystemLogger } from "../../logging/subsystem.js";
import { BLOCKED_PATTERN_SOURCES } from "./blocked-patterns.js";

const log = createSubsystemLogger("input-filter");

const BLOCKED_PATTERNS: RegExp[] = [];
for (const src of BLOCKED_PATTERN_SOURCES) {
  try {
    BLOCKED_PATTERNS.push(new RegExp(src, "i"));
  } catch {
    log.warn(`invalid blocked pattern: ${src}`);
  }
}
log.info(`loaded ${BLOCKED_PATTERNS.length} blocked patterns`);

const BLOCKED_REPLY = "抱歉，检测到不安全的内容，该类请求暂不支持。";

export type InputFilterResult = {
  blocked: boolean;
  replyText?: string;
};

/**
 * Check inbound message text against blocked patterns.
 * Returns { blocked: true, replyText } when the message matches a dangerous pattern.
 */
export function checkInputFilter(params: {
  text: string;
  channel?: string;
  chatType?: string;
}): InputFilterResult {
  const { text, channel, chatType } = params;

  const normalizedText = text.trim();
  if (!normalizedText) {
    return { blocked: false };
  }

  for (const re of BLOCKED_PATTERNS) {
    if (re.test(normalizedText)) {
      log.info(
        `input blocked: pattern=${re.source} channel=${channel ?? "unknown"} chatType=${chatType ?? "unknown"}`,
      );
      return {
        blocked: true,
        replyText: BLOCKED_REPLY,
      };
    }
  }

  return { blocked: false };
}
