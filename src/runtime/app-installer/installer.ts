import { copyFile, mkdtemp, rename, rm, stat, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { resolveTenantSkillsDir } from "../../config/sessions/tenant-paths.js";
import { GitOps } from "../../infra/git-ops/index.js";
import { resolveAppDir, resolveAppWorkspaceDir, resolveTenantAppsRootDir } from "../app-paths.js";
import { loadPipelineYaml } from "../pipeline-runner/yaml-loader.js";
import { readAppManifest } from "./manifest.js";
import { addInstalledApp, removeInstalledApp, readAppsManifest } from "./store.js";

export interface InstallResult {
  name: string;
  version: string;
  appDir: string;
  commit: string;
}

export interface InstallOptions {
  tenantId: string;
  gitUrl: string;
}

export interface UninstallOptions {
  tenantId: string;
  appName: string;
  purgeWorkspace?: boolean;
}

export class AppInstaller {
  private readonly git: GitOps;

  constructor(
    private readonly env: NodeJS.ProcessEnv = process.env,
    git?: GitOps,
  ) {
    this.git = git ?? new GitOps();
  }

  async install(opts: InstallOptions): Promise<InstallResult> {
    // Stage tmpDir under tenant's apps root to avoid EXDEV on Linux
    // (where /tmp is tmpfs and ~/.enclaws is on disk)
    const appsRoot = resolveTenantAppsRootDir(opts.tenantId, this.env);
    await mkdir(appsRoot, { recursive: true });
    const tmpDir = await mkdtemp(path.join(appsRoot, ".install-"));
    await rm(tmpDir, { recursive: true, force: true });

    let movedTarget: string | undefined;
    try {
      // 1. shallow clone
      await this.git.clone(opts.gitUrl, tmpDir, { depth: 1 });

      // 2. manifest
      const manifest = await readAppManifest(tmpDir);

      // 3. soft check: at least one parseable pipeline.yaml (when pipelines/ exists)
      const pipelinesDir = path.join(tmpDir, "pipelines");
      try {
        const entries = await readdir(pipelinesDir);
        if (entries.length > 0) {
          let parsedOne = false;
          for (const entry of entries) {
            try {
              await loadPipelineYaml(path.join(pipelinesDir, entry, "pipeline.yaml"));
              parsedOne = true;
              break;
            } catch {
              // try next
            }
          }
          if (!parsedOne) {
            throw new Error(`no parseable pipeline.yaml found under pipelines/`);
          }
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
        // pipelines/ missing is allowed (skill-only APP)
      }

      // 4. conflict check
      const existing = await readAppsManifest(opts.tenantId, this.env);
      if (existing.installed.find((r) => r.name === manifest.id)) {
        throw new Error(`app "${manifest.id}" already installed for tenant "${opts.tenantId}"`);
      }

      // 5. move tmpDir → apps/<id>/
      const targetDir = resolveAppDir(opts.tenantId, manifest.id, this.env);
      try {
        await stat(targetDir);
        throw new Error(`target directory already exists: ${targetDir}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }
      await mkdir(path.dirname(targetDir), { recursive: true });
      await rename(tmpDir, targetDir);
      movedTarget = targetDir;

      // 6. HEAD commit
      const commit = await this.git.headCommit(targetDir);

      // 7. record in apps.json (outer catch handles rollback via movedTarget)
      await addInstalledApp(
        opts.tenantId,
        {
          name: manifest.id,
          gitUrl: opts.gitUrl,
          commit,
          version: manifest.version,
          apiVersion: manifest.api_version,
          installedAt: new Date().toISOString(),
          workspaceRepo: manifest.workspace_repo,
        },
        this.env,
      );

      // 8. expose SKILL.md to tenant skills directory (for agent runtime to auto-discover)
      await this.exposeAppSkill(opts.tenantId, manifest.id, targetDir);

      return {
        name: manifest.id,
        version: manifest.version,
        appDir: targetDir,
        commit,
      };
    } catch (e) {
      // Cleanup tmpDir and (if partial) moved target
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
      if (movedTarget) {
        await rm(movedTarget, { recursive: true, force: true }).catch(() => {});
      }
      throw e;
    }
  }

  async uninstall(opts: UninstallOptions): Promise<void> {
    await removeInstalledApp(opts.tenantId, opts.appName, this.env);
    const appDir = resolveAppDir(opts.tenantId, opts.appName, this.env);
    await rm(appDir, { recursive: true, force: true });

    // Clear skill exposure on uninstall
    await this.unexposeAppSkill(opts.tenantId, opts.appName);

    if (opts.purgeWorkspace) {
      const wsDir = resolveAppWorkspaceDir(opts.tenantId, opts.appName, this.env);
      await rm(wsDir, { recursive: true, force: true });
    }
  }

  private async exposeAppSkill(tenantId: string, appId: string, appDir: string): Promise<void> {
    const srcSkill = path.join(appDir, "SKILL.md");
    try {
      await stat(srcSkill);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        return; // no SKILL.md → skip silently
      }
      throw e;
    }
    const dstDir = path.join(resolveTenantSkillsDir(tenantId, this.env), appId);
    await mkdir(dstDir, { recursive: true });
    await copyFile(srcSkill, path.join(dstDir, "SKILL.md"));
  }

  private async unexposeAppSkill(tenantId: string, appName: string): Promise<void> {
    const dstDir = path.join(resolveTenantSkillsDir(tenantId, this.env), appName);
    await rm(dstDir, { recursive: true, force: true });
  }
}
