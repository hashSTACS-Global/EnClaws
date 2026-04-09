import { describe, it, expect } from "vitest";
import { estimateCharsPerToken } from "./pruner.js";

describe("estimateCharsPerToken", () => {
  it("returns 4 for pure ASCII text", () => {
    expect(estimateCharsPerToken("Hello, this is a test message.")).toBe(4);
  });

  it("returns 2 for Chinese-dominant text", () => {
    expect(estimateCharsPerToken("这是一个中文测试消息用来验证")).toBe(2);
  });

  it("returns 4 for mixed text with low CJK ratio", () => {
    expect(estimateCharsPerToken("Hello world 你好")).toBe(4);
  });

  it("returns 2 for mixed text with high CJK ratio (>30%)", () => {
    expect(estimateCharsPerToken("你好世界测试abc")).toBe(2);
  });

  it("returns 4 for empty string", () => {
    expect(estimateCharsPerToken("")).toBe(4);
  });
});
