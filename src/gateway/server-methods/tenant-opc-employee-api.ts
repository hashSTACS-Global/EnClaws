/**
 * Gateway RPC handlers for tenant-scoped OPC employee lifecycle.
 *
 * Methods:
 *   tenant.opcEmployee.list            - List the 6 employees of the applied template + current status
 *   tenant.opcEmployee.activationSpec  - Return the activation dialog spec for a role
 *   tenant.opcEmployee.activate        - Activate an employee: render prompt + bind skills + update agent
 *   tenant.opcEmployee.deactivate      - Pause an employee: isActive=false + mark paused
 *   tenant.opcEmployee.reconfigure     - Same as activate but for an already-active employee
 *
 * Storage:
 *   - Employee instance state: workspace/_config/employees/<role>.md
 *
 * Orchestration boundary:
 *   - This RPC updates the tenant_agent row (systemPrompt / skills / modelConfig / isActive)
 *     and writes the employee state file.
 *   - It does NOT call cron.add or store secrets itself. Instead, activate() returns
 *     the cron job specs and (if any) secret requirements for the portal to execute
 *     via existing `cron.add` and `tenant.secrets.*` RPCs. This keeps the RPC pure
 *     and side-effect-bounded.
 */

import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";

import type {
  GatewayRequestHandlers,
  GatewayRequestHandlerOptions,
} from "./types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { isDbInitialized } from "../../db/index.js";
import { createAuditLog } from "../../db/models/audit-log.js";
import { assertPermission, RbacError } from "../../auth/rbac.js";
import type { TenantContext } from "../../auth/middleware.js";
import { resolveTenantDir } from "../../config/sessions/tenant-paths.js";
import {
  createTenantAgent,
  getTenantAgent,
  updateTenantAgent,
} from "../../db/models/tenant-agent.js";
import { listTenantModels } from "../../db/models/tenant-model.js";
import { seedAgentWorkspaceFiles } from "../../agents/workspace.js";
import { resolveTenantAgentDir } from "../../config/sessions/tenant-paths.js";
import { invalidateTenantConfigCache, loadTenantConfig } from "../../config/tenant-config.js";
import type { ModelConfigEntry } from "../../db/types.js";
import { syncIdentityFile } from "./tenant-agents-api.js";
import {
  contentStudioTemplate,
  getTemplateById,
} from "../../company-templates/content-studio.js";
import type {
  CompanyTemplate,
  EmployeeDefinition,
  EmployeeInstance,
  EmployeeStatus,
  ActivationSpec,
  CronJobSpec,
} from "../../company-templates/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTenantCtx(
  client: GatewayRequestHandlerOptions["client"],
  respond: GatewayRequestHandlerOptions["respond"],
): TenantContext | null {
  if (!isDbInitialized()) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Multi-tenant mode not enabled"));
    return null;
  }
  const tenant = (client as unknown as { tenant?: TenantContext })?.tenant;
  if (!tenant) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "Authentication required"));
    return null;
  }
  return tenant;
}

function workspaceRoot(tenantId: string): string {
  return path.join(resolveTenantDir(tenantId), "workspace");
}

function templateInstancePath(tenantId: string): string {
  return path.join(workspaceRoot(tenantId), "_config", "company-template.md");
}

function employeeInstancePath(tenantId: string, role: string): string {
  return path.join(workspaceRoot(tenantId), "_config", "employees", `${role}.md`);
}

async function writeFrontmatterFile(
  absPath: string,
  frontmatter: Record<string, unknown>,
  body = "",
): Promise<void> {
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const yamlStr = YAML.stringify(frontmatter).trimEnd();
  const content = `---\n${yamlStr}\n---\n${body}`;
  await fs.writeFile(absPath, content, "utf8");
}

async function readFrontmatterFile(absPath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(absPath, "utf8");
    if (!raw.startsWith("---")) return null;
    const lines = raw.split(/\r?\n/);
    let close = -1;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i] === "---") { close = i; break; }
    }
    if (close < 0) return null;
    const yamlBlock = lines.slice(1, close).join("\n");
    const parsed = YAML.parse(yamlBlock, { schema: "core" });
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch (e: unknown) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return null;
    throw e;
  }
}

