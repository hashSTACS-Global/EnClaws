import { mkdir } from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { AppInstaller } from "../runtime/app-installer/installer.js";
import { readAppsManifest } from "../runtime/app-installer/store.js";
import { resolveAppWorkspaceDir } from "../runtime/app-paths.js";
import type { LLMStepDeps } from "../runtime/pipeline-runner/llm-step.js";
import { executePipeline as defaultExecute } from "../runtime/pipeline-runner/runner.js";
import type { RunnerResult } from "../runtime/pipeline-runner/types.js";
import type { TenantAppRegistry } from "../runtime/tenant-app-registry/registry.js";
import type { AnyAgentTool } from "./tools/common.js";
import { jsonResult } from "./tools/common.js";

export interface AppRuntimeDeps {
  registry: TenantAppRegistry;
  installer: AppInstaller;
  llmDeps: LLMStepDeps;
}

export interface CreateAppRuntimeToolsOptions {
  deps: AppRuntimeDeps;
  resolveTenantId: () => string | undefined;
  /** Resolve the current tenant user ID (UUID). Used to inject PIVOT_USER_ID via displayName lookup. */
  resolveTenantUserId?: () => string | undefined;
  /** Resolve the current agent ID. Used by llm-step to pick the agent's default model. */
  resolveAgentId?: () => string | undefined;
  executePipeline?: typeof defaultExecute;
}

function buildAppInvokeDescription(deps: AppRuntimeDeps, tenantId: string): string {
  const lines = [
    "Invoke a pipeline from an installed APP. Returns the pipeline's output as JSON.",
    "",
    "Available apps and pipelines:",
  ];
  try {
    const appNames = deps.registry.listApps(tenantId);
    for (const appName of appNames) {
      const pipelines = deps.registry.listPipelines(tenantId, appName);
      const pipelineList = pipelines.map((p) => {
        const desc = p.definition?.description;
        let line = desc ? `    - ${p.name}: ${desc}` : `    - ${p.name}`;
        const input = p.definition?.input;
        if (input && typeof input === "object" && Object.keys(input).length > 0) {
          const params = Object.entries(input).map(([k, v]) => `${k}(${v})`).join(", ");
          line += `\n        input: ${params}`;
        }
        return line;
      }).join("\n");
      lines.push(`  app="${appName}":`);
      lines.push(pipelineList);
    }
  } catch {
    lines.push("  (use app_list to discover available apps)");
  }
  return lines.join("\n");
}

export function createAppRuntimeTools(opts: CreateAppRuntimeToolsOptions): AnyAgentTool[] {
  const { deps, resolveTenantId } = opts;
  const execute = opts.executePipeline ?? defaultExecute;

  const requireTenant = (): string => {
    const tid = resolveTenantId();
    if (!tid) {
      throw new Error("app_* tools require a tenant-bound session (tenantId missing)");
    }
    return tid;
  };

  const appList: AnyAgentTool = {
    label: "App List",
    name: "app_list",
    description:
      "List APPs installed for the current tenant. Returns each app's name, version, installed time, and exposed pipeline names.",
    parameters: Type.Object({}),
    async execute() {
      const tenantId = requireTenant();
      const manifest = await readAppsManifest(tenantId);
      return jsonResult({
        apps: manifest.installed.map((app) => ({
          name: app.name,
          version: app.version,
          installedAt: app.installedAt,
          pipelines: deps.registry.listPipelines(tenantId, app.name).map((p) => p.name),
        })),
      });
    },
  };

  const appInstall: AnyAgentTool = {
    label: "App Install",
    name: "app_install",
    ownerOnly: true,
    description:
      "Install an APP into the current tenant from a git URL.",
    parameters: Type.Object({
      gitUrl: Type.String({ description: "Git clone URL of the APP repository" }),
    }),
    async execute(_toolCallId, args) {
      const tenantId = requireTenant();
      const params = args as Record<string, unknown>;
      const gitUrl = String(params.gitUrl ?? "").trim();
      if (!gitUrl) throw new Error("gitUrl required");
      const result = await deps.installer.install({ tenantId, gitUrl });
      await deps.registry.loadOne(tenantId, result.name);
      return jsonResult({ name: result.name, version: result.version });
    },
  };

  const appUninstall: AnyAgentTool = {
    label: "App Uninstall",
    name: "app_uninstall",
    ownerOnly: true,
    description:
      "Uninstall an APP from the current tenant.",
    parameters: Type.Object({
      name: Type.String({ description: "APP id (as shown by app_list)" }),
      purgeWorkspace: Type.Optional(Type.Boolean({ description: "Also delete workspace data" })),
    }),
    async execute(_toolCallId, args) {
      const tenantId = requireTenant();
      const params = args as Record<string, unknown>;
      const name = String(params.name ?? "").trim();
      if (!name) throw new Error("name required");
      deps.registry.remove(tenantId, name);
      await deps.installer.uninstall({
        tenantId,
        appName: name,
        purgeWorkspace: Boolean(params.purgeWorkspace),
      });
      return jsonResult({ ok: true });
    },
  };

  const tenantIdForDesc = resolveTenantId();
  const invokeDesc = tenantIdForDesc
    ? buildAppInvokeDescription(deps, tenantIdForDesc)
    : "Invoke a pipeline from an installed APP. Returns the pipeline's output as JSON.";
  const appInvoke: AnyAgentTool = {
    label: "App Invoke",
    name: "app_invoke",
    description: invokeDesc,
    parameters: Type.Object({
      app: Type.String({ description: "APP id (e.g., 'pivot')" }),
      pipeline: Type.String({ description: "Pipeline name (e.g., 'discuss-list')" }),
      params: Type.Optional(Type.Record(Type.String(), Type.Unknown(), {
        description: "Pipeline input params",
      })),
    }),
    async execute(_toolCallId, args) {
      const tenantId = requireTenant();
      const input = args as Record<string, unknown>;
      const appName = String(input.app ?? "");
      const pipelineName = String(input.pipeline ?? "");
      if (!appName || !pipelineName) {
        throw new Error("app and pipeline names required");
      }
      const registered = deps.registry.getPipeline(tenantId, appName, pipelineName);
      if (!registered) {
        throw new Error(`pipeline "${appName}/${pipelineName}" not found for tenant "${tenantId}"`);
      }
      const workspaceDir = resolveAppWorkspaceDir(tenantId, appName);
      await mkdir(workspaceDir, { recursive: true });
      const tenantUserId = opts.resolveTenantUserId?.();
      const agentId = opts.resolveAgentId?.();
      const result: RunnerResult = await execute({
        pipeline: registered,
        input: (input.params as Record<string, unknown>) ?? {},
        workspaceDir,
        appName,
        tenantId,
        tenantUserId,
        agentId,
        deps: deps.llmDeps,
      });
      if (result.status === "error") {
        throw new Error(result.error ?? "pipeline execution failed");
      }
      return jsonResult(result.output);
    },
  };

  return [appList, appInstall, appUninstall, appInvoke];
}
