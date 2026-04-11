import { describe, it, expect } from "vitest";
import { parsePipelineDefinition } from "./types.js";

describe("PipelineDefinition", () => {
  it("parses a minimal code-only pipeline", () => {
    const raw = {
      name: "echo",
      description: "test pipeline",
      input: { message: "string" },
      steps: [{ name: "prepare", type: "code", command: "python3 steps/prepare.py" }],
      output: "prepare",
    };
    const parsed = parsePipelineDefinition(raw);
    expect(parsed.name).toBe("echo");
    expect(parsed.steps).toHaveLength(1);
    const step = parsed.steps[0];
    if (step.type !== "code") {
      throw new Error("expected code step");
    }
    expect(step.command).toBe("python3 steps/prepare.py");
  });

  it("applies documented defaults when optional fields are omitted", () => {
    const raw = {
      name: "with-defaults",
      description: "defaults test",
      steps: [
        {
          name: "gen",
          type: "llm",
          prompt: "Say hi",
        },
      ],
      output: "gen",
    };
    const parsed = parsePipelineDefinition(raw);
    expect(parsed.triggers).toEqual([]);
    expect(parsed.input).toEqual({});
    const step = parsed.steps[0];
    if (step.type !== "llm") {
      throw new Error("expected llm step");
    }
    expect(step.model).toBe("standard");
    expect(step.retry).toBe(2);
  });

  it("parses an LLM step with schema and retry", () => {
    const raw = {
      name: "summarize",
      description: "generate summary",
      input: { content: "string" },
      steps: [
        {
          name: "gen",
          type: "llm",
          model: "standard",
          prompt: "Summarize: {{input.content}}",
          schema: "schemas/summary.json",
          retry: 3,
        },
      ],
      output: "gen",
    };
    const parsed = parsePipelineDefinition(raw);
    const step = parsed.steps[0];
    if (step.type !== "llm") {
      throw new Error("expected llm step");
    }
    expect(step.model).toBe("standard");
    expect(step.retry).toBe(3);
  });

  it("rejects pipeline without name", () => {
    const raw = { description: "x", steps: [] };
    expect(() => parsePipelineDefinition(raw)).toThrow(/name/);
  });

  it("rejects step with unknown type", () => {
    const raw = {
      name: "bad",
      description: "x",
      steps: [{ name: "s1", type: "magic" }],
    };
    expect(() => parsePipelineDefinition(raw)).toThrow(/type/);
  });
});
