import { mkdir } from "node:fs/promises";
import type { AppInstaller } from "../../runtime/app-installer/installer.js";
import { readAppsManifest } from "../../runtime/app-installer/store.js";
import { resolveAppWorkspaceDir } from "../../runtime/app-paths.js";
import type { LLMStepDeps } from "../../runtime/pipeline-runner/llm-step.js";
import { executePipeline as defaultExecute } from "../../runtime/pipeline-runner/runner.js";
import type { RunnerResult } from "../../runtime/pipeline-runner/types.js";
import type { TenantAppRegistry } from "../../runtime/tenant-app-registry/registry.js";

export interface AppApiConfig {
  registry: TenantAppRegistry;
  installer: AppInstaller;
  llmDeps: LLMStepDeps;
  executePipeline?: typeof defaultExecute;
}

// oxlint-disable-next-line typescript/no-explicit-any
function requireTenantId(client: any): string {
  const tenantId = client?.tenantContext?.tenantId;
  if (!tenantId) {
    throw new Error("tenant context required (missing tenantId)");
  }
  return tenantId;
}

export function createAppApiHandlers(cfg: AppApiConfig) {
  const execute = cfg.executePipeline ?? defaultExecute;

  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    "app.list": async ({ client }: any) => {
      const tenantId = requireTenantId(client);
      const manifest = await readAppsManifest(tenantId);
      return {
        apps: manifest.installed.map((app) => ({
          name: app.name,
          version: app.version,
          installedAt: app.installedAt,
          pipelines: cfg.registry.listPipelines(tenantId, app.name).map((p) => p.name),
        })),
      };
    },

    // oxlint-disable-next-line typescript/no-explicit-any
    "app.install": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      const gitUrl = params?.gitUrl;
      if (typeof gitUrl !== "string" || !gitUrl.trim()) {
        throw new Error("gitUrl required");
      }
      const result = await cfg.installer.install({ tenantId, gitUrl });
      await cfg.registry.loadOne(tenantId, result.name);
      return { name: result.name, version: result.version };
    },

    // oxlint-disable-next-line typescript/no-explicit-any
    "app.uninstall": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      const { name, purgeWorkspace } = params ?? {};
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name required");
      }
      cfg.registry.remove(tenantId, name);
      await cfg.installer.uninstall({
        tenantId,
        appName: name,
        purgeWorkspace: Boolean(purgeWorkspace),
      });
      return { ok: true };
    },

    // oxlint-disable-next-line typescript/no-explicit-any
    "app.invoke": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      const { app: appName, pipeline: pipelineName, params: pipelineParams } = params ?? {};
      if (typeof appName !== "string" || typeof pipelineName !== "string") {
        throw new Error("app and pipeline names required");
      }
      const registered = cfg.registry.getPipeline(tenantId, appName, pipelineName);
      if (!registered) {
        throw new Error(`pipeline "${appName}/${pipelineName}" not found for tenant "${tenantId}"`);
      }
      const workspaceDir = resolveAppWorkspaceDir(tenantId, appName);
      await mkdir(workspaceDir, { recursive: true });
      const result: RunnerResult = await execute({
        pipeline: registered,
        input: (pipelineParams as Record<string, unknown>) ?? {},
        workspaceDir,
        appName,
        tenantId,
        deps: cfg.llmDeps,
      });
      if (result.status === "error") {
        throw new Error(result.error ?? "pipeline execution failed");
      }
      return result.output;
    },
  };
}
