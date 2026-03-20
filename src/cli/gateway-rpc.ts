import type { Command } from "commander";
import { callGateway } from "../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../utils/message-channel.js";
import { withProgress } from "./progress.js";

export type GatewayRpcOpts = {
  url?: string;
  token?: string;
  timeout?: string;
  expectFinal?: boolean;
  json?: boolean;
};

export function addGatewayClientOptions(cmd: Command) {
  return cmd
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--timeout <ms>", "Timeout in ms", "30000")
    .option("--expect-final", "Wait for final response (agent)", false);
}

/**
 * Resolve tenant params from environment variables injected by the embedded
 * agent runner when executing inside a tenant-scoped agent session. Returns
 * `_tenantId` and `_tenantUserId` if both are set, so the gateway can route
 * cron operations to the correct tenant store.
 */
function resolveTenantParamsFromEnv(): Record<string, string> {
  const tenantId = process.env.OPENCLAW_TENANT_ID?.trim();
  const tenantUserId = process.env.OPENCLAW_TENANT_USER_ID?.trim();
  if (tenantId && tenantUserId) {
    return { _tenantId: tenantId, _tenantUserId: tenantUserId };
  }
  return {};
}

export async function callGatewayFromCli(
  method: string,
  opts: GatewayRpcOpts,
  params?: unknown,
  extra?: { expectFinal?: boolean; progress?: boolean },
) {
  const showProgress = extra?.progress ?? opts.json !== true;
  // Inject tenant context into cron/wake operations when running inside a tenant agent session.
  const isCronMethod =
    method === "cron.add" ||
    method === "cron.update" ||
    method === "cron.remove" ||
    method === "cron.run" ||
    method === "cron.runs" ||
    method === "cron.list" ||
    method === "cron.status" ||
    method === "wake";
  const tenantParams = isCronMethod ? resolveTenantParamsFromEnv() : {};
  const effectiveParams =
    isCronMethod && Object.keys(tenantParams).length > 0 && params !== null && params !== undefined
      ? { ...(params as Record<string, unknown>), ...tenantParams }
      : params;
  return await withProgress(
    {
      label: `Gateway ${method}`,
      indeterminate: true,
      enabled: showProgress,
    },
    async () =>
      await callGateway({
        url: opts.url,
        token: opts.token,
        method,
        params: effectiveParams,
        expectFinal: extra?.expectFinal ?? Boolean(opts.expectFinal),
        timeoutMs: Number(opts.timeout ?? 10_000),
        clientName: GATEWAY_CLIENT_NAMES.CLI,
        mode: GATEWAY_CLIENT_MODES.CLI,
      }),
  );
}
