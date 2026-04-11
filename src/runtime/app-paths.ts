import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export function resolveTenantAppsRootDir(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "tenants", tenantId, "apps");
}

export function resolveAppDir(
  tenantId: string,
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantAppsRootDir(tenantId, env), appName);
}

export function resolveTenantAppWorkspacesRootDir(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "tenants", tenantId, "app-workspaces");
}

export function resolveAppWorkspaceDir(
  tenantId: string,
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveTenantAppWorkspacesRootDir(tenantId, env), appName);
}

export function resolveTenantAppsManifestPath(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "tenants", tenantId, "apps.json");
}
