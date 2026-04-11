export const ADMIN_SCOPE = "operator.admin" as const;
export const READ_SCOPE = "operator.read" as const;
export const WRITE_SCOPE = "operator.write" as const;
export const APPROVALS_SCOPE = "operator.approvals" as const;
export const PAIRING_SCOPE = "operator.pairing" as const;

export type OperatorScope =
  | typeof ADMIN_SCOPE
  | typeof READ_SCOPE
  | typeof WRITE_SCOPE
  | typeof APPROVALS_SCOPE
  | typeof PAIRING_SCOPE;

export const CLI_DEFAULT_OPERATOR_SCOPES: OperatorScope[] = [
  ADMIN_SCOPE,
  READ_SCOPE,
  WRITE_SCOPE,
  APPROVALS_SCOPE,
  PAIRING_SCOPE,
];

const NODE_ROLE_METHODS = new Set([
  "node.invoke.result",
  "node.event",
  "node.canvas.capability.refresh",
  "skills.bins",
]);

/**
 * Methods that bypass operator scope authorization entirely.
 * These are either public (auth.register, auth.login, auth.refresh)
 * or handled by the multi-tenant RBAC layer instead.
 */
export const SCOPE_BYPASS_METHODS = new Set([
  // Auth (public or self-service)
  "auth.register",
  "auth.login",
  "auth.refresh",
  "auth.logout",
  "auth.me",
  // Auth Phase 1
  "auth.changePassword",
  "auth.capabilities",
  "auth.forgotPassword",
  "auth.forgotPassword.verify",
  "auth.adminResetPassword",
  "auth.viewTempPassword",
  // Auth Phase 3
  "auth.sessions",
  "auth.revokeSession",
  "auth.revokeAllOtherSessions",
  "auth.verifyEmail",
  "auth.resendVerifyEmail",
  "auth.mfa.setup.begin",
  "auth.mfa.setup.verify",
  "auth.mfa.disable",
  "auth.mfa.verify",
  // Tenant management (handled by multi-tenant RBAC)
  "tenant.get",
  "tenant.update",
  "tenant.users.list",
  "tenant.users.invite",
  "tenant.users.update",
  "tenant.users.remove",
  "tenant.audit.list",
  // Tenant agent management
  "tenant.agents.list",
  "tenant.agents.create",
  "tenant.agents.update",
  "tenant.agents.delete",
  // Tenant channel management
  "tenant.channels.list",
  "tenant.channels.create",
  "tenant.channels.update",
  "tenant.channels.delete",
  // Feishu bot registration
  "tenant.feishu.register.begin",
  "tenant.feishu.register.poll",
  // Tenant session management
  "tenant.sessions.list",
  "tenant.sessions.get",
  "tenant.sessions.delete",
  // Tenant usage
  "tenant.usage.summary",
  "tenant.usage.quota",
  // Tenant onboarding
  "tenant.onboarding.setup",
  // Platform overview (handled by platform-admin RBAC)
  "platform.overview.summary",
  "platform.overview.tokenTrend",
  "platform.overview.tokenRank",
  "platform.overview.llmStats",
  "platform.overview.channelDistribution",
  "platform.overview.userActivity",
]);