/** Load the currently applied template for a tenant. */
async function loadAppliedTemplate(tenantId: string): Promise<CompanyTemplate | null> {
  const fm = await readFrontmatterFile(templateInstancePath(tenantId));
  if (!fm || typeof fm.templateId !== "string") return null;
  return getTemplateById(fm.templateId);
}

function findEmployee(template: CompanyTemplate, role: string): EmployeeDefinition | null {
  return template.employees.find(e => e.role === role) ?? null;
}

// ---------------------------------------------------------------------------
// Condition DSL for skillBindings
// ---------------------------------------------------------------------------

/**
 * Minimal expression DSL. Supports:
 *   "<paramKey> includes <value>"   (for multi-select arrays)
 *   "<paramKey> == <value>"         (equality)
 *   "parent:<otherRole> <paramKey> includes <value>"  (cross-employee reference, for business-manager relying on community-manager config)
 *
 * Returns true/false. Unknown expressions evaluate to false.
 */
function evalCondition(
  expr: string,
  params: Record<string, unknown>,
  parentParams: Record<string, Record<string, unknown>>,
): boolean {
  const trimmed = expr.trim();
  let scope: Record<string, unknown> = params;

  // Cross-employee prefix: "parent:<role> <rest>"
  if (trimmed.startsWith("parent:")) {
    const firstSpace = trimmed.indexOf(" ");
    if (firstSpace < 0) return false;
    const parentRole = trimmed.slice("parent:".length, firstSpace).trim();
    const rest = trimmed.slice(firstSpace + 1).trim();
    scope = parentParams[parentRole] ?? {};
    return evalSimple(rest, scope);
  }
  return evalSimple(trimmed, scope);
}

function evalSimple(expr: string, scope: Record<string, unknown>): boolean {
  // "<key> includes <value>"
  const incMatch = expr.match(/^(\S+)\s+includes\s+(\S+)$/);
  if (incMatch) {
    const [, key, raw] = incMatch;
    const val = stripQuotes(raw);
    const arr = scope[key];
    return Array.isArray(arr) && arr.includes(val);
  }
  // "<key> == <value>"
  const eqMatch = expr.match(/^(\S+)\s*==\s*(\S+)$/);
  if (eqMatch) {
    const [, key, raw] = eqMatch;
    const val = stripQuotes(raw);
    return String(scope[key]) === val;
  }
  return false;
}

