import { mkdir } from "node:fs/promises";
import { resolveAppWorkspaceDir } from "../app-paths.js";

export class AppWorkspaceManager {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  /** Ensure workspace directory exists; return its absolute path */
  async ensure(tenantId: string, appName: string): Promise<string> {
    const dir = resolveAppWorkspaceDir(tenantId, appName, this.env);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  /** Resolve path without creating the directory */
  resolve(tenantId: string, appName: string): string {
    return resolveAppWorkspaceDir(tenantId, appName, this.env);
  }
}
