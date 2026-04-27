/**
 * OPC Company Template data model.
 *
 * Templates are TypeScript constants under src/company-templates/. They describe
 * a "company type" (content studio / ecommerce / ...) with a fixed roster of
 * employees. Employees are created in `pending_activation` state when the
 * tenant applies a template; each employee is then activated one-by-one with
 * its own ActivationSpec-driven dialog.
 */

export type ModelTier = "standard" | "senior";

export type ParamType =
  | "text"
  | "number"
  | "single-select"
  | "multi-select"
  | "file-upload"
  | "toggle";

export interface ParamOption {
  value: string;
  label: string;
  /** Authentication flow to run client-side for this option (used by multi-select with authorized channels). */
  authFlow?: "oauth" | "hook" | "appid-secret";
}

export interface ParamSpec {
  key: string;
  label: string;
  type: ParamType;
  required: boolean;
  /** Options for single/multi-select. */
  options?: ParamOption[];
  /** Default value (string for text/select, number for number, boolean for toggle, array for multi-select). */
  default?: unknown;
  /** For multi-select: minimum number of options required. */
  minCount?: number;
  /** For file-upload: maximum file count. */
  maxFiles?: number;
  /** Help text shown to the boss. */
  hint?: string;
}

export interface ConditionalSkillBinding {
  /**
   * A condition expression that references the params object.
   * Evaluated server-side; we support a tiny DSL:
   *   - "<paramKey> includes <value>"   (for multi-select arrays)
   *   - "<paramKey> == <value>"          (equality)
   * Keep it minimal; we don't allow arbitrary JS.
   */
  when: string;
  skills: string[];
}

export interface CronJobSpec {
  /** Cron expression (may contain {{paramKey}} placeholders). */
  schedule: string;
  action: string;
  /** Optional human label for admin listings. */
  label?: string;
}

export interface ActivationSpec {
  /** Parameters the boss fills at activation time. */
  requiredParams: ParamSpec[];
  /** Skills always bound when activating. */
  alwaysBindSkills: string[];
  /** Skills conditionally bound based on param values. */
  skillBindings?: ConditionalSkillBinding[];
  /** Cron jobs to register on activation. */
  cronJobs: CronJobSpec[];
  /** System prompt template with {{paramKey}} placeholders. Rendered at activation time. */
  promptTemplate: string;
}

export interface EmployeeDefinition {
  /** Slug-style role id, used as agent id prefix and file name. e.g. "topic-planner". */
  role: string;
  /** Human-readable title shown to boss. e.g. "选题策划官". */
  title: string;
  /** Avatar URL (relative to portal public assets). */
  avatar: string;
  /** Model tier used at agent creation time. */
  defaultTier: ModelTier;
  /** Short description shown on the MyTeam card. */
  description: string;
  /** Full activation spec (params / bindings / cron / prompt). */
  activationSpec: ActivationSpec;
}

export interface CompanyTemplate {
  id: string;
  name: string;
  description: string;
  /** Whether the template is locked (greyed out in UI). */
  locked: boolean;
  /** Employee roster. Always created together when applying the template. */
  employees: EmployeeDefinition[];
  /**
   * Workspace collection directories to initialize (_INDEX.md placeholder
   * written in each) when the template is applied.
   */
  collections: string[];
  /**
   * Optional per-collection title + description. Used by applyTemplate to
   * render a friendly Chinese _INDEX.md in each directory so users who browse
   * the filesystem can understand what each folder is for.
   */
  collectionInfo?: Record<string, { title: string; description: string }>;
}

// ---------------------------------------------------------------------------
// Employee status tracked in _config/employees/<role>.md
// ---------------------------------------------------------------------------

export type EmployeeStatus = "pending_activation" | "active" | "paused";

export interface EmployeeInstance {
  role: string;
  agentId: string;
  status: EmployeeStatus;
  /** The params the boss filled at the last activation/reconfigure. */
  params?: Record<string, unknown>;
  /** The skills bound at activation time (for audit). */
  boundSkills?: string[];
  /** The cron job ids registered at activation time. */
  cronJobIds?: string[];
  /** ISO datetime of last activation. */
  activatedAt?: string;
  /** ISO datetime of current status transition. */
  updatedAt?: string;
}

// ---------------------------------------------------------------------------
// Apply / activation operation results
// ---------------------------------------------------------------------------

export interface ApplyResult {
  templateId: string;
  instanceAppliedAt: string;
  agents: { role: string; agentId: string }[];
  collections: string[];
}

export interface ActivateResult {
  role: string;
  agentId: string;
  status: EmployeeStatus;
  boundSkills: string[];
  cronJobIds: string[];
  systemPromptPreview: string;
}