const METHOD_SCOPE_GROUPS: Record<OperatorScope, readonly string[]> = {
  [APPROVALS_SCOPE]: [
    "exec.approval.request",
    "exec.approval.waitDecision",
    "exec.approval.resolve",
  ],
  [PAIRING_SCOPE]: [
    "node.pair.request",
    "node.pair.list",
    "node.pair.approve",
    "node.pair.reject",
    "node.pair.verify",
    "device.pair.list",
    "device.pair.approve",
    "device.pair.reject",
    "device.pair.remove",
    "device.token.rotate",
    "device.token.revoke",
    "node.rename",
  ],
  [READ_SCOPE]: [
    "health",
    "doctor.memory.status",
    "logs.tail",
    "channels.status",
    "status",
    "usage.status",
    "usage.cost",
    "tts.status",
    "tts.providers",
    "models.list",
    "tools.catalog",
    "sys.tools.get",
    "agents.list",
    "agent.identity.get",
    "skills.status",
    "voicewake.get",
    "sessions.list",
    "sessions.preview",
    "sessions.resolve",
    "sessions.usage",
    "sessions.usage.timeseries",
    "sessions.usage.logs",
    "cron.list",
    "cron.status",
    "cron.runs",
    "system-presence",
    "last-heartbeat",
    "node.list",
    "node.describe",
    "chat.history",
    "config.get",
    "talk.config",
    "agents.files.list",
    "agents.files.get",
    "agents.memory.list",
    "agents.memory.get",
    "agents.memory.status",
  ],
  [WRITE_SCOPE]: [
    "send",
    "poll",
    "agent",
    "agent.wait",
    "wake",
    "talk.mode",
    "tts.enable",
    "tts.disable",
    "tts.convert",
    "tts.setProvider",
    "voicewake.set",
    "node.invoke",
    "chat.send",
    "chat.abort",
    "browser.request",
    "push.test",
  ],
  [ADMIN_SCOPE]: [
    "channels.logout",
    "agents.create",
    "agents.update",
    "agents.delete",
    "skills.install",
    "skills.update",
    "secrets.reload",
    "cron.add",
    "cron.update",
    "cron.remove",
    "cron.run",
    "sessions.patch",
    "sessions.reset",
    "sessions.delete",
    "sessions.compact",
    "connect",
    "chat.inject",
    "web.login.start",
    "web.login.wait",
    "set-heartbeats",
    "system-event",
    "agents.files.set",
    "agents.memory.set",
    "agents.memory.delete",
    "sys.tools.update",
  ],
};

const ADMIN_METHOD_PREFIXES = ["exec.approvals.", "config.", "wizard.", "update."] as const;

const METHOD_SCOPE_BY_NAME = new Map<string, OperatorScope>(
  Object.entries(METHOD_SCOPE_GROUPS).flatMap(([scope, methods]) =>
    methods.map((method) => [method, scope as OperatorScope]),
  ),
);

function resolveScopedMethod(method: string): OperatorScope | undefined {
  const explicitScope = METHOD_SCOPE_BY_NAME.get(method);
  if (explicitScope) {
    return explicitScope;
  }
  if (ADMIN_METHOD_PREFIXES.some((prefix) => method.startsWith(prefix))) {
    return ADMIN_SCOPE;
  }
  return undefined;
}

export function isApprovalMethod(method: string): boolean {
  return resolveScopedMethod(method) === APPROVALS_SCOPE;
}

export function isPairingMethod(method: string): boolean {
  return resolveScopedMethod(method) === PAIRING_SCOPE;
}

export function isReadMethod(method: string): boolean {
  return resolveScopedMethod(method) === READ_SCOPE;
}

export function isWriteMethod(method: string): boolean {
  return resolveScopedMethod(method) === WRITE_SCOPE;
}

export function isNodeRoleMethod(method: string): boolean {
  return NODE_ROLE_METHODS.has(method);
}

export function isAdminOnlyMethod(method: string): boolean {
  return resolveScopedMethod(method) === ADMIN_SCOPE;
}

export function resolveRequiredOperatorScopeForMethod(method: string): OperatorScope | undefined {
  return resolveScopedMethod(method);
}

export function resolveLeastPrivilegeOperatorScopesForMethod(method: string): OperatorScope[] {
  const requiredScope = resolveRequiredOperatorScopeForMethod(method);
  if (requiredScope) {
    return [requiredScope];
  }
  // Default-deny for unclassified methods.
  return [];
}

export function authorizeOperatorScopesForMethod(
  method: string,
  scopes: readonly string[],
): { allowed: true } | { allowed: false; missingScope: OperatorScope } {
  // Multi-tenant auth/tenant methods are handled by RBAC, not operator scopes
  if (SCOPE_BYPASS_METHODS.has(method)) {
    return { allowed: true };
  }
  if (scopes.includes(ADMIN_SCOPE)) {
    return { allowed: true };
  }
  const requiredScope = resolveRequiredOperatorScopeForMethod(method) ?? ADMIN_SCOPE;
  if (requiredScope === READ_SCOPE) {
    if (scopes.includes(READ_SCOPE) || scopes.includes(WRITE_SCOPE)) {
      return { allowed: true };
    }
    return { allowed: false, missingScope: READ_SCOPE };
  }
  if (scopes.includes(requiredScope)) {
    return { allowed: true };
  }
  return { allowed: false, missingScope: requiredScope };
}

export function isGatewayMethodClassified(method: string): boolean {
  if (isNodeRoleMethod(method)) {
    return true;
  }
  return resolveRequiredOperatorScopeForMethod(method) !== undefined;
}
