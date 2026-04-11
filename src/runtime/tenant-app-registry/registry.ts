import { logError } from "../../logger.js";
import { readAppsManifest } from "../app-installer/store.js";
import { resolveAppDir } from "../app-paths.js";
import { PipelineRegistry } from "../pipeline-runner/registry.js";

export class TenantAppRegistry {
  private byTenant = new Map<string, Map<string, PipelineRegistry>>();

  async loadTenant(tenantId: string): Promise<void> {
    if (this.byTenant.has(tenantId)) {
      return; // Already loaded
    }

    const appsByName = new Map<string, PipelineRegistry>();

    let manifest;
    try {
      manifest = await readAppsManifest(tenantId);
    } catch (e) {
      logError(
        `tenant-app-registry: failed to load tenant "${tenantId}": ${e instanceof Error ? e.message : String(e)}`,
      );
      return;
    }

    for (const app of manifest.installed) {
      const appDir = resolveAppDir(tenantId, app.name);
      const registry = new PipelineRegistry();

      try {
        await registry.loadFromApp(appDir);
      } catch (e) {
        logError(
          `tenant-app-registry: failed to load pipelines for ${tenantId}/${app.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
        continue;
      }

      appsByName.set(app.name, registry);
    }

    this.byTenant.set(tenantId, appsByName);
  }

  async loadAll(tenantIds: string[]): Promise<void> {
    for (const tenantId of tenantIds) {
      await this.loadTenant(tenantId);
    }
  }

  loadOne(tenantId: string, appName: string): PipelineRegistry | undefined {
    const apps = this.byTenant.get(tenantId);
    if (!apps) {
      return undefined;
    }
    return apps.get(appName);
  }

  remove(tenantId: string): void {
    this.byTenant.delete(tenantId);
  }

  getPipeline(
    tenantId: string,
    appName: string,
    pipelineName: string,
  ):
    | {
        dir: string;
        definition: {
          name: string;
          [key: string]: unknown;
        };
      }
    | undefined {
    const registry = this.loadOne(tenantId, appName);
    if (!registry) {
      return undefined;
    }
    return registry.get(pipelineName);
  }
}
