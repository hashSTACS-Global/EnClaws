import { mkdir } from "node:fs/promises";
import { resolveAppWorkspaceDir } from "../runtime/app-paths.js";
import type { LLMStepDeps } from "../runtime/pipeline-runner/llm-step.js";
import { executePipeline as defaultExecute } from "../runtime/pipeline-runner/runner.js";
import type { TenantAppRegistry } from "../runtime/tenant-app-registry/registry.js";

export interface PipelineCronActionConfig {
  type: "pipeline";
  app: string;
  pipeline: string;
  params: Record<string, unknown>;
  tenantId: string;
}

export interface PipelineCronActionDeps {
  registry: TenantAppRegistry;
  llmDeps: LLMStepDeps;
  executePipeline?: typeof defaultExecute;
}

export function createPipelineCronAction(deps: PipelineCronActionDeps) {
  const execute = deps.executePipeline ?? defaultExecute;

  return async function pipelineCronAction(cfg: PipelineCronActionConfig): Promise<void> {
    const registered = deps.registry.getPipeline(cfg.tenantId, cfg.app, cfg.pipeline);
    if (!registered) {
      {
        throw new Error(
          `pipeline "${cfg.app}/${cfg.pipeline}" not found for tenant "${cfg.tenantId}"`,
        );
      }
    }
    const workspaceDir = resolveAppWorkspaceDir(cfg.tenantId, cfg.app);
    await mkdir(workspaceDir, { recursive: true });
    const result = await execute({
      pipeline: registered,
      input: cfg.params,
      workspaceDir,
      appName: cfg.app,
      tenantId: cfg.tenantId,
      deps: deps.llmDeps,
    });
    if (result.status === "error") {
      {
        throw new Error(`cron pipeline "${cfg.app}/${cfg.pipeline}" failed: ${result.error}`);
      }
    }
  };
}
