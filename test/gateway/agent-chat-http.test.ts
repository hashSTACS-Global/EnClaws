import { describe, expect, it } from "vitest";
import { parseSessionKey } from "../../src/gateway/agent-chat-http.js";

describe("parseSessionKey", () => {
  it("parses a full sessionKey with every documented segment", () => {
    const key =
      "agent:agt_123|channel:feishu|group:oc_abc|union:on_xyz|open:ou_pqr|name:张三";
    expect(parseSessionKey(key)).toEqual({
      agentId: "agt_123",
      channel: "feishu",
      group: "oc_abc",
      unionId: "on_xyz",
      openId: "ou_pqr",
      name: "张三",
    });
  });

  it("parses the single-chat group value", () => {
    expect(
      parseSessionKey(
        "agent:agt_1|channel:wecom|group:single|union:on_u|open:ou_o|name:L",
      ).group,
    ).toBe("single");
  });

  it("supports dingtalk as a channel value", () => {
    expect(parseSessionKey("agent:a|channel:dingtalk").channel).toBe(
      "dingtalk",
    );
  });

  it("returns only the segments that are present", () => {
    expect(parseSessionKey("agent:agt_1|channel:feishu")).toEqual({
      agentId: "agt_1",
      channel: "feishu",
    });
  });

  it("skips empty-value segments", () => {
    expect(parseSessionKey("agent:agt_1|channel:|union:on_u")).toEqual({
      agentId: "agt_1",
      unionId: "on_u",
    });
  });

  it("ignores segments without a colon", () => {
    expect(parseSessionKey("agent:agt_1|garbage|channel:feishu")).toEqual({
      agentId: "agt_1",
      channel: "feishu",
    });
  });

  it("ignores segments whose key is empty (leading colon)", () => {
    expect(parseSessionKey("agent:agt_1|:novalue|channel:feishu")).toEqual({
      agentId: "agt_1",
      channel: "feishu",
    });
  });

  it("ignores unknown keys", () => {
    expect(parseSessionKey("agent:agt_1|unknown:value|channel:feishu")).toEqual({
      agentId: "agt_1",
      channel: "feishu",
    });
  });

  it("trims surrounding whitespace in keys and values", () => {
    expect(parseSessionKey(" agent : agt_1 | channel : feishu ")).toEqual({
      agentId: "agt_1",
      channel: "feishu",
    });
  });

  it("keeps only the first colon as separator so values may contain ':'", () => {
    expect(parseSessionKey("agent:agt:1|channel:feishu").agentId).toBe(
      "agt:1",
    );
  });

  it("returns an empty object for an empty string", () => {
    expect(parseSessionKey("")).toEqual({});
  });

  it("returns an empty object when no segment carries known keys", () => {
    expect(parseSessionKey("foo|bar|baz")).toEqual({});
  });

  it("lets the last occurrence of a key win", () => {
    expect(parseSessionKey("agent:first|agent:second").agentId).toBe("second");
  });
});
