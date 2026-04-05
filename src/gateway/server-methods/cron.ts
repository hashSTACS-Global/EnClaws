import { normalizeCronJobCreate, normalizeCronJobPatch } from "../../cron/normalize.js";
import {
  readCronRunLogEntriesPage,
  readCronRunLogEntriesPageAll,
  resolveCronRunLogPath,
} from "../../cron/run-log.js";
import type { CronJobCreate, CronJobPatch } from "../../cron/types.js";
import { validateScheduleTimestamp } from "../../cron/validate-timestamp.js";
import {
  ErrorCodes,
  errorShape,
  formatValidationErrors,
  validateCronAddParams,
  validateCronListParams,
  validateCronRemoveParams,
  validateCronRunParams,
  validateCronRunsParams,
  validateCronStatusParams,
  validateCronUpdateParams,
  validateWakeParams,
} from "../protocol/index.js";
import type { GatewayClient, GatewayRequestContext, GatewayRequestHandlers } from "./types.js";

/**
 * Resolve the effective cron service and store path for a request.
 * If the client has a tenant context and a tenant-scoped resolver is available,
 * returns the tenant-scoped cron; otherwise falls back to the global cron.
 *
 * When the internal gateway connection does not carry a JWT (e.g. agent tool
 * calls via the local WebSocket), tenant info may be passed as `_tenantId` /
 * `_tenantUserId` inside the request params. This fallback allows the cron
 * tool to reach the correct tenant-scoped store without requiring a full
 * authenticated client context.
 */
function resolveEffectiveCron(
  context: GatewayRequestContext,
  client: GatewayClient | null,
  params?: Record<string, unknown>,
): { cron: typeof context.cron; cronStorePath: string } {
  // Primary path: client already carries a tenant context (JWT-authenticated).
  if (client?.tenant && context.resolveTenantCron) {
    context.logGateway.info(`resolveEffectiveCron: using client.tenant userId=${client.tenant.userId}`);
    const resolved = context.resolveTenantCron(client.tenant);
    if (resolved) {return resolved;}
  }
  // Fallback: extract tenant info from params (injected by cron-tool.ts).
  if (context.resolveTenantCron && params) {
    const tenantId = typeof params._tenantId === "string" ? params._tenantId.trim() : "";
    const userId = typeof params._tenantUserId === "string" ? params._tenantUserId.trim() : "";
    context.logGateway.info(`resolveEffectiveCron: params._tenantId=${tenantId || "(empty)"} params._tenantUserId=${userId || "(empty)"} hasResolveTenantCron=${!!context.resolveTenantCron}`);
    if (tenantId && userId) {
      const resolved = context.resolveTenantCron({ tenantId, userId });
      if (resolved) {return resolved;}
    }
  } else {
    context.logGateway.info(`resolveEffectiveCron: fallback to global cron (resolveTenantCron=${!!context.resolveTenantCron}, params=${!!params}, paramKeys=${params ? Object.keys(params).join(",") : "none"})`);
  }
  return { cron: context.cron, cronStorePath: context.cronStorePath };
}

/**
 * Strip internal tenant params (`_tenantId`, `_tenantUserId`) from the
 * request params so they don't trip `additionalProperties: false` in the
 * protocol validators.  The original `params` object is returned unmodified
 * (the tenant fields are read from it by `resolveEffectiveCron`).
 */
function stripTenantParams(params: Record<string, unknown>): Record<string, unknown> {
  if (!("_tenantId" in params) && !("_tenantUserId" in params)) {
    return params;
  }
  const { _tenantId: _, _tenantUserId: __, ...rest } = params;
  return rest;
}

