import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastMemoryManagerParams,
  getMemoryManagerParamCalls,
  resetMemoryToolMockState,
  setMemoryReadFileImpl,
  setMemorySearchImpl,
} from "../../../test/helpers/memory-tool-manager-mock.js";
import {
  resolveTenantAgentKnowledgeDir,
  resolveTenantAgentMemoryIndexPath,
  resolveTenantDir,
  resolveTenantMemoryIndexPath,
} from "../../config/sessions/tenant-paths.js";
import { createOpenClawTools } from "../openclaw-tools.js";
import { createMemorySearchTool } from "./memory-tool.js";

describe("memory_search unavailable payloads", () => {
  beforeEach(() => {
    resetMemoryToolMockState({ searchImpl: async () => [] });
  });

  it("returns explicit unavailable metadata for quota failures", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("openai embeddings failed: 429 insufficient_quota");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("quota", { query: "hello" });
    expect(result.details).toEqual({
      results: [],
      disabled: true,
      unavailable: true,
      error: "openai embeddings failed: 429 insufficient_quota",
      warning: "Memory search is unavailable because the embedding provider quota is exhausted.",
      action: "Top up or switch embedding provider, then retry memory_search.",
    });
  });

  it("returns explicit unavailable metadata for non-quota failures", async () => {
    setMemorySearchImpl(async () => {
      throw new Error("embedding provider timeout");
    });

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("generic", { query: "hello" });
    expect(result.details).toEqual({
      results: [],
      disabled: true,
      unavailable: true,
      error: "embedding provider timeout",
      warning: "Memory search is unavailable due to an embedding/provider error.",
      action: "Check embedding provider configuration and retry memory_search.",
    });
  });

  it("uses tenant agent knowledge and index paths when wired through core tools", async () => {
    const tenantId = "tenant-alpha";
    const config = { agents: { list: [{ id: "main", default: true }] } };
    const tools = createOpenClawTools({
      config,
      agentSessionKey: "agent:main:main",
      workspaceDir: "/tmp/user-workspace",
      tenantId,
      tenantUserId: "user-alpha",
    });
    const tool = tools.find((candidate) => candidate.name === "memory_search");
    if (!tool) {
      throw new Error("tool missing");
    }

    await tool.execute("tenant-paths", { query: "hello" });

    const params = getLastMemoryManagerParams<{
      workspaceDir?: string;
      defaultStorePath?: string;
    }>();
    expect(params?.workspaceDir).toBe(resolveTenantAgentKnowledgeDir(tenantId, "main"));
    expect(params?.defaultStorePath).toBe(resolveTenantAgentMemoryIndexPath(tenantId, "main"));

    const calls = getMemoryManagerParamCalls<{
      workspaceDir?: string;
      defaultStorePath?: string;
    }>();
    expect(calls[0]?.workspaceDir).toBe(resolveTenantDir(tenantId));
    expect(calls[0]?.defaultStorePath).toBe(resolveTenantMemoryIndexPath(tenantId));
    expect(calls[1]?.workspaceDir).toBe(resolveTenantAgentKnowledgeDir(tenantId, "main"));
    expect(calls[1]?.defaultStorePath).toBe(resolveTenantAgentMemoryIndexPath(tenantId, "main"));
  });

  it("routes memory_get tenant paths to tenant memory scope", async () => {
    setMemoryReadFileImpl(async (params) => ({ text: "enterprise", path: params.relPath }));
    const tenantId = "tenant-alpha";
    const config = { agents: { list: [{ id: "main", default: true }] } };
    const tools = createOpenClawTools({
      config,
      agentSessionKey: "agent:main:main",
      workspaceDir: "/tmp/user-workspace",
      tenantId,
      tenantUserId: "user-alpha",
    });
    const tool = tools.find((candidate) => candidate.name === "memory_get");
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("tenant-get", { path: "tenant/MEMORY.md" });

    expect(result.details).toEqual({
      text: "enterprise",
      path: "tenant/MEMORY.md",
      scope: "tenant",
      sourceLabel: "Enterprise Memory",
    });
  });
});
