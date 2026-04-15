import { mkdir, stat, rename } from "node:fs/promises";
import path from "node:path";
import type { AppInstaller } from "../../runtime/app-installer/installer.js";
import {
  setAppCredential,
  getAppCredential,
  buildGitAuthEnv,
} from "../../runtime/app-installer/credentials-store.js";
import { readAppsManifest, updateInstalledApp } from "../../runtime/app-installer/store.js";
import { findTenantByChannelApp } from "../../db/models/tenant-channel-app.js";
import { GitOps } from "../../infra/git-ops/index.js";
import { resolveAppWorkspaceDir, resolveAppWorkspaceBackupDir } from "../../runtime/app-paths.js";
import { logWarn } from "../../logger.js";
import type { LLMStepDeps } from "../../runtime/pipeline-runner/llm-step.js";
import { executePipeline as defaultExecute } from "../../runtime/pipeline-runner/runner.js";
import type { RunnerResult } from "../../runtime/pipeline-runner/types.js";
import type { TenantAppRegistry } from "../../runtime/tenant-app-registry/registry.js";

export interface AppApiConfig {
  registry: TenantAppRegistry;
  installer: AppInstaller;
  llmDeps: LLMStepDeps;
  executePipeline?: typeof defaultExecute;
  env?: NodeJS.ProcessEnv;
}

export interface AppConfigureParams {
  tenantId: string;
  name: string;
  workspaceRepo?: string;
  gitToken?: string;
  gitUser?: string;
  gitEmail?: string;
  feishuAppId?: string;
  feishuAppSecret?: string;
}

/**
 * Core implementation of app.configure. Shared by the RPC handler and the
 * app_configure LLM tool so the bot install flow (feishu form → configure)
 * and the admin console path go through the same logic.
 */
export async function appConfigureImpl(
  params: AppConfigureParams,
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ ok: true }> {
  const { tenantId } = params;
  const appName = params.name;
  if (!appName || !appName.trim()) {
    throw new Error("name required");
  }
  const manifest = await readAppsManifest(tenantId, env);
  if (!manifest.installed.find((a) => a.name === appName)) {
    throw new Error(`app "${appName}" not installed`);
  }

  const pick = (v: unknown): string | undefined =>
    typeof v === "string" && v.trim() ? v.trim() : undefined;
  const gitToken = pick(params.gitToken);
  const gitUser = pick(params.gitUser);
  const gitEmail = pick(params.gitEmail);
  const feishuAppId = pick(params.feishuAppId);
  const feishuAppSecret = pick(params.feishuAppSecret);

  if (gitToken || gitUser || gitEmail || feishuAppId || feishuAppSecret) {
    const existing = await getAppCredential(tenantId, appName, env);
    await setAppCredential(tenantId, appName, {
      gitToken: gitToken ?? existing?.gitToken ?? "",
      gitUser: gitUser ?? existing?.gitUser ?? `${appName}-bot`,
      gitEmail: gitEmail ?? existing?.gitEmail ?? `${appName}-bot@enclaws.local`,
      feishuAppId: feishuAppId ?? existing?.feishuAppId,
      feishuAppSecret: feishuAppSecret ?? existing?.feishuAppSecret,
    }, env);
  }

  const workspaceRepo = pick(params.workspaceRepo);
  if (workspaceRepo) {
    const wsDir = resolveAppWorkspaceDir(tenantId, appName, env);
    const cred = await getAppCredential(tenantId, appName, env);
    const gitEnv = cred ? buildGitAuthEnv(cred) : undefined;
    const git = new GitOps();
    let exists = false;
    try { await stat(wsDir); exists = true; } catch { /* not found */ }

    const backup = async () => {
      const backupDir = resolveAppWorkspaceBackupDir(tenantId, env);
      await mkdir(backupDir, { recursive: true });
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      await rename(wsDir, path.join(backupDir, `${appName}-${timestamp}`));
    };

    if (exists) {
      let currentRemote = "";
      try { currentRemote = await git.getRemoteUrl(wsDir); } catch { /* not a repo */ }
      if (currentRemote && currentRemote === workspaceRepo) {
        logWarn(`app.configure: workspace same remote, pulling: ${wsDir}`);
        await git.pull(wsDir, gitEnv);
      } else if (currentRemote) {
        logWarn(`app.configure: workspace remote changed "${currentRemote}" → "${workspaceRepo}", backing up`);
        await backup();
        await git.clone(workspaceRepo, wsDir, { depth: 1, gitEnv });
      } else {
        logWarn(`app.configure: workspace exists but not a git repo, backing up and cloning`);
        await backup();
        await git.clone(workspaceRepo, wsDir, { depth: 1, gitEnv });
      }
    } else {
      logWarn(`app.configure: cloning workspace repo "${workspaceRepo}" → ${wsDir}`);
      await git.clone(workspaceRepo, wsDir, { depth: 1, gitEnv });
    }
    await updateInstalledApp(tenantId, appName, { workspaceRepo }, env);
  }

  return { ok: true };
}

// oxlint-disable-next-line typescript/no-explicit-any
function requireTenantId(client: any): string {
  // Gateway stores tenant context at client.tenant (set by auth middleware),
  // not client.tenantContext as originally assumed.
  const tenantId = client?.tenant?.tenantId;
  if (!tenantId) {
    throw new Error("tenant context required (missing tenantId)");
  }
  return tenantId;
}

function maskToken(token: string): string {
  if (token.length <= 8) return "****";
  return `${token.slice(0, 4)}${"*".repeat(Math.min(token.length - 8, 20))}${token.slice(-4)}`;
}

