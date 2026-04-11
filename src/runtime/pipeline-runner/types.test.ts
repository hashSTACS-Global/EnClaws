import { describe, it, expect } from "vitest";
import { PipelineDefinitionSchema, parsePipelineDefinition } from "./types";

describe("PipelineDefinition", () => {
  it("parses a minimal code-only pipeline", () => {
    const raw = {
      name: "echo",
      description: "test pipeline",
      input: { message: "string" },
      steps: [
        { name: "prepare", type: "code", command: "python3 steps/prepare.py" },
      ],
      output: "prepare",
    };
    const parsed = parsePipelineDefinition(raw);
    expect(parsed.name).toBe("echo");
    expect(parsed.steps).toHaveLength(1);
    expect(parsed.steps[0].type).toBe("code");
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
    if (step.type !== "llm") throw new Error("expected llm step");
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