function stripQuotes(s: string): string {
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Param validation
// ---------------------------------------------------------------------------

function validateParams(spec: ActivationSpec, params: Record<string, unknown>): string | null {
  for (const p of spec.requiredParams) {
    const v = params[p.key];
    if (p.required && (v === undefined || v === null || v === "")) {
      return `param ${p.key} is required`;
    }
    if (p.type === "multi-select" && p.minCount && Array.isArray(v) && v.length < p.minCount) {
      return `param ${p.key} needs at least ${p.minCount} option(s)`;
    }
    if (p.type === "single-select" && v !== undefined) {
      const allowed = (p.options ?? []).map(o => o.value);
      if (!allowed.includes(String(v))) {
        return `param ${p.key} must be one of: ${allowed.join(", ")}`;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Prompt template rendering
// ---------------------------------------------------------------------------

function renderTemplate(tpl: string, params: Record<string, unknown>): string {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const v = params[key];
    if (v === undefined || v === null) return "";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  });
}

function substituteCronParams(schedule: string, params: Record<string, unknown>): string {
  return schedule.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => {
    const v = params[key];
    return v === undefined || v === null ? _m : String(v);
  });
}

// ---------------------------------------------------------------------------
// Compute bound skills (alwaysBindSkills + conditional)
// ---------------------------------------------------------------------------

async function computeBoundSkills(
  tenantId: string,
  template: CompanyTemplate,
  employee: EmployeeDefinition,
  params: Record<string, unknown>,
): Promise<string[]> {
  const out = new Set<string>(employee.activationSpec.alwaysBindSkills);
  if (!employee.activationSpec.skillBindings?.length) return Array.from(out);

  // Build parent params map for cross-employee conditions
  const parentParams: Record<string, Record<string, unknown>> = {};
  const empDir = path.join(workspaceRoot(tenantId), "_config", "employees");
  try {
    const files = await fs.readdir(empDir);
    for (const f of files) {
      if (!f.endsWith(".md")) continue;
      const role = f.replace(/\.md$/, "");
      if (role === employee.role) continue;
      const inst = await readFrontmatterFile(path.join(empDir, f));
      if (inst && inst.params && typeof inst.params === "object") {
        parentParams[role] = inst.params as Record<string, unknown>;
      }
    }
  } catch { /* none */ }

  for (const binding of employee.activationSpec.skillBindings) {
    if (evalCondition(binding.when, params, parentParams)) {
      for (const s of binding.skills) out.add(s);
    }
  }
  return Array.from(out);
}

// ---------------------------------------------------------------------------
// Compute cron specs
// ---------------------------------------------------------------------------

/**
 * Build cron.add-compatible specs. Each one is a ready-to-use payload that the
 * portal can pass to the existing cron.add RPC as-is. We rely on EC's existing
 * delivery.mode="none" (no IM broadcast) + payload.kind="systemEvent" (wake agent
 * with a text prompt) semantics — no new "agent-task" mode needed.
 */
/**
 * Resolve the model an employee should use, based on its tier.
 *
 * Lookup order:
 *   1. A model definition whose alias == "opc-{tier}" (platform admin configures
 *      a shared model with this alias to mark it as the OPC standard/senior choice).
 *   2. Fallback: first active shared model (any).
 *   3. Fallback: first active tenant-private model.
 *
 * Returns null if nothing is configured — activate() will surface this as a
 * config-needed error to the caller.
 */
async function resolveModelForTier(
  tenantId: string,
  tier: "standard" | "senior",
): Promise<ModelConfigEntry | null> {
  const providers = await listTenantModels(tenantId, { activeOnly: true, includeShared: true });
  if (!providers.length) return null;

  const wantedAlias = `opc-${tier}`;

  // Pass 1: strict alias match
  for (const provider of providers) {
    for (const m of provider.models ?? []) {
      if (m.alias === wantedAlias) {
        return { providerId: provider.id, modelId: m.id, isDefault: true };
      }
    }
  }

  // Pass 2: first shared model (any)
  const shared = providers.find(p => p.visibility === "shared" && (p.models?.length ?? 0) > 0);
  if (shared && shared.models[0]) {
    return { providerId: shared.id, modelId: shared.models[0].id, isDefault: true };
  }

  // Pass 3: first tenant-private model
  const priv = providers.find(p => (p.models?.length ?? 0) > 0);
  if (priv && priv.models[0]) {
    return { providerId: priv.id, modelId: priv.models[0].id, isDefault: true };
  }

  return null;
}

function computeCronSpecs(employee: EmployeeDefinition, params: Record<string, unknown>, agentId: string) {
  return employee.activationSpec.cronJobs.map((c: CronJobSpec) => {
    const expr = substituteCronParams(c.schedule, params);
    const label = c.label ?? `${employee.title} · ${c.action}`;
    // Passed verbatim to cron.add.
    //   - sessionTarget="isolated" + payload.kind="agentTurn":
    //     each cron run spawns a FRESH one-shot session for the agent and
    //     actually invokes the LLM. OPC agents have no standing IM session, so
    //     "main" + systemEvent (which only enqueues to a live session) would
    //     never trigger an LLM call.
    //   - delivery.mode="none": don't broadcast result to any IM channel.
    //   - _agentId (underscore prefix): consumed by resolveEffectiveCron to land
    //     this job in the agent-scoped cron store. stripTenantParams() removes
    //     it before schema validation.
    return {
      addParams: {
        _agentId: agentId,
        name: label,
        description: `OPC ${employee.role} action=${c.action}`,
        agentId,
        schedule: { kind: "cron" as const, expr },
        sessionTarget: "isolated" as const,
        wakeMode: "now" as const,
        payload: {
          kind: "agentTurn" as const,
          message:
            `你被「${label}」排班唤醒，需执行 action="${c.action}"。\n` +
            `请按 systemPrompt 中该 action 对应的工作流 STEP 顺序执行。\n` +
            `\n` +
            `【最后一步必做】：发起一个真正的 tool_call — opc({ action: "notify", from: "${c.action.includes("draft") ? "content-creator" : agentId.startsWith("opc-") ? agentId.slice(4) : agentId}", message: "<一句话人话>", priority: "normal" })\n` +
            `这是 JSON tool_call，不是写 md 文件。严禁用 write 工具直接写 _notifications/ 目录下任何文件（那不会触发 IM 推送，老板收不到）。\n` +
            `没完成这一步 = 任务未完成。`,
        },
        delivery: { mode: "none" as const },
      },
      meta: {
        action: c.action,
        schedule: expr,
        label,
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const tenantOpcEmployeeHandlers: GatewayRequestHandlers = {
  // -----------------------------------------------------------------------
  // list
  // -----------------------------------------------------------------------
  "tenant.opcEmployee.list": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const template = await loadAppliedTemplate(ctx.tenantId);
    if (!template) {
      return respond(true, { applied: false, employees: [] });
    }

    const empDir = path.join(workspaceRoot(ctx.tenantId), "_config", "employees");
    const employees: Array<EmployeeInstance & { title: string; avatar: string; description: string; defaultTier: string }> = [];
    for (const emp of template.employees) {
      const inst = (await readFrontmatterFile(employeeInstancePath(ctx.tenantId, emp.role))) as EmployeeInstance | null;
      employees.push({
        role: emp.role,
        agentId: inst?.agentId ?? `opc-${emp.role}`,
        status: (inst?.status as EmployeeStatus) ?? "pending_activation",
        params: inst?.params,
        boundSkills: inst?.boundSkills,
        cronJobIds: inst?.cronJobIds,
        activatedAt: inst?.activatedAt,
        updatedAt: inst?.updatedAt,
        title: emp.title,
        avatar: emp.avatar,
        description: emp.description,
        defaultTier: emp.defaultTier,
      });
    }

    return respond(true, { applied: true, templateId: template.id, employees });
  },

  // -----------------------------------------------------------------------
  // activationSpec
  // -----------------------------------------------------------------------
  "tenant.opcEmployee.activationSpec": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const role = (params as { role?: string })?.role;
    if (!role) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "role required"));

    const template = await loadAppliedTemplate(ctx.tenantId);
    if (!template) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no template applied"));

    const emp = findEmployee(template, role);
    if (!emp) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown role: ${role}`));

    // Return the raw activation spec + existing params (for reconfigure prefill)
    const existingInstance = (await readFrontmatterFile(employeeInstancePath(ctx.tenantId, role))) as EmployeeInstance | null;

    return respond(true, {
      role,
      title: emp.title,
      description: emp.description,
      defaultTier: emp.defaultTier,
      requiredParams: emp.activationSpec.requiredParams,
      existingParams: existingInstance?.params ?? null,
      currentStatus: existingInstance?.status ?? "pending_activation",
    });
  },

  // -----------------------------------------------------------------------
  // activate — the core method
  // -----------------------------------------------------------------------
  "tenant.opcEmployee.activate": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "agent.update");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const p = params as { role?: string; params?: Record<string, unknown> };
    if (!p?.role) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "role required"));
    const userParams = (p.params ?? {}) as Record<string, unknown>;

    const template = await loadAppliedTemplate(ctx.tenantId);
    if (!template) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no template applied"));

    const emp = findEmployee(template, p.role);
    if (!emp) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown role: ${p.role}`));

    // Validate params
    const validationError = validateParams(emp.activationSpec, userParams);
    if (validationError) {
      return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, validationError));
    }

    // Apply defaults for missing optional params
    const effectiveParams: Record<string, unknown> = { ...userParams };
    for (const ps of emp.activationSpec.requiredParams) {
      if (effectiveParams[ps.key] === undefined && ps.default !== undefined) {
        effectiveParams[ps.key] = ps.default;
      }
    }

    const agentId = `opc-${emp.role}`;

    // Render system prompt
    const systemPrompt = renderTemplate(emp.activationSpec.promptTemplate, effectiveParams);

    // Compute bound skills
    const boundSkills = await computeBoundSkills(ctx.tenantId, template, emp, effectiveParams);

    // Compute cron specs (returned to caller; portal executes cron.add)
    const cronSpecs = computeCronSpecs(emp, effectiveParams, agentId);

    // Resolve model by tier (shared model with alias "opc-standard" / "opc-senior")
    const modelEntry = await resolveModelForTier(ctx.tenantId, emp.defaultTier);
    if (!modelEntry) {
      return respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          `No usable model for tier=${emp.defaultTier}. Platform admin must create a shared model (alias: "opc-${emp.defaultTier}") via platform.models.create before activating OPC employees.`,
        ),
      );
    }

    // Point the agent's Read/Write tool root at the tenant's shared OPC
    // workspace. Without this, agent.config.workspace is undefined and the
    // built-in Write tool falls back to a per-agent default dir, so files like
    // "topics/{date}.md" land in the wrong place and OPC portal's
    // workspace.list never sees them.
    const tenantWorkspaceDir = path.join(resolveTenantDir(ctx.tenantId), "workspace");

    // Lazy-create the agent if it doesn't exist yet (apply only writes
    // employee instance files; the agent row is created here on first activate).
    // Subsequent activate / reconfigure calls update the existing row.
    const agentConfig = {
      systemPrompt,
      workspace: tenantWorkspaceDir,
      opcRole: emp.role,
      opcTemplate: template.id,
      pendingActivation: false,
      tier: emp.defaultTier,
    };
    // NOTE: tenant_agents.skills is a DENYLIST of bundled skills (skills listed
    // here get toggled OFF in the admin UI and hidden from the agent). The
    // template's alwaysBindSkills are the skills the agent SHOULD be able to
    // call, so we must NOT put them in this field. Passing [] = disable nothing
    // = the agent sees the full bundled skill roster. boundSkills is still kept
    // in the employee instance frontmatter below for audit + display.
    const skillsDenylist: string[] = [];
    try {
      const existing = await getTenantAgent(ctx.tenantId, agentId);
      if (!existing) {
        await createTenantAgent({
          tenantId: ctx.tenantId,
          agentId,
          name: emp.title,
          config: agentConfig,
          modelConfig: [modelEntry],
          tools: { deny: [] },
          skills: skillsDenylist,
          createdBy: ctx.userId,
        });
        await seedAgentWorkspaceFiles(resolveTenantAgentDir(ctx.tenantId, agentId), {
          systemPrompt,
        });
        // OPC employees come with a complete systemPrompt and don't need the
        // generic "hello-world" bootstrap conversation. Remove BOOTSTRAP.md so
        // the LLM can't misread it as "I'm uninitialized" and refuse to run
        // (observed: distribution-editor dumped a 跳过执行 report citing BOOTSTRAP.md).
        const agentDir = resolveTenantAgentDir(ctx.tenantId, agentId);
        try {
          await fs.unlink(path.join(agentDir, "BOOTSTRAP.md"));
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") {
            // non-fatal
            console.warn(`[opcEmployee.activate] failed to remove BOOTSTRAP.md for ${agentId}: ${err.message}`);
          }
        }
      } else {
        await updateTenantAgent(ctx.tenantId, agentId, {
          config: {
            ...(existing.config as Record<string, unknown>),
            ...agentConfig,
          },
          modelConfig: [modelEntry],
          skills: skillsDenylist,
          isActive: true,
        });
        await syncIdentityFile(ctx.tenantId, agentId, { systemPrompt });
        // Also nuke BOOTSTRAP.md on reactivate (covers agents created before
        // this cleanup shipped). Idempotent — ignore ENOENT.
        try {
          await fs.unlink(path.join(resolveTenantAgentDir(ctx.tenantId, agentId), "BOOTSTRAP.md"));
        } catch (e) {
          const err = e as NodeJS.ErrnoException;
          if (err.code !== "ENOENT") {
            console.warn(`[opcEmployee.reconfigure] failed to remove BOOTSTRAP.md for ${agentId}: ${err.message}`);
          }
        }
      }
      invalidateTenantConfigCache(ctx.tenantId);
      // Pre-warm the cache so the very next cron run (possibly fired before any
      // RPC call would naturally repopulate it) has tenant-aware config to peek.
      // Without this, the cron isolated runner falls back to loadConfig() and
      // can't find tenant agents.
      try {
        await loadTenantConfig(ctx.tenantId, { userId: ctx.userId, userRole: ctx.role });
      } catch {
        // best-effort
      }
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `agent create/update failed: ${(e as Error).message}`));
    }

    // Collect secret requirements (for portal to populate via tenant.secrets.*)
    const secretRequirements: Array<{ key: string; paramKey: string; authFlow: string }> = [];
    for (const ps of emp.activationSpec.requiredParams) {
      if (ps.type !== "multi-select" || !ps.options) continue;
      const chosen = effectiveParams[ps.key];
      if (!Array.isArray(chosen)) continue;
      for (const opt of ps.options) {
        if (!opt.authFlow || !chosen.includes(opt.value)) continue;
        secretRequirements.push({
          key: `opc.${emp.role}.${opt.value}.token`,
          paramKey: ps.key,
          authFlow: opt.authFlow,
        });
      }
    }

    // Write employee instance file
    const instance: EmployeeInstance = {
      role: emp.role,
      agentId,
      status: "active",
      params: effectiveParams,
      boundSkills,
      cronJobIds: [], // portal will backfill after cron.add
      activatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeFrontmatterFile(
        employeeInstancePath(ctx.tenantId, emp.role),
        instance as unknown as Record<string, unknown>,
        `# ${emp.title}\n\n${emp.description}\n`,
      );
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, `write instance failed: ${(e as Error).message}`));
    }

    // Audit
    try {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "opcEmployee.activate",
        resource: emp.role,
        detail: {
          agentId,
          skillsCount: boundSkills.length,
          cronCount: cronSpecs.length,
        },
      });
    } catch { /* best-effort */ }

    return respond(true, {
      role: emp.role,
      agentId,
      status: "active",
      boundSkills,
      cronSpecs,           // portal should call cron.add for each
      secretRequirements,  // portal should populate via tenant.secrets.*
      systemPromptPreview: systemPrompt.slice(0, 500),
    });
  },

  // -----------------------------------------------------------------------
  // deactivate
  // -----------------------------------------------------------------------
  "tenant.opcEmployee.deactivate": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "agent.update");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const role = (params as { role?: string })?.role;
    if (!role) return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "role required"));

    const agentId = `opc-${role}`;

    try {
      await updateTenantAgent(ctx.tenantId, agentId, { isActive: false });
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    const inst = (await readFrontmatterFile(employeeInstancePath(ctx.tenantId, role))) as EmployeeInstance | null;
    const merged: EmployeeInstance = {
      ...(inst as EmployeeInstance),
      role,
      agentId,
      status: "paused",
      updatedAt: new Date().toISOString(),
    };
    try {
      await writeFrontmatterFile(
        employeeInstancePath(ctx.tenantId, role),
        merged as unknown as Record<string, unknown>,
      );
    } catch { /* non-fatal */ }

    try {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "opcEmployee.deactivate",
        resource: role,
      });
    } catch { /* best-effort */ }

    // Tell portal which cron jobs to remove
    const cronJobIdsToRemove = inst?.cronJobIds ?? [];
    return respond(true, { role, agentId, status: "paused", cronJobIdsToRemove });
  },

  // -----------------------------------------------------------------------
  // reconfigure — same as activate, keeping agentId
  // -----------------------------------------------------------------------
  "tenant.opcEmployee.reconfigure": async (options: GatewayRequestHandlerOptions) => {
    // Delegate to activate (which is already idempotent w.r.t. agent update)
    const activateHandler = tenantOpcEmployeeHandlers["tenant.opcEmployee.activate"];
    return activateHandler(options);
  },
};
