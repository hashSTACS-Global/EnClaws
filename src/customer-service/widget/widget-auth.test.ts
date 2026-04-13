/**
 * Tests for CS Widget visitor authentication.
 *
 * 客服 Widget 访客认证测试。
 */

import { describe, expect, it } from "vitest";
import { generateVisitorId, generateVisitorToken, verifyVisitorToken } from "./widget-auth.js";

describe("CS widget auth", () => {
  it("generateVisitorId returns a valid UUID", () => {
    const id = generateVisitorId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("generateVisitorToken returns a hex string", () => {
    const token = generateVisitorToken("test-id");
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyVisitorToken succeeds with matching token", () => {
    const id = generateVisitorId();
    const token = generateVisitorToken(id);
    expect(verifyVisitorToken(id, token)).toBe(true);
  });

  it("verifyVisitorToken fails with wrong token", () => {
    const id = generateVisitorId();
    expect(verifyVisitorToken(id, "0".repeat(64))).toBe(false);
  });

  it("verifyVisitorToken fails with different visitor ID", () => {
    const id1 = generateVisitorId();
    const id2 = generateVisitorId();
    const token = generateVisitorToken(id1);
    expect(verifyVisitorToken(id2, token)).toBe(false);
  });

  it("respects custom secret", () => {
    const id = generateVisitorId();
    const token1 = generateVisitorToken(id, "secret-a");
    const token2 = generateVisitorToken(id, "secret-b");
    expect(token1).not.toBe(token2);
    expect(verifyVisitorToken(id, token1, "secret-a")).toBe(true);
    expect(verifyVisitorToken(id, token1, "secret-b")).toBe(false);
  });
});
