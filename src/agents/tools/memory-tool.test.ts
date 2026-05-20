import { beforeEach, describe, expect, it } from "vitest";
import {
  getLastMemoryManagerParams,
  getMemoryManagerParamCalls,
  resetMemoryToolMockState,
  setMemoryOutlineImpl,
  setMemoryReadFileImpl,
  setMemoryRouteImpl,
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

  it("keeps memory_search payloads compact", async () => {
    const longSnippet = "x".repeat(900);
    setMemorySearchImpl(async () =>
      Array.from({ length: 8 }, (_, index) => ({
        path: `memory/doc-${index}.md`,
        startLine: 1,
        endLine: 3,
        score: 1 - index * 0.01,
        snippet: longSnippet,
        source: "memory",
      })),
    );

    const tool = createMemorySearchTool({
      config: { agents: { list: [{ id: "main", default: true }] } },
    });
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("compact-search", { query: "hello", maxResults: 99 });
    const details = result.details as { results: Array<{ snippet: string }> };

    expect(details.results).toHaveLength(4);
    expect(details.results[0]?.snippet.length).toBeLessThanOrEqual(470);
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

  it("lists memory tools before web tools so internal questions prefer knowledge", async () => {
    const tools = createOpenClawTools({
      config: { agents: { list: [{ id: "main", default: true }] } },
      agentSessionKey: "agent:main:main",
      tenantId: "tenant-alpha",
      tenantUserId: "user-alpha",
    });
    const names = tools.map((tool) => tool.name);
    const memorySearchIndex = names.indexOf("memory_search");
    const webSearchIndex = names.indexOf("web_search");

    expect(memorySearchIndex).toBeGreaterThanOrEqual(0);
    expect(webSearchIndex).toBeGreaterThanOrEqual(0);
    expect(memorySearchIndex).toBeLessThan(webSearchIndex);
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

  it("prefixes memory_outline results by tenant and agent scope", async () => {
    setMemoryOutlineImpl(async (params) => ({
      files: [
        {
          path: params?.relPath ?? "MEMORY.md",
          sections: [
            {
              title: "Setup",
              level: 1,
              startLine: 1,
              endLine: 4,
              preview: "Install steps.",
            },
          ],
        },
      ],
    }));
    const tenantId = "tenant-alpha";
    const config = { agents: { list: [{ id: "main", default: true }] } };
    const tools = createOpenClawTools({
      config,
      agentSessionKey: "agent:main:main",
      workspaceDir: "/tmp/user-workspace",
      tenantId,
      tenantUserId: "user-alpha",
    });
    const tool = tools.find((candidate) => candidate.name === "memory_outline");
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("tenant-outline", {});

    expect(result.details).toEqual({
      files: [
        {
          path: "tenant/MEMORY.md",
          scope: "tenant",
          sourceLabel: "Enterprise Memory",
          sections: [
            {
              title: "Setup",
              level: 1,
              startLine: 1,
              endLine: 4,
              preview: "Install steps.",
            },
          ],
        },
        {
          path: "knowledge/MEMORY.md",
          scope: "agent",
          sourceLabel: "Agent Knowledge",
          sections: [
            {
              title: "Setup",
              level: 1,
              startLine: 1,
              endLine: 4,
              preview: "Install steps.",
            },
          ],
        },
      ],
    });
  });

  it("passes compact defaults to memory_outline", async () => {
    const calls: Array<{ maxSections?: number; previewChars?: number }> = [];
    setMemoryOutlineImpl(async (params) => {
      calls.push({
        maxSections: params?.maxSections,
        previewChars: params?.previewChars,
      });
      return { files: [] };
    });
    const tools = createOpenClawTools({
      config: { agents: { list: [{ id: "main", default: true }] } },
      agentSessionKey: "agent:main:main",
      tenantId: "tenant-alpha",
      tenantUserId: "user-alpha",
    });
    const tool = tools.find((candidate) => candidate.name === "memory_outline");
    if (!tool) {
      throw new Error("tool missing");
    }

    await tool.execute("compact-outline", { maxSections: 999, previewChars: 999 });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ maxSections: 40, previewChars: 180 });
    expect(calls[1]).toEqual({ maxSections: 40, previewChars: 180 });
  });

  it("prefixes memory_route results by tenant and agent scope", async () => {
    setMemoryRouteImpl(async (params) => ({
      files: [
        {
          path: params.relPath ?? "memory/manual.md",
          matches: [
            {
              score: 7,
              section: {
                id: "s1",
                title: "Reset Password",
                level: 2,
                startLine: 10,
                endLine: 20,
                preview: "Reset password steps.",
                summary: "Reset password steps.",
                keywords: ["reset", "password"],
                titlePath: ["Accounts", "Reset Password"],
              },
              blocks: [
                {
                  id: "s1:b1",
                  sectionId: "s1",
                  titlePath: ["Accounts", "Reset Password"],
                  startLine: 11,
                  endLine: 13,
                  preview: "Click reset password.",
                  keywords: ["reset", "password"],
                },
              ],
            },
          ],
        },
      ],
    }));
    const tenantId = "tenant-alpha";
    const config = { agents: { list: [{ id: "main", default: true }] } };
    const tools = createOpenClawTools({
      config,
      agentSessionKey: "agent:main:main",
      workspaceDir: "/tmp/user-workspace",
      tenantId,
      tenantUserId: "user-alpha",
    });
    const tool = tools.find((candidate) => candidate.name === "memory_route");
    if (!tool) {
      throw new Error("tool missing");
    }

    const result = await tool.execute("tenant-route", { query: "reset password" });
    const details = result.details as {
      files: Array<{ matches: Array<{ section: { title: string } }> }>;
    };

    expect(result.details).toMatchObject({
      files: [
        {
          path: "tenant/memory/manual.md",
          scope: "tenant",
          sourceLabel: "Enterprise Memory",
        },
        {
          path: "knowledge/memory/manual.md",
          scope: "agent",
          sourceLabel: "Agent Knowledge",
        },
      ],
    });
    expect(details.files[0]?.matches[0]?.section.title).toBe("Reset Password");
  });

  it("passes compact defaults to memory_route", async () => {
    const calls: Array<{
      maxResults?: number;
      maxBlocksPerSection?: number;
      previewChars?: number;
    }> = [];
    setMemoryRouteImpl(async (params) => {
      calls.push({
        maxResults: params.maxResults,
        maxBlocksPerSection: params.maxBlocksPerSection,
        previewChars: params.previewChars,
      });
      return { files: [] };
    });
    const tools = createOpenClawTools({
      config: { agents: { list: [{ id: "main", default: true }] } },
      agentSessionKey: "agent:main:main",
      tenantId: "tenant-alpha",
      tenantUserId: "user-alpha",
    });
    const tool = tools.find((candidate) => candidate.name === "memory_route");
    if (!tool) {
      throw new Error("tool missing");
    }

    await tool.execute("compact-route", {
      query: "reset password",
      maxResults: 999,
      maxBlocksPerSection: 999,
      previewChars: 999,
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      maxResults: 4,
      maxBlocksPerSection: 2,
      previewChars: 240,
    });
    expect(calls[1]).toEqual({
      maxResults: 4,
      maxBlocksPerSection: 2,
      previewChars: 240,
    });
  });
});
