import { describe, expect, it } from "vitest";
import { buildFallbackReply } from "./cs-fallback-reply.js";

describe("buildFallbackReply", () => {
  it("knowledge_gap + ambiguous + hints → clarify posture with options", () => {
    const r = buildFallbackReply("knowledge_gap", {
      ambiguous: true,
      clarifyHints: ["定价方案", "功能列表"],
    });
    expect(r.text).toContain("我没有完全理解");
    expect(r.clarifyOptions).toEqual(["定价方案", "功能列表"]);
  });

  it("clarify options capped at 3", () => {
    const r = buildFallbackReply("knowledge_gap", {
      ambiguous: true,
      clarifyHints: ["A", "B", "C", "D"],
    });
    expect(r.clarifyOptions).toHaveLength(3);
  });

  it("sensitive topic → refer-to-human posture", () => {
    const r = buildFallbackReply("knowledge_gap", { sensitive: true });
    expect(r.text).toContain("负责人");
    expect(r.clarifyOptions).toBeUndefined();
  });

  it("knowledge_gap without ambiguous/sensitive → out-of-scope posture", () => {
    const r = buildFallbackReply("knowledge_gap");
    expect(r.text).toContain("超出了我目前掌握的知识范围");
  });

  it("suspect_badcase → cautious posture", () => {
    const r = buildFallbackReply("suspect_badcase");
    expect(r.text).toContain("不够了解");
  });

  it("ambiguous without hints falls back to out-of-scope", () => {
    const r = buildFallbackReply("knowledge_gap", { ambiguous: true, clarifyHints: [] });
    expect(r.text).toContain("超出了我目前掌握");
    expect(r.clarifyOptions).toBeUndefined();
  });
});