export const cronHandlers: GatewayRequestHandlers = {
  wake: ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    if (!validateWakeParams(cleaned)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid wake params: ${formatValidationErrors(validateWakeParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      mode: "now" | "next-heartbeat";
      text: string;
    };
    const { cron } = resolveEffectiveCron(context, client, params);
    const result = cron.wake({ mode: p.mode, text: p.text });
    respond(true, result, undefined);
  },
  "cron.list": async ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    if (!validateCronListParams(cleaned)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.list params: ${formatValidationErrors(validateCronListParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      includeDisabled?: boolean;
      limit?: number;
      offset?: number;
      query?: string;
      enabled?: "all" | "enabled" | "disabled";
      sortBy?: "nextRunAtMs" | "updatedAtMs" | "name";
      sortDir?: "asc" | "desc";
    };
    const { cron } = resolveEffectiveCron(context, client, params);
    const page = await cron.listPage({
      includeDisabled: p.includeDisabled,
      limit: p.limit,
      offset: p.offset,
      query: p.query,
      enabled: p.enabled,
      sortBy: p.sortBy,
      sortDir: p.sortDir,
    });
    respond(true, page, undefined);
  },
  "cron.status": async ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    if (!validateCronStatusParams(cleaned)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.status params: ${formatValidationErrors(validateCronStatusParams.errors)}`,
        ),
      );
      return;
    }
    const { cron } = resolveEffectiveCron(context, client, params);
    const status = await cron.status();
    respond(true, status, undefined);
  },
  "cron.add": async ({ params, respond, context, client }) => {
    context.logGateway.info(`cron.add: received params keys=${Object.keys(params).join(",")} _tenantId=${(params as any)._tenantId || "(missing)"} _tenantUserId=${(params as any)._tenantUserId || "(missing)"} hasClient=${!!client} connId=${client?.connId || "(none)"} clientName=${client?.connect?.name || "(none)"} clientTenant=${client?.tenant ? JSON.stringify(client.tenant) : "(none)"}`);
    const cleaned = stripTenantParams(params);
    const normalized = normalizeCronJobCreate(cleaned) ?? cleaned;
    if (!validateCronAddParams(normalized)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.add params: ${formatValidationErrors(validateCronAddParams.errors)}`,
        ),
      );
      return;
    }
    const jobCreate = normalized as unknown as CronJobCreate;
    const timestampValidation = validateScheduleTimestamp(jobCreate.schedule);
    if (!timestampValidation.ok) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
      );
      return;
    }
    const { cron, cronStorePath } = resolveEffectiveCron(context, client, params);
    const job = await cron.add(jobCreate);
    context.logGateway.info("cron: job created", { jobId: job.id, schedule: jobCreate.schedule, storePath: cronStorePath });
    respond(true, job, undefined);
  },
  "cron.update": async ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    const normalizedPatch = normalizeCronJobPatch((cleaned as { patch?: unknown } | null)?.patch);
    const candidate =
      normalizedPatch && typeof cleaned === "object" && cleaned !== null
        ? { ...cleaned, patch: normalizedPatch }
        : cleaned;
    if (!validateCronUpdateParams(candidate)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.update params: ${formatValidationErrors(validateCronUpdateParams.errors)}`,
        ),
      );
      return;
    }
    const p = candidate as {
      id?: string;
      jobId?: string;
      patch: Record<string, unknown>;
    };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.update params: missing id"),
      );
      return;
    }
    const patch = p.patch as unknown as CronJobPatch;
    if (patch.schedule) {
      const timestampValidation = validateScheduleTimestamp(patch.schedule);
      if (!timestampValidation.ok) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, timestampValidation.message),
        );
        return;
      }
    }
    const { cron } = resolveEffectiveCron(context, client, params);
    const job = await cron.update(jobId, patch);
    context.logGateway.info("cron: job updated", { jobId });
    respond(true, job, undefined);
  },
  "cron.remove": async ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    if (!validateCronRemoveParams(cleaned)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.remove params: ${formatValidationErrors(validateCronRemoveParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.remove params: missing id"),
      );
      return;
    }
    const { cron } = resolveEffectiveCron(context, client, params);
    const result = await cron.remove(jobId);
    if (result.removed) {
      context.logGateway.info("cron: job removed", { jobId });
    }
    respond(true, result, undefined);
  },
  "cron.run": async ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    if (!validateCronRunParams(cleaned)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.run params: ${formatValidationErrors(validateCronRunParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as { id?: string; jobId?: string; mode?: "due" | "force" };
    const jobId = p.id ?? p.jobId;
    if (!jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.run params: missing id"),
      );
      return;
    }
    const { cron } = resolveEffectiveCron(context, client, params);
    const result = await cron.run(jobId, p.mode ?? "force");
    respond(true, result, undefined);
  },
  "cron.runs": async ({ params, respond, context, client }) => {
    const cleaned = stripTenantParams(params);
    if (!validateCronRunsParams(cleaned)) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `invalid cron.runs params: ${formatValidationErrors(validateCronRunsParams.errors)}`,
        ),
      );
      return;
    }
    const p = params as {
      scope?: "job" | "all";
      id?: string;
      jobId?: string;
      limit?: number;
      offset?: number;
      statuses?: Array<"ok" | "error" | "skipped">;
      status?: "all" | "ok" | "error" | "skipped";
      deliveryStatuses?: Array<"delivered" | "not-delivered" | "unknown" | "not-requested">;
      deliveryStatus?: "delivered" | "not-delivered" | "unknown" | "not-requested";
      query?: string;
      sortDir?: "asc" | "desc";
    };
    const explicitScope = p.scope;
    const jobId = p.id ?? p.jobId;
    const scope: "job" | "all" = explicitScope ?? (jobId ? "job" : "all");
    if (scope === "job" && !jobId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: missing id"),
      );
      return;
    }
    const { cron, cronStorePath } = resolveEffectiveCron(context, client, params);
    if (scope === "all") {
      const jobs = await cron.list({ includeDisabled: true });
      const jobNameById = Object.fromEntries(
        jobs
          .filter((job) => typeof job.id === "string" && typeof job.name === "string")
          .map((job) => [job.id, job.name]),
      );
      const page = await readCronRunLogEntriesPageAll({
        storePath: cronStorePath,
        limit: p.limit,
        offset: p.offset,
        statuses: p.statuses,
        status: p.status,
        deliveryStatuses: p.deliveryStatuses,
        deliveryStatus: p.deliveryStatus,
        query: p.query,
        sortDir: p.sortDir,
        jobNameById,
      });
      respond(true, page, undefined);
      return;
    }
    let logPath: string;
    try {
      logPath = resolveCronRunLogPath({
        storePath: cronStorePath,
        jobId: jobId as string,
      });
    } catch {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "invalid cron.runs params: invalid id"),
      );
      return;
    }
    const page = await readCronRunLogEntriesPage(logPath, {
      limit: p.limit,
      offset: p.offset,
      jobId: jobId as string,
      statuses: p.statuses,
      status: p.status,
      deliveryStatuses: p.deliveryStatuses,
      deliveryStatus: p.deliveryStatus,
      query: p.query,
      sortDir: p.sortDir,
    });
    respond(true, page, undefined);
  },
};