export function createAppApiHandlers(cfg: AppApiConfig) {
  const execute = cfg.executePipeline ?? defaultExecute;
  const env = cfg.env ?? process.env;

  return {
    // oxlint-disable-next-line typescript/no-explicit-any
    "app.list": async ({ client }: any) => {
      const tenantId = requireTenantId(client);
      const manifest = await readAppsManifest(tenantId, env);
      const apps = [];
      for (const app of manifest.installed) {
        const cred = await getAppCredential(tenantId, app.name, env);
        const wsDir = resolveAppWorkspaceDir(tenantId, app.name, env);
        let hasWorkspace = false;
        try {
          await stat(wsDir);
          hasWorkspace = true;
        } catch { /* not found */ }
        apps.push({
          name: app.name,
          version: app.version,
          commit: app.commit,
          installedAt: app.installedAt,
          pipelines: cfg.registry.listPipelines(tenantId, app.name).map((p) => p.name),
          hasCredentials: Boolean(cred),
          hasWorkspace,
          workspaceRepo: app.workspaceRepo ?? "",
          gitUser: cred?.gitUser ?? "",
          gitEmail: cred?.gitEmail ?? "",
          gitTokenMasked: cred ? maskToken(cred.gitToken) : "",
          feishuAppId: cred?.feishuAppId ?? "",
          hasFeishuApp: Boolean(cred?.feishuAppId && cred?.feishuAppSecret),
        });
      }
      return { apps };
    },

    // oxlint-disable-next-line typescript/no-explicit-any
    "app.install": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      const gitUrl = params?.gitUrl;
      if (typeof gitUrl !== "string" || !gitUrl.trim()) {
        throw new Error("gitUrl required");
      }
      const workspaceRepo =
        typeof params?.workspaceRepo === "string" ? params.workspaceRepo : undefined;
      const gitToken =
        typeof params?.gitToken === "string" ? params.gitToken : undefined;
      const gitUser =
        typeof params?.gitUser === "string" ? params.gitUser : undefined;
      const gitEmail =
        typeof params?.gitEmail === "string" ? params.gitEmail : undefined;
      const feishuAppId =
        typeof params?.feishuAppId === "string" ? params.feishuAppId : undefined;
      const feishuAppSecret =
        typeof params?.feishuAppSecret === "string" ? params.feishuAppSecret : undefined;
      const result = await cfg.installer.install({
        tenantId, gitUrl, workspaceRepo, gitToken, gitUser, gitEmail,
        feishuAppId, feishuAppSecret,
      });
      await cfg.registry.loadOne(tenantId, result.name);
      return { name: result.name, version: result.version };
    },

    // oxlint-disable-next-line typescript/no-explicit-any
    "app.upgrade": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      const name = params?.name;
      if (typeof name !== "string" || !name.trim()) {
        throw new Error("name required");
      }
      const result = await cfg.installer.upgrade(tenantId, name);
      // Reload pipelines in memory (may have changed)
      await cfg.registry.loadOne(tenantId, result.name);
      return { name: result.name, version: result.version, commit: result.commit };
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
    "app.configure": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      return appConfigureImpl(
        {
          tenantId,
          name: params?.name,
          workspaceRepo: params?.workspaceRepo,
          gitToken: params?.gitToken,
          gitUser: params?.gitUser,
          gitEmail: params?.gitEmail,
          feishuAppId: params?.feishuAppId,
          feishuAppSecret: params?.feishuAppSecret,
        },
        env,
      );
    },

    // oxlint-disable-next-line typescript/no-explicit-any
    "app.invoke": async ({ params, client }: any) => {
      const tenantId = requireTenantId(client);
      const tenantUserId = client?.tenant?.userId;
      const { app: appName, pipeline: pipelineName, params: pipelineParams } = params ?? {};
      if (typeof appName !== "string" || typeof pipelineName !== "string") {
        throw new Error("app and pipeline names required");
      }
      const registered = cfg.registry.getPipeline(tenantId, appName, pipelineName);
      if (!registered) {
        throw new Error(`pipeline "${appName}/${pipelineName}" not found for tenant "${tenantId}"`);
      }

      // Resolve agentId from app's bound feishu app → tenant_channel_apps.agent_id.
      // Feishu bot callers already have agentId in client.tenant (from session ctx);
      // CLI callers don't, so we look up via the APP's feishu credentials.
      let agentId: string | undefined = client?.tenant?.agentId;
      if (!agentId) {
        try {
          const cred = await getAppCredential(tenantId, appName, env);
          if (cred?.feishuAppId) {
            const binding = await findTenantByChannelApp("feishu", cred.feishuAppId);
            if (binding?.tenantId === tenantId) {
              // Load the channel app record to get agent_id
              const { listChannelApps } = await import("../../db/models/tenant-channel-app.js");
              if (binding.channelId) {
                const apps = await listChannelApps(binding.channelId);
                const match = apps.find((a) => a.appId === cred.feishuAppId && a.isActive);
                if (match?.agentId) agentId = match.agentId;
              }
            }
          }
        } catch (e) {
          logWarn(`app.invoke: failed to resolve agentId for ${appName}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      const workspaceDir = resolveAppWorkspaceDir(tenantId, appName, env);
      await mkdir(workspaceDir, { recursive: true });
      const result: RunnerResult = await execute({
        pipeline: registered,
        input: (pipelineParams as Record<string, unknown>) ?? {},
        workspaceDir,
        appName,
        tenantId,
        tenantUserId,
        agentId,
        deps: cfg.llmDeps,
      });
      if (result.status === "error") {
        throw new Error(result.error ?? "pipeline execution failed");
      }
      return result.output;
    },
  };
}
