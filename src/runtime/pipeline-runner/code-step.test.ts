import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { runCodeStep } from "./code-step.js";
import type { ExecutionContext, CodeStep } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PIPELINE_DIR = path.resolve(
  __dirname,
  "../../../test/fixtures/app-v03/pipelines/echo-pipeline",
);

function makeCtx(): ExecutionContext {
  return {
    input: { message: "hello world" },
    steps: {},
    pipelineDir: PIPELINE_DIR,
    workspaceDir: "/tmp/test-workspace",
    appName: "test-app",
    tenantId: "test-tenant",
  };
}

describe("runCodeStep", () => {
  it("executes a Python step and returns its output", async () => {
    const step: CodeStep = {
      name: "prepare",
      type: "code",
      command: "python3 steps/prepare.py",
    };
    const result = await runCodeStep(step, makeCtx());
    expect(result.output).toEqual({
      message: "HELLO WORLD",
      length: 11,
    });
  });

  it("rejects when script exits non-zero", async () => {
    const step: CodeStep = {
      name: "bad",
      type: "code",
      command: "python3 steps/bad_exit.py",
    };
    await expect(runCodeStep(step, makeCtx())).rejects.toThrow(/exited with code 2/);
  });

  it("rejects when stdout is not valid JSON", async () => {
    const step: CodeStep = {
      name: "bad",
      type: "code",
      command: "python3 steps/bad_json.py",
    };
    await expect(runCodeStep(step, makeCtx())).rejects.toThrow(/JSON/);
  });
});
