/**
 * Customer Service Widget visitor authentication.
 *
 * 客服 Widget 访客认证 — UUID + HMAC-SHA256。
 */

import crypto from "node:crypto";

const DEFAULT_SECRET = "enclaws-cs-widget-default-secret";

/**
 * Generate a new visitor ID (UUID v4).
 *
 * 生成新的访客 ID。
 */
export function generateVisitorId(): string {
  return crypto.randomUUID();
}

/**
 * Generate a visitor token (HMAC-SHA256 of the visitor ID).
 *
 * 生成访客 token（对 visitor ID 做 HMAC-SHA256）。
 */
export function generateVisitorToken(visitorId: string, secret?: string): string {
  const hmac = crypto.createHmac("sha256", secret ?? DEFAULT_SECRET);
  hmac.update(visitorId);
  return hmac.digest("hex");
}

/**
 * Verify a visitor token against the visitor ID.
 *
 * 验证访客 token。
 */
export function verifyVisitorToken(
  visitorId: string,
  token: string,
  secret?: string,
): boolean {
  const expected = generateVisitorToken(visitorId, secret);
  // Constant-time comparison to prevent timing attacks
  // 常量时间比较，防止时序攻击
  if (expected.length !== token.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
