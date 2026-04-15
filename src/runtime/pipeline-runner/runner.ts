import { runCodeStep } from "./code-step.js";
import type { LLMStepDeps } from "./llm-step.js";
import { runLLMStep } from "./llm-step.js";
import type { RegisteredPipeline } from "./registry.js";
import type { ExecutionContext, RunnerResult, Step, StepOutput } from "./types.js";

export interface ExecuteOptions {
  pipeline: RegisteredPipeline;
  input: Record<string, unknown>;
  workspaceDir: string;
  appName: string;
  tenantId: string;
  tenantUserId?: string;
  agentId?: string;
  deps: LLMStepDeps;
}

export async function executePipeline(opts: ExecuteOptions): Promise<RunnerResult> {
  const { pipeline, input, workspaceDir, appName, tenantId, tenantUserId, agentId, deps } = opts;
  const ctx: ExecutionContext = {
    input,
    steps: {},
    pipelineDir: pipeline.dir,
    workspaceDir,
    appName,
    tenantId,
    tenantUserId,
    agentId,
  };
  const progress: string[] = [];

  for (const step of pipeline.definition.steps) {
    if (shouldSkip(step, ctx)) {
      progress.push(`${step.name} (skipped)`);
      ctx.steps[step.name] = { output: null };
      continue;
    }

    try {
      const out = await runOneStep(step, ctx, deps);
      ctx.steps[step.name] = out;
      progress.push(`${step.name} ✓`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const errorDetail = `pipeline "${pipeline.name}" step "${step.name}" (type=${step.type}) failed: ${msg}`;
      return {
        status: "error",
        error: errorDetail,
        progress,
      };
    }
  }

  const finalOutput = ctx.steps[pipeline.definition.output]?.output;
  return {
    status: "completed",
    output: finalOutput,
    progress,
  };
}

function shouldSkip(step: Step, ctx: ExecutionContext): boolean {
  if (!step.skip_if) {
    return false;
  }
  // Simple impl: supports "step.output.field" as boolean check.
  // Complex expressions deferred to v0.4.
  const parts = step.skip_if.split(".");
  if (parts.length < 3) {
    return false;
  }
  const [stepName, field, ...rest] = parts;
  if (field !== "output") {
    return false;
  }
  const stepOut = ctx.steps[stepName];
  if (!stepOut) {
    return false;
  }
  let cur: unknown = stepOut.output;
  for (const key of rest) {
    if (cur === null || typeof cur !== "object") {
      return false;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return Boolean(cur);
}

async function runOneStep(
  step: Step,
  ctx: ExecutionContext,
  deps: LLMStepDeps,
): Promise<StepOutput> {
  if (step.type === "code") {
    return runCodeStep(step, ctx);
  }
  return runLLMStep(step, ctx, deps);
}
