import { Type } from "@sinclair/typebox";
import type { OpenClawConfig } from "../../config/config.js";
import type { MemoryCitationsMode } from "../../config/types.memory.js";
import { resolveMemoryBackendConfig } from "../../memory/backend-config.js";
import { getMemorySearchManager } from "../../memory/index.js";
import type { MemorySearchManager, MemorySearchResult } from "../../memory/types.js";
import { parseAgentSessionKey } from "../../routing/session-key.js";
import { resolveSessionAgentId } from "../agent-scope.js";
import { resolveMemorySearchConfig } from "../memory-search.js";
import type { AnyAgentTool } from "./common.js";
import { jsonResult, readNumberParam, readStringParam } from "./common.js";

const MemorySearchSchema = Type.Object({
  query: Type.String(),
  maxResults: Type.Optional(Type.Number()),
  minScore: Type.Optional(Type.Number()),
});

const MemoryGetSchema = Type.Object({
  path: Type.String(),
  from: Type.Optional(Type.Number()),
  lines: Type.Optional(Type.Number()),
});

function resolveMemoryToolContext(options: { config?: OpenClawConfig; agentSessionKey?: string }) {
  const cfg = options.config;
  if (!cfg) {
    return null;
  }
  const agentId = resolveSessionAgentId({
    sessionKey: options.agentSessionKey,
    config: cfg,
  });
  if (!resolveMemorySearchConfig(cfg, agentId)) {
    return null;
  }
  return { cfg, agentId };
}

type ScopedMemoryManager = {
  scope: "tenant" | "agent";
  manager: MemorySearchManager;
};

async function resolveScopedMemoryManagers(options: {
  cfg: OpenClawConfig;
  agentId: string;
  agentWorkspaceDir?: string;
  agentDefaultStorePath?: string;
  tenantWorkspaceDir?: string;
  tenantDefaultStorePath?: string;
}): Promise<{ managers: ScopedMemoryManager[]; error?: string }> {
  const managers: ScopedMemoryManager[] = [];
  const errors: string[] = [];

  if (options.tenantWorkspaceDir && options.tenantDefaultStorePath) {
    const { manager, error } = await getMemorySearchManager({
      cfg: options.cfg,
      agentId: options.agentId,
      workspaceDir: options.tenantWorkspaceDir,
      defaultStorePath: options.tenantDefaultStorePath,
    });
    if (manager) {
      managers.push({ scope: "tenant", manager });
    } else if (error) {
      errors.push(`tenant: ${error}`);
    }
  }

  const { manager, error } = await getMemorySearchManager({
    cfg: options.cfg,
    agentId: options.agentId,
    workspaceDir: options.agentWorkspaceDir,
    defaultStorePath: options.agentDefaultStorePath,
  });
  if (manager) {
    managers.push({ scope: "agent", manager });
  } else if (error) {
    errors.push(`agent: ${error}`);
  }

  return { managers, error: errors.length > 0 ? errors.join("; ") : undefined };
}

function decorateScope(
  results: MemorySearchResult[],
  scope: "tenant" | "agent",
  prefixPath: boolean,
): MemorySearchResult[] {
  const prefix = scope === "tenant" ? "tenant/" : "knowledge/";
  const sourceLabel = scope === "tenant" ? "Enterprise Memory" : "Agent Knowledge";
  return results.map((entry) => ({
    ...entry,
    path: prefixPath && !entry.path.startsWith(prefix) ? `${prefix}${entry.path}` : entry.path,
    ...(prefixPath ? { scope, sourceLabel } : {}),
  }));
}

async function searchScopedMemory(params: {
  managers: ScopedMemoryManager[];
  query: string;
  maxResults?: number;
  defaultMaxResults: number;
  minScore?: number;
  sessionKey?: string;
}): Promise<MemorySearchResult[]> {
  const maxResults = Math.max(1, Math.floor(params.maxResults ?? params.defaultMaxResults));
  const tenant = params.managers.find((entry) => entry.scope === "tenant");
  const agent = params.managers.find((entry) => entry.scope === "agent");
  const scopedTenantSearch = Boolean(tenant);
  const results: MemorySearchResult[] = [];

  if (tenant) {
    const tenantLimit = Math.min(2, maxResults);
    const tenantResults = await tenant.manager.search(params.query, {
      maxResults: tenantLimit,
      minScore: params.minScore,
      sessionKey: params.sessionKey,
    });
    results.push(...decorateScope(tenantResults, "tenant", true));
  }

  if (agent && results.length < maxResults) {
    const agentResults = await agent.manager.search(params.query, {
      maxResults: maxResults - results.length,
      minScore: params.minScore,
      sessionKey: params.sessionKey,
    });
    results.push(...decorateScope(agentResults, "agent", scopedTenantSearch));
  }

  return results.slice(0, maxResults);
}

