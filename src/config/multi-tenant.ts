import { loadConfig } from "./config.js";

/**
 * Check whether the system is running in multi-tenant mode.
 *
 * Multi-tenant mode is enabled when either:
 * - The `OPENCLAW_MULTI_TENANT` environment variable is set (any truthy value), or
 * - The config file has `gateway.multiTenant.enabled = true`.
 */
export function isMultiTenantMode(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.OPENCLAW_MULTI_TENANT) {
    return true;
  }
  try {
    const cfg = loadConfig();
    return cfg.gateway?.multiTenant?.enabled === true;
  } catch {
    return false;
  }
}
