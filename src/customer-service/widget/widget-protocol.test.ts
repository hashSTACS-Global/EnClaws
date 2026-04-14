/**
 * Tests for CS Widget protocol serialization.
 *
 * 客服 Widget 协议序列化测试。
 */

import { describe, expect, it } from "vitest";
import { parseClientMessage, serializeServerMessage } from "./widget-protocol.js";

describe("CS widget protocol", () => {
  describe("parseClientMessage", () => {
    it("parses a valid connect message", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "connect", visitorId: "v1" }));
      expect(msg).toEqual({ type: "connect", visitorId: "v1" });
    });

    it("parses a valid send message", () => {
      const msg = parseClientMessage(JSON.stringify({ type: "send", text: "hello" }));
      expect(msg).toEqual({ type: "send", text: "hello" });
    });

    it("returns null for invalid JSON", () => {
      expect(parseClientMessage("not json")).toBeNull();
    });

    it("returns null for object without type", () => {
      expect(parseClientMessage(JSON.stringify({ text: "hello" }))).toBeNull();
    });

    it("returns null for non-object", () => {
      expect(parseClientMessage(JSON.stringify("hello"))).toBeNull();
    });
  });

  describe("serializeServerMessage", () => {
    it("serializes a message to JSON string", () => {
      const result = serializeServerMessage({
        type: "message",
        role: "ai",
        text: "hello",
        messageId: "m1",
        roleLabel: "🤖 AI 助手",
      });
      const parsed = JSON.parse(result);
      expect(parsed.type).toBe("message");
      expect(parsed.role).toBe("ai");
      expect(parsed.text).toBe("hello");
    });
  });
});
