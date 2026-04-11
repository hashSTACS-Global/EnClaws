import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";
import type { RegisteredPipeline } from "./registry.js";
import { executePipeline } from "./runner.js";
import { loadPipelineYaml } from "./yaml-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const APP_DIR = path.resolve(__dirname, "../../../test/fixtures/app-v03");
const ECHO_DIR = path.join(APP_DIR, "pipelines/echo-pipeline");

async function loadEcho(): Promise<RegisteredPipeline> {
  return {
    name: "echo",
    dir: ECHO_DIR,
    definition: await loadPipelineYaml(path.join(ECHO_DIR, "pipeline.yaml")),
  };
}

describe("executePipeline", () => {
  it("runs code → llm → returns final output", async () => {
    const pipeline = await loadEcho();
    const mockProvider = vi.fn().mockResolvedValue(
      JSON.stringify({
        summary: "this is a valid summary that passes the schema check",
      }),
    );
    const result = await executePipeline({
      pipeline,
      input: { message: "hello world" },
      workspaceDir: "/tmp/workspace",
      appName: "test-app",
      tenantId: "test-tenant",
      deps: { callProvider: mockProvider },
    });
    expect(result.status).toBe("completed");
    expect(result.progress).toEqual(["prepare ✓", "summarize ✓"]);
    expect(result.output).toMatchObject({ summary: expect.any(String) });
    expect(mockProvider).toHaveBeenCalledOnce();
    const prompt = mockProvider.mock.calls[0][0].prompt;
    expect(prompt).toContain("HELLO WORLD"); // prepare.py uppercases
  });

  it("returns error status on step failure", async () => {
    const pipeline = await loadEcho();
    const mockProvider = vi.fn().mockResolvedValue("not json at all");
    const result = await executePipeline({
      pipeline,
      input: { message: "x" },
      workspaceDir: "/tmp/workspace",
      appName: "test-app",
      tenantId: "test-tenant",
      deps: { callProvider: mockProvider },
    });
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/retry budget/);
    expect(result.progress).toContain("prepare ✓");
  });
});
