import { mkdir } from "node:fs/promises";
import type { AppInstaller } from "../runtime/app-installer/installer.js";
import { readAppsManifest } from "../runtime/app-installer/store.js";
import { resolveAppWorkspaceDir } from "../runtime/app-paths.js";
import type { LLMStepDeps } from "../runtime/pipeline-runner/llm-step.js";
import { executePipeline as defaultExecute } from "../runtime/pipeline-runner/runner.js";
import type { RunnerResult } from "../runtime/pipeline-runner/types.js";
import type { TenantAppRegistry } from "../runtime/tenant-app-registry/registry.js";

/**
 * Minimal shape of an AgentTool compatible with @mariozechner/pi-agent-core.
 * 真实类型由 pi-agent-core 导出；此处写成结构类型以降低耦合。
 */
export interface AppRuntimeAgentTool {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute: (input: Record<string, unknown>) => Promise<unknown>;
}

export interface AppRuntimeDeps {
  registry: TenantAppRegistry;
  installer: AppInstaller;
  llmDeps: LLMStepDeps;
}

export interface CreateAppRuntimeToolsOptions {
  deps: AppRuntimeDeps;
  /**
   * 从 agent session context 取当前 tenantId。
   * 返回 undefined 代表没有 tenant 绑定——这是错误态，工具会 reject。
   */
  resolveTenantId: () => string | undefined;
  /** 测试用依赖注入；生产走默认 */
  executePipeline?: typeof defaultExecute;
}

export function createAppRuntimeTools(opts: CreateAppRuntimeToolsOptions): AppRuntimeAgentTool[] {
  const { deps, resolveTenantId } = opts;
  const execute = opts.executePipeline ?? defaultExecute;

  const requireTenant = (): string => {
    const tid = resolveTenantId();
    if (!tid) {
      throw new Error("app_* tools require a tenant-bound session (tenantId missing)");
    }
    return tid;
  };

  const appList: AppRuntimeAgentTool = {
    name: "app_list",
    description:
      "List APPs installed for the current tenant. Returns each app's name, version, installed time, and exposed pipeline names.",
    schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async execute() {
      const tenantId = requireTenant();
      const manifest = await readAppsManifest(tenantId);
      return {
        apps: manifest.installed.map((app) => ({
          name: app.name,
          version: app.version,
          installedAt: app.installedAt,
          pipelines: deps.registry.listPipelines(tenantId, app.name).map((p) => p.name),
        })),
      };
    },
  };

  const appInstall: AppRuntimeAgentTool = {
    name: "app_install",
    description:
      "Install an APP into the current tenant from a git URL. The APP's SKILL.md will become available to this agent on its next session.",
    schema: {
      type: "object",
      required: ["gitUrl"],
      properties: {
        gitUrl: {
          type: "string",
          description: "Git clone URL (https or ssh) of the APP repository",
        },
      },
      additionalProperties: false,
    },
    async execute(input) {
      const tenantId = requireTenant();
      const gitUrl = String((input.gitUrl as string) ?? "").trim();
      if (!gitUrl) {
        throw new Error("gitUrl required");
      }
      const result = await deps.installer.install({ tenantId, gitUrl });
      await deps.registry.loadOne(tenantId, result.name);
      return { name: result.name, version: result.version };
    },
  };

  const appUninstall: AppRuntimeAgentTool = {
    name: "app_uninstall",
    description:
      "Uninstall an APP from the current tenant. By default the APP's workspace data is preserved; pass purgeWorkspace=true to delete it.",
    schema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", description: "APP id (as shown by app_list)" },
        purgeWorkspace: {
          type: "boolean",
          description: "Also delete app-workspaces/<app>/ (irreversible)",
        },
      },
      additionalProperties: false,
    },
    async execute(input) {
      const tenantId = requireTenant();
      const name = String((input.name as string) ?? "").trim();
      if (!name) {
        throw new Error("name required");
      }
      deps.registry.remove(tenantId, name);
      await deps.installer.uninstall({
        tenantId,
        appName: name,
        purgeWorkspace: Boolean(input.purgeWorkspace),
      });
      return { ok: true };
    },
  };

  const appInvoke: AppRuntimeAgentTool = {
    name: "app_invoke",
    description:
      "Invoke a pipeline from an installed APP. Use app_list first to discover available apps and pipelines. Returns the pipeline's output as a JSON object.",
    schema: {
      type: "object",
      required: ["app", "pipeline"],
      properties: {
        app: { type: "string", description: "APP id (e.g., 'pivot')" },
        pipeline: {
          type: "string",
          description: "Pipeline name exposed by the APP (e.g., 'discuss-read')",
        },
        params: {
          type: "object",
          description: "Pipeline input params as defined by the pipeline's input schema",
        },
      },
      additionalProperties: false,
    },
    async execute(input) {
      const tenantId = requireTenant();
      const appName = String((input.app as string) ?? "");
      const pipelineName = String((input.pipeline as string) ?? "");
      if (!appName || !pipelineName) {
        throw new Error("app and pipeline names required");
      }
      const registered = deps.registry.getPipeline(tenantId, appName, pipelineName);
      if (!registered) {
        throw new Error(`pipeline "${appName}/${pipelineName}" not found for tenant "${tenantId}"`);
      }
      const workspaceDir = resolveAppWorkspaceDir(tenantId, appName);
      await mkdir(workspaceDir, { recursive: true });
      const result: RunnerResult = await execute({
        pipeline: registered,
        input: (input.params as Record<string, unknown>) ?? {},
        workspaceDir,
        appName,
        tenantId,
        deps: deps.llmDeps,
      });
      if (result.status === "error") {
        throw new Error(result.error ?? "pipeline execution failed");
      }
      return result.output;
    },
  };

  return [appList, appInstall, appUninstall, appInvoke];
}
