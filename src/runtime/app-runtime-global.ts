/**
 * Global accessor for the APP runtime dependencies.
 *
 * Set once during gateway startup (server.impl.ts), read by the agent
 * runner (get-reply-run.ts) to inject app_* tools into Pi sessions.
 */
import type { CreateAppRuntimeToolsOptions } from "../agents/pi-tools-app-runtime.js";

let globalAppRuntime: CreateAppRuntimeToolsOptions | undefined;

export function setGlobalAppRuntime(runtime: CreateAppRuntimeToolsOptions): void {
  globalAppRuntime = runtime;
}

export function getGlobalAppRuntime(): CreateAppRuntimeToolsOptions | undefined {
  return globalAppRuntime;
}
