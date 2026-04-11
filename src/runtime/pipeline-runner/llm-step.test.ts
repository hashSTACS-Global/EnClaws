import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import { runLLMStep } from "./llm-step.js";
import type { ExecutionContext, LLMStep } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PIPELINE_DIR = path.resolve(
  __dirname,
  "../../../test/fixtures/app-v03/pipelines/echo-pipeline",
);

function makeCtx(): ExecutionContext {
  return {
    input: { message: "test input" },
    steps: { prepare: { output: { content: "the prepared content" } } },
    pipelineDir: PIPELINE_DIR,
    workspaceDir: "/tmp/workspace",
    appName: "test-app",
    tenantId: "test-tenant",
  };
}

describe("runLLMStep", () => {
  it("calls provider with rendered prompt and validates output", async () => {
    const mockProvider = vi
      .fn()
      .mockResolvedValue(JSON.stringify({ summary: "valid ten-char plus summary string here" }));
    const step: LLMStep = {
      name: "gen",
      type: "llm",
      model: "standard",
      prompt: "Summarize: {{prepare.output.content}}",
      schema: "schemas/summary.json",
      retry: 2,
    };
    const result = await runLLMStep(step, makeCtx(), { callProvider: mockProvider });
    expect(mockProvider).toHaveBeenCalledOnce();
    const call = mockProvider.mock.calls[0][0];
    expect(call.prompt).toContain("the prepared content");
    expect(call.model).toBe("claude-sonnet-4-6");
    expect(result.output).toMatchObject({ summary: expect.any(String) });
  });

  it("retries on schema validation failure", async () => {
    const mockProvider = vi
      .fn()
      .mockResolvedValueOnce(JSON.stringify({ summary: "2short" }))
      .mockResolvedValueOnce(
        JSON.stringify({ summary: "now this is long enough to pass validation" }),
      );
    const step: LLMStep = {
      name: "gen",
      type: "llm",
      model: "standard",
      prompt: "Summarize: {{prepare.output.content}}",
      schema: "schemas/summary.json",
      retry: 2,
    };
    const result = await runLLMStep(step, makeCtx(), { callProvider: mockProvider });
    expect(mockProvider).toHaveBeenCalledTimes(2);
    expect(result.output).toBeDefined();
  });

  it("rejects after retry budget exhausted", async () => {
    const mockProvider = vi.fn().mockResolvedValue(JSON.stringify({ summary: "x" }));
    const step: LLMStep = {
      name: "gen",
      type: "llm",
      model: "standard",
      prompt: "Summarize: {{prepare.output.content}}",
      schema: "schemas/summary.json",
      retry: 2,
    };
    await expect(runLLMStep(step, makeCtx(), { callProvider: mockProvider })).rejects.toThrow(
      /retry budget|validation/,
    );
    expect(mockProvider).toHaveBeenCalledTimes(3);
  });
});
