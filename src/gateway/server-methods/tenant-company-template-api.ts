/**
 * Gateway RPC handlers for tenant-scoped OPC company template management.
 *
 * Methods:
 *   tenant.companyTemplate.list     - List available templates
 *   tenant.companyTemplate.apply    - Apply a template: create pending employees + init workspace
 *   tenant.companyTemplate.current  - Return the currently applied template instance
 *
 * Storage model:
 *   - Template definitions: src/company-templates/*.ts (static typescript constants)
 *   - Applied instance state: workspace/_config/company-template.md (yaml frontmatter)
 *   - Per-employee state:    workspace/_config/employees/<role>.md (yaml frontmatter)
 *   - Collection skeletons:  workspace/{collection}/_INDEX.md (created at apply time)
 *
 * This RPC does NOT touch DB tables beyond tenant_agents — all OPC-specific
 * state lives in workspace files, which are naturally audit-logged via
 * workspace.* writes.
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
  ALL_TEMPLATES,
  getTemplateById,
} from "../../company-templates/content-studio.js";
import type {
  CompanyTemplate,
  EmployeeDefinition,
  EmployeeInstance,
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

/** Write a workspace file with yaml frontmatter. Overwrites silently. */
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
    if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return null;
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

function publicTemplate(t: CompanyTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    locked: t.locked,
    employeeCount: t.employees.length,
    employees: t.employees.map(e => ({
      role: e.role,
      title: e.title,
      avatar: e.avatar,
      description: e.description,
      defaultTier: e.defaultTier,
    })),
    collections: t.collections,
  };
}

// ---------------------------------------------------------------------------
// apply() — atomic side effects
// ---------------------------------------------------------------------------

async function applyTemplate(
  ctx: TenantContext,
  template: CompanyTemplate,
): Promise<{ agents: { role: string; agentId: string }[]; collections: string[] }> {
  // Lazy creation: do NOT create tenant_agent rows here. Each employee starts
  // life as a pending instance file; the agent is actually created at the
  // moment the boss clicks "启用" (opcEmployee.activate).
  const declaredAgents: { role: string; agentId: string }[] = [];

  for (const emp of template.employees) {
    const agentId = `opc-${emp.role}`;
    declaredAgents.push({ role: emp.role, agentId });

    // Idempotent: only create the per-employee instance file if it doesn't
    // already exist. Overwriting would wipe activation state (status=active →
    // pending_activation) when apply is accidentally re-run (e.g. portal
    // bounces through /onboarding after EC restart).
    const instancePath = employeeInstancePath(ctx.tenantId, emp.role);
    const existing = await readFrontmatterFile(instancePath);
    if (existing) {
      continue;
    }
    const inst: EmployeeInstance = {
      role: emp.role,
      agentId,
      status: "pending_activation",
      updatedAt: new Date().toISOString(),
    };
    await writeFrontmatterFile(
      instancePath,
      inst as unknown as Record<string, unknown>,
      `# ${emp.title}\n\n${emp.description}\n`,
    );
  }

  // Initialize collection skeletons with friendly Chinese _INDEX.md
  const appliedAt = new Date().toISOString();
  for (const col of template.collections) {
    const colDir = path.join(workspaceRoot(ctx.tenantId), col);
    await fs.mkdir(colDir, { recursive: true });
    const indexPath = path.join(colDir, "_INDEX.md");
    try {
      await fs.access(indexPath);
    } catch {
      const info = template.collectionInfo?.[col];
      const title = info?.title ?? col;
      const description = info?.description ?? "";
      const body =
        `# ${title}\n\n` +
        (description ? `${description}\n\n` : "") +
        `> 目录路径：\`${col}/\`\n` +
        `> 由公司模板「${template.name}」在 ${appliedAt} 初始化。\n`;
      await fs.writeFile(indexPath, body, "utf8");
    }
  }

  // Write the top-level instance file (idempotent: don't overwrite original
  // appliedAt/appliedBy on re-runs)
  const existingTemplate = await readFrontmatterFile(templateInstancePath(ctx.tenantId));
  if (!existingTemplate) {
    await writeFrontmatterFile(
      templateInstancePath(ctx.tenantId),
      {
        templateId: template.id,
        name: template.name,
        appliedAt: new Date().toISOString(),
        appliedBy: ctx.userId,
      },
      `# ${template.name}\n\n${template.description}\n`,
    );
  }

  return { agents: declaredAgents, collections: template.collections };
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const tenantCompanyTemplateHandlers: GatewayRequestHandlers = {
  "tenant.companyTemplate.list": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const templates = ALL_TEMPLATES.map(publicTemplate);
    return respond(true, { templates });
  },

  "tenant.companyTemplate.apply": async ({ params, client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "agent.create");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const templateId = (params as { templateId?: string })?.templateId;
    if (!templateId) {
      return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "templateId required"));
    }
    const template = getTemplateById(templateId);
    if (!template) {
      return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `unknown template: ${templateId}`));
    }
    if (template.locked) {
      return respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, `template ${templateId} is locked (not yet available)`));
    }

    let result;
    try {
      result = await applyTemplate(ctx, template);
    } catch (e) {
      return respond(false, undefined, errorShape(ErrorCodes.INTERNAL_ERROR, (e as Error).message));
    }

    try {
      await createAuditLog({
        tenantId: ctx.tenantId,
        userId: ctx.userId,
        action: "companyTemplate.apply",
        resource: templateId,
        detail: {
          agentCount: result.agents.length,
          collections: result.collections.length,
        },
      });
    } catch { /* audit best-effort */ }

    return respond(true, {
      templateId: template.id,
      appliedAt: new Date().toISOString(),
      agents: result.agents,
      collections: result.collections,
    });
  },

  "tenant.companyTemplate.current": async ({ client, respond }: GatewayRequestHandlerOptions) => {
    const ctx = getTenantCtx(client, respond);
    if (!ctx) return;
    try {
      assertPermission(ctx.role, "tenant.read");
    } catch (e) {
      if (e instanceof RbacError) return respond(false, undefined, errorShape(ErrorCodes.PERMISSION_DENIED, e.message));
      throw e;
    }

    const fm = await readFrontmatterFile(templateInstancePath(ctx.tenantId));
    if (!fm) {
      return respond(true, { applied: false });
    }

    const templateId = fm.templateId as string | undefined;
    const template = templateId ? getTemplateById(templateId) : null;

    // Enumerate employee instance files
    const empDir = path.join(workspaceRoot(ctx.tenantId), "_config", "employees");
    let empFiles: string[] = [];
    try {
      empFiles = await fs.readdir(empDir);
    } catch { /* none yet */ }

    const employees: EmployeeInstance[] = [];
    for (const f of empFiles) {
      if (!f.endsWith(".md")) continue;
      const inst = await readFrontmatterFile(path.join(empDir, f));
      if (inst) {
        employees.push(inst as unknown as EmployeeInstance);
      }
    }

    return respond(true, {
      applied: true,
      templateId: fm.templateId,
      name: fm.name,
      appliedAt: fm.appliedAt,
      appliedBy: fm.appliedBy,
      template: template ? publicTemplate(template) : null,
      employees,
    });
  },
};
