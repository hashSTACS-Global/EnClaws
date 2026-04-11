import { mkdtemp, rename, rm, stat, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { GitOps } from "../../infra/git-ops/index.js";
import { resolveAppDir, resolveAppWorkspaceDir } from "../app-paths.js";
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
    // mkdtemp creates the dir; git clone needs the target NOT to exist
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "enclaws-app-install-"));
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

      // 7. record in apps.json
      try {
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
      } catch (e) {
        // rollback: remove the app dir
        await rm(targetDir, { recursive: true, force: true });
        movedTarget = undefined;
        throw e;
      }

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
    if (opts.purgeWorkspace) {
      const wsDir = resolveAppWorkspaceDir(opts.tenantId, opts.appName, this.env);
      await rm(wsDir, { recursive: true, force: true });
    }
  }
}
