import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { appConfigureImpl } from "../gateway/server-methods/app-api.js";
import type { AppInstaller } from "../runtime/app-installer/installer.js";
import { getAppCredential } from "../runtime/app-installer/credentials-store.js";
import { readAppsManifest } from "../runtime/app-installer/store.js";
import { resolveAppDir, resolveAppWorkspaceDir } from "../runtime/app-paths.js";
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
  env?: NodeJS.ProcessEnv;
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

const BOT_INSTALL_START = "<!-- ENCLAWS-BOT-INSTALL-START -->";
const BOT_INSTALL_END = "<!-- ENCLAWS-BOT-INSTALL-END -->";

/**
 * Read the APP's README and extract the `ENCLAWS-BOT-INSTALL` protocol
 * section. The section is LLM-targeted install guidance (phases to walk
 * through after `app_install`, e.g. collecting workspaceRepo via a Feishu
 * form and calling `app_configure`).
 *
 * Returns undefined when README is missing or markers are absent so the
 * tool result stays clean.
 */
async function extractBotInstallProtocol(
  tenantId: string,
  appName: string,
  env: NodeJS.ProcessEnv,
): Promise<string | undefined> {
  const appDir = resolveAppDir(tenantId, appName, env);
  for (const fname of ["README.md", "README_zh.md"]) {
    try {
      const content = await readFile(path.join(appDir, fname), "utf8");
      const startIdx = content.indexOf(BOT_INSTALL_START);
      const endIdx = content.indexOf(BOT_INSTALL_END);
      if (startIdx >= 0 && endIdx > startIdx) {
        return content.slice(startIdx + BOT_INSTALL_START.length, endIdx).trim();
      }
    } catch { /* missing file — try next */ }
  }
  return undefined;
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
  const env = deps.env ?? process.env;
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
      "List APPs installed for the current tenant. Each entry reports pipelines plus " +
      "`installComplete` / `needsConfigure` flags so you can tell which APPs still " +
      "need `app_configure` to be called before their pipelines can run.",
    parameters: Type.Object({}),
    async execute() {
      const tenantId = requireTenant();
      const manifest = await readAppsManifest(tenantId, env);
      const apps = await Promise.all(
        manifest.installed.map(async (app) => {
          const cred = await getAppCredential(tenantId, app.name, env);
          const wsDir = resolveAppWorkspaceDir(tenantId, app.name, env);
          let hasWorkspace = false;
          try { await stat(wsDir); hasWorkspace = true; } catch { /* not found */ }
          const installComplete = Boolean(cred) && hasWorkspace;
          return {
            name: app.name,
            version: app.version,
            installedAt: app.installedAt,
            pipelines: deps.registry.listPipelines(tenantId, app.name).map((p) => p.name),
            installComplete,
            needsConfigure: !installComplete,
          };
        }),
      );
      return jsonResult({ apps });
    },
  };

  const appInstall: AnyAgentTool = {
    label: "App Install",
    name: "app_install",
    ownerOnly: true,
    description: [
      "Install an APP into the current tenant from a git URL.",
      "",
      "After this tool returns, the APP code is registered but the APP is NOT yet usable.",
      "If the response contains a `botInstallProtocol` field, you MUST follow the phases",
      "described there BEFORE telling the user the install is complete — typically that",
      "means calling `feishu_ask_user_question` to collect workspaceRepo / gitToken, then",
      "`app_configure` to persist credentials and clone the workspace repo.",
      "",
      "Do NOT declare success until `app_configure` returns ok. If `botInstallProtocol`",
      "is absent, fall back to asking the user what workspace repo and git token to use",
      "and call `app_configure` accordingly.",
    ].join("\n"),
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
      const botInstallProtocol = await extractBotInstallProtocol(tenantId, result.name, env);
      return jsonResult({
        name: result.name,
        version: result.version,
        ...(botInstallProtocol ? { botInstallProtocol } : {}),
        nextSteps: botInstallProtocol
          ? "Follow the phases in botInstallProtocol before declaring the install complete."
          : "Collect workspaceRepo and gitToken from the user (e.g. via feishu_ask_user_question) and call app_configure.",
      });
    },
  };

  const appConfigure: AnyAgentTool = {
    label: "App Configure",
    name: "app_configure",
    ownerOnly: true,
    description:
      "Configure an installed APP: persist git credentials and clone its workspace repo. " +
      "Call this AFTER `app_install` and AFTER collecting workspaceRepo / gitToken from the " +
      "user (typically via `feishu_ask_user_question`). The APP's pipelines cannot run until " +
      "this tool returns successfully.",
    parameters: Type.Object({
      name: Type.String({ description: "APP id (as shown by app_list, e.g. 'pivot')" }),
      workspaceRepo: Type.Optional(Type.String({ description: "Workspace data repo URL" })),
      gitToken: Type.Optional(Type.String({ description: "Git token (HTTPS PAT) for commit/push" })),
      gitUser: Type.Optional(Type.String({ description: "Git committer name (default: '<name>-bot')" })),
      gitEmail: Type.Optional(Type.String({ description: "Git committer email (default: '<name>-bot@enclaws.local')" })),
    }),
    async execute(_toolCallId, args) {
      const tenantId = requireTenant();
      const params = args as Record<string, unknown>;
      const name = String(params.name ?? "").trim();
      if (!name) throw new Error("name required");
      await appConfigureImpl(
        {
          tenantId,
          name,
          workspaceRepo: params.workspaceRepo as string | undefined,
          gitToken: params.gitToken as string | undefined,
          gitUser: params.gitUser as string | undefined,
          gitEmail: params.gitEmail as string | undefined,
        },
        env,
      );
      return jsonResult({ ok: true, name });
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
      // Pre-flight: credentials + workspace must be in place. Raw fs / git
      // errors from pipeline steps don't tell the LLM to re-run configure.
      const cred = await getAppCredential(tenantId, appName, env);
      const workspaceDir = resolveAppWorkspaceDir(tenantId, appName, env);
      let hasWorkspace = false;
      try { await stat(workspaceDir); hasWorkspace = true; } catch { /* not found */ }
      if (!cred || !hasWorkspace) {
        throw new Error(
          `APP "${appName}" is installed but not configured (missing ` +
            `${!cred ? "credentials" : ""}${!cred && !hasWorkspace ? " and " : ""}${!hasWorkspace ? "workspace" : ""}). ` +
            `Call app_configure with workspaceRepo and gitToken first — typically collect these ` +
            `from the user via feishu_ask_user_question.`,
        );
      }
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

  return [appList, appInstall, appConfigure, appUninstall, appInvoke];
}
