import {
  getTenantBootstrapContext,
  loadWorkspaceBootstrapFiles,
  type TenantBootstrapContext,
  type WorkspaceBootstrapFile,
} from "./workspace.js";

const cache = new Map<string, WorkspaceBootstrapFile[]>();

export async function getOrLoadBootstrapFiles(params: {
  workspaceDir: string;
  sessionKey: string;
  tenantContext?: TenantBootstrapContext;
}): Promise<WorkspaceBootstrapFile[]> {
  const tenantContext = params.tenantContext ?? getTenantBootstrapContext(params.workspaceDir);

  // Multi-tenant mode: always reload from disk so UI/tool edits take effect immediately
  if (tenantContext) {
    return loadWorkspaceBootstrapFiles(params.workspaceDir, tenantContext);
  }

  const existing = cache.get(params.sessionKey);
  if (existing) {
    return existing;
  }

  const files = await loadWorkspaceBootstrapFiles(params.workspaceDir, tenantContext);
  cache.set(params.sessionKey, files);
  return files;
}

export function clearBootstrapSnapshot(sessionKey: string): void {
  cache.delete(sessionKey);
}

export function clearAllBootstrapSnapshots(): void {
  cache.clear();
}
