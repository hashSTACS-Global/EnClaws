import { readdir } from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import { logError } from "../../logger.js";
import { readAppsManifest } from "../app-installer/store.js";
import { resolveAppDir } from "../app-paths.js";
import { PipelineRegistry } from "../pipeline-runner/registry.js";
import type { RegisteredPipeline } from "../pipeline-runner/registry.js";

export class TenantAppRegistry {
  private readonly byTenant = new Map<string, Map<string, PipelineRegistry>>();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** Scan $STATE/tenants/* and call loadTenant for each found tenant. */
  async loadAll(): Promise<void> {
    const tenantsRoot = path.join(resolveStateDir(this.env), "tenants");
    let tenants: string[];
    try {
      tenants = await readdir(tenantsRoot);
    } catch {
      return;
    }
    for (const tenantId of tenants) {
      try {
        await this.loadTenant(tenantId);
      } catch (e) {
        logError(
          `tenant-app-registry: failed to load tenant "${tenantId}": ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
  }

  /** Rebuild a tenant's registry from its apps.json. */
  async loadTenant(tenantId: string): Promise<void> {
    const manifest = await readAppsManifest(tenantId, this.env);
    const appMap = new Map<string, PipelineRegistry>();
    for (const app of manifest.installed) {
      const appDir = resolveAppDir(tenantId, app.name, this.env);
      const registry = new PipelineRegistry();
      try {
        await registry.loadFromApp(appDir);
        appMap.set(app.name, registry);
      } catch (e) {
        logError(
          `tenant-app-registry: failed to load pipelines for ${tenantId}/${app.name}: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }
    this.byTenant.set(tenantId, appMap);
  }

  /** Incrementally load a single APP from disk after install (side effect). */
  async loadOne(tenantId: string, appName: string): Promise<void> {
    const appDir = resolveAppDir(tenantId, appName, this.env);
    const registry = new PipelineRegistry();
    await registry.loadFromApp(appDir);
    let appMap = this.byTenant.get(tenantId);
    if (!appMap) {
      appMap = new Map();
      this.byTenant.set(tenantId, appMap);
    }
    appMap.set(appName, registry);
  }

  /** Remove a single APP from the in-memory registry on uninstall. */
  remove(tenantId: string, appName: string): void {
    this.byTenant.get(tenantId)?.delete(appName);
  }

  getPipeline(
    tenantId: string,
    appName: string,
    pipelineName: string,
  ): RegisteredPipeline | undefined {
    return this.byTenant.get(tenantId)?.get(appName)?.get(pipelineName);
  }

  listApps(tenantId: string): string[] {
    return Array.from(this.byTenant.get(tenantId)?.keys() ?? []);
  }

  listPipelines(tenantId: string, appName: string): RegisteredPipeline[] {
    return this.byTenant.get(tenantId)?.get(appName)?.list() ?? [];
  }
}