function resolveScopedRead(params: {
  managers: ScopedMemoryManager[];
  relPath: string;
}): { manager: MemorySearchManager; relPath: string; scope: "tenant" | "agent" } | null {
  const tenant = params.managers.find((entry) => entry.scope === "tenant");
  const agent = params.managers.find((entry) => entry.scope === "agent");
  const rawPath = params.relPath.trim().replace(/\\/g, "/");
  if (rawPath.startsWith("tenant/")) {
    return tenant
      ? { manager: tenant.manager, relPath: rawPath.slice("tenant/".length), scope: "tenant" }
      : null;
  }
  if (rawPath.startsWith("knowledge/")) {
    return agent
      ? { manager: agent.manager, relPath: rawPath.slice("knowledge/".length), scope: "agent" }
      : null;
  }
  return agent ? { manager: agent.manager, relPath: rawPath, scope: "agent" } : null;
}

export function createMemorySearchTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
  /** Override Markdown memory root (multi-tenant: tenants/{tid}/agents/{agentId}/knowledge/). */
  workspaceDir?: string;
  /** Override the default SQLite index path when memorySearch.store.path is not configured. */
  defaultStorePath?: string;
  /** Tenant-level enterprise memory root for scoped tenant-first retrieval. */
  tenantWorkspaceDir?: string;
  /** Tenant-level enterprise memory SQLite index path for scoped tenant-first retrieval. */
  tenantDefaultStorePath?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;
  const settings = resolveMemorySearchConfig(cfg, agentId, {
    defaultStorePath: options.defaultStorePath,
  });
  return {
    label: "Memory Search",
    name: "memory_search",
    description:
      "Mandatory recall step: semantically search MEMORY.md + memory/*.md (and optional session transcripts) before answering questions about prior work, decisions, dates, people, preferences, or todos; returns top snippets with path + lines. If response has disabled=true, memory retrieval is unavailable and should be surfaced to the user.",
    parameters: MemorySearchSchema,
    execute: async (_toolCallId, params) => {
      const query = readStringParam(params, "query", { required: true });
      const maxResults = readNumberParam(params, "maxResults");
      const minScore = readNumberParam(params, "minScore");
      const { managers, error } = await resolveScopedMemoryManagers({
        cfg,
        agentId,
        agentWorkspaceDir: options.workspaceDir,
        agentDefaultStorePath: options.defaultStorePath,
        tenantWorkspaceDir: options.tenantWorkspaceDir,
        tenantDefaultStorePath: options.tenantDefaultStorePath,
      });
      if (managers.length === 0) {
        return jsonResult(buildMemorySearchUnavailableResult(error));
      }
      try {
        const citationsMode = resolveMemoryCitationsMode(cfg);
        const includeCitations = shouldIncludeCitations({
          mode: citationsMode,
          sessionKey: options.agentSessionKey,
        });
        const rawResults = await searchScopedMemory({
          managers,
          query,
          maxResults,
          minScore,
          sessionKey: options.agentSessionKey,
          defaultMaxResults: settings?.query.maxResults ?? 6,
        });
        const status = managers[managers.length - 1].manager.status();
        const decorated = decorateCitations(rawResults, includeCitations);
        const resolved = resolveMemoryBackendConfig({
          cfg,
          agentId,
          workspaceDir: options.workspaceDir,
        });
        const results =
          status.backend === "qmd"
            ? clampResultsByInjectedChars(decorated, resolved.qmd?.limits.maxInjectedChars)
            : decorated;
        const searchMode = (status.custom as { searchMode?: string } | undefined)?.searchMode;
        return jsonResult({
          results,
          provider: status.provider,
          model: status.model,
          fallback: status.fallback,
          citations: citationsMode,
          mode: searchMode,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult(buildMemorySearchUnavailableResult(message));
      }
    },
  };
}

export function createMemoryGetTool(options: {
  config?: OpenClawConfig;
  agentSessionKey?: string;
  /** Override Markdown memory root (multi-tenant: tenants/{tid}/agents/{agentId}/knowledge/). */
  workspaceDir?: string;
  /** Override the default SQLite index path when memorySearch.store.path is not configured. */
  defaultStorePath?: string;
  /** Tenant-level enterprise memory root for scoped reads. */
  tenantWorkspaceDir?: string;
  /** Tenant-level enterprise memory SQLite index path for scoped reads. */
  tenantDefaultStorePath?: string;
}): AnyAgentTool | null {
  const ctx = resolveMemoryToolContext(options);
  if (!ctx) {
    return null;
  }
  const { cfg, agentId } = ctx;
  return {
    label: "Memory Get",
    name: "memory_get",
    description:
      "Safe snippet read from MEMORY.md or memory/*.md with optional from/lines; use after memory_search to pull only the needed lines and keep context small.",
    parameters: MemoryGetSchema,
    execute: async (_toolCallId, params) => {
      const relPath = readStringParam(params, "path", { required: true });
      const from = readNumberParam(params, "from", { integer: true });
      const lines = readNumberParam(params, "lines", { integer: true });
      const { managers, error } = await resolveScopedMemoryManagers({
        cfg,
        agentId,
        agentWorkspaceDir: options.workspaceDir,
        agentDefaultStorePath: options.defaultStorePath,
        tenantWorkspaceDir: options.tenantWorkspaceDir,
        tenantDefaultStorePath: options.tenantDefaultStorePath,
      });
      if (managers.length === 0) {
        return jsonResult({ path: relPath, text: "", disabled: true, error });
      }
      try {
        const scoped = resolveScopedRead({ managers, relPath });
        if (!scoped) {
          return jsonResult({ path: relPath, text: "", disabled: true, error: "path required" });
        }
        const result = await scoped.manager.readFile({
          relPath: scoped.relPath,
          from: from ?? undefined,
          lines: lines ?? undefined,
        });
        const scopedTenantRead = managers.some((entry) => entry.scope === "tenant");
        const prefix = scoped.scope === "tenant" ? "tenant/" : "knowledge/";
        const shouldPrefix = scoped.scope === "tenant" || scopedTenantRead;
        return jsonResult({
          ...result,
          path:
            shouldPrefix && !result.path.startsWith(prefix)
              ? `${prefix}${result.path}`
              : result.path,
          ...(shouldPrefix
            ? {
                scope: scoped.scope,
                sourceLabel: scoped.scope === "tenant" ? "Enterprise Memory" : "Agent Knowledge",
              }
            : {}),
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return jsonResult({ path: relPath, text: "", disabled: true, error: message });
      }
    },
  };
}

function resolveMemoryCitationsMode(cfg: OpenClawConfig): MemoryCitationsMode {
  const mode = cfg.memory?.citations;
  if (mode === "on" || mode === "off" || mode === "auto") {
    return mode;
  }
  return "auto";
}

function decorateCitations(results: MemorySearchResult[], include: boolean): MemorySearchResult[] {
  if (!include) {
    return results.map((entry) => ({ ...entry, citation: undefined }));
  }
  return results.map((entry) => {
    const citation = formatCitation(entry);
    const snippet = `${entry.snippet.trim()}\n\nSource: ${citation}`;
    return { ...entry, citation, snippet };
  });
}

function formatCitation(entry: MemorySearchResult): string {
  const lineRange =
    entry.startLine === entry.endLine
      ? `#L${entry.startLine}`
      : `#L${entry.startLine}-L${entry.endLine}`;
  return `${entry.path}${lineRange}`;
}

function clampResultsByInjectedChars(
  results: MemorySearchResult[],
  budget?: number,
): MemorySearchResult[] {
  if (!budget || budget <= 0) {
    return results;
  }
  let remaining = budget;
  const clamped: MemorySearchResult[] = [];
  for (const entry of results) {
    if (remaining <= 0) {
      break;
    }
    const snippet = entry.snippet ?? "";
    if (snippet.length <= remaining) {
      clamped.push(entry);
      remaining -= snippet.length;
    } else {
      const trimmed = snippet.slice(0, Math.max(0, remaining));
      clamped.push({ ...entry, snippet: trimmed });
      break;
    }
  }
  return clamped;
}

function buildMemorySearchUnavailableResult(error: string | undefined) {
  const reason = (error ?? "memory search unavailable").trim() || "memory search unavailable";
  const isQuotaError = /insufficient_quota|quota|429/.test(reason.toLowerCase());
  const warning = isQuotaError
    ? "Memory search is unavailable because the embedding provider quota is exhausted."
    : "Memory search is unavailable due to an embedding/provider error.";
  const action = isQuotaError
    ? "Top up or switch embedding provider, then retry memory_search."
    : "Check embedding provider configuration and retry memory_search.";
  return {
    results: [],
    disabled: true,
    unavailable: true,
    error: reason,
    warning,
    action,
  };
}

function shouldIncludeCitations(params: {
  mode: MemoryCitationsMode;
  sessionKey?: string;
}): boolean {
  if (params.mode === "on") {
    return true;
  }
  if (params.mode === "off") {
    return false;
  }
  // auto: show citations in direct chats; suppress in groups/channels by default.
  const chatType = deriveChatTypeFromSessionKey(params.sessionKey);
  return chatType === "direct";
}

function deriveChatTypeFromSessionKey(sessionKey?: string): "direct" | "group" | "channel" {
  const parsed = parseAgentSessionKey(sessionKey);
  if (!parsed?.rest) {
    return "direct";
  }
  const tokens = new Set(parsed.rest.toLowerCase().split(":").filter(Boolean));
  if (tokens.has("channel")) {
    return "channel";
  }
  if (tokens.has("group")) {
    return "group";
  }
  return "direct";
}
