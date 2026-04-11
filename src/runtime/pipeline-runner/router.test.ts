import { describe, it, expect } from "vitest";
import type { RegisteredPipeline } from "./registry.js";
import { IntentRouter } from "./router.js";

function makePipeline(name: string, triggers: string[]): RegisteredPipeline {
  return {
    name,
    dir: "/fake",
    definition: {
      name,
      description: `${name} pipeline`,
      triggers,
      input: {},
      steps: [],
      output: "",
    },
  };
}

describe("IntentRouter", () => {
  it("matches a pipeline by trigger keyword", () => {
    const router = new IntentRouter([
      makePipeline("discuss-new", ["发起讨论", "new discussion"]),
      makePipeline("discuss-reply", ["回复", "reply"]),
    ]);
    expect(router.match("帮我发起讨论")?.name).toBe("discuss-new");
    expect(router.match("new discussion please")?.name).toBe("discuss-new");
    expect(router.match("reply to that thread")?.name).toBe("discuss-reply");
  });

  it("returns undefined when no trigger matches", () => {
    const router = new IntentRouter([makePipeline("discuss-new", ["发起讨论"])]);
    expect(router.match("tell me a joke")).toBeUndefined();
  });

  it("prefers the pipeline with the most specific match", () => {
    const router = new IntentRouter([
      makePipeline("discuss-new", ["discuss"]),
      makePipeline("discuss-new-urgent", ["urgent discuss"]),
    ]);
    expect(router.match("urgent discuss please")?.name).toBe("discuss-new-urgent");
  });
});
