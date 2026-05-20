import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { resetEmbeddingMocks } from "./embedding.test-mocks.js";
import type { MemoryIndexManager } from "./index.js";
import { getRequiredMemoryIndexManager } from "./test-manager-helpers.js";

function createMemorySearchCfg(options: {
  workspaceDir: string;
  indexPath: string;
}): OpenClawConfig {
  return {
    agents: {
      defaults: {
        workspace: options.workspaceDir,
        memorySearch: {
          provider: "openai",
          model: "mock-embed",
          store: { path: options.indexPath, vector: { enabled: false } },
          cache: { enabled: false },
          query: { minScore: 0, hybrid: { enabled: false } },
          sync: { watch: false, onSessionStart: false, onSearch: false },
        },
      },
      list: [{ id: "main", default: true }],
    },
  } as OpenClawConfig;
}

describe("MemoryIndexManager.readFile", () => {
  let workspaceDir: string;
  let indexPath: string;
  let manager: MemoryIndexManager | null = null;

  beforeEach(async () => {
    resetEmbeddingMocks();
    workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-mem-read-"));
    indexPath = path.join(workspaceDir, "index.sqlite");
    await fs.mkdir(path.join(workspaceDir, "memory"), { recursive: true });
  });

  afterEach(async () => {
    if (manager) {
      await manager.close();
      manager = null;
    }
    await fs.rm(workspaceDir, { recursive: true, force: true });
  });

  it("returns empty text when the requested file does not exist", async () => {
    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });

    const relPath = "memory/2099-01-01.md";
    const result = await manager.readFile({ relPath });
    expect(result).toEqual({ text: "", path: relPath });
  });

  it("returns content slices when the file exists", async () => {
    const relPath = "memory/2026-02-20.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, ["line 1", "line 2", "line 3"].join("\n"), "utf-8");

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });

    const result = await manager.readFile({ relPath, from: 2, lines: 1 });
    expect(result).toEqual({ text: "line 2", path: relPath });
  });

  it("returns Markdown outlines for progressive reads", async () => {
    const relPath = "memory/manual.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(
      absPath,
      ["# Accounts", "Create users.", "## Reset Password", "Use the reset flow."].join("\n"),
      "utf-8",
    );

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });

    const result = await manager.outline({ relPath, previewChars: 80 });
    expect(result.files).toMatchObject([
      {
        path: relPath,
        sections: [
          {
            id: "s1",
            title: "Accounts",
            level: 1,
            startLine: 1,
            endLine: 2,
            preview: "Create users.",
            summary: "Create users.",
            titlePath: ["Accounts"],
          },
          {
            id: "s2",
            title: "Reset Password",
            level: 2,
            startLine: 3,
            endLine: 4,
            preview: "Use the reset flow.",
            summary: "Use the reset flow.",
            titlePath: ["Accounts", "Reset Password"],
            parentId: "s1",
          },
        ],
      },
    ]);
  });

  it("routes progressive matches for a memory file", async () => {
    const relPath = "memory/manual.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(
      absPath,
      [
        "# Accounts",
        "Create users.",
        "## Reset Password",
        "Open account settings.",
        "Click reset password and confirm the email code.",
      ].join("\n"),
      "utf-8",
    );

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });

    const result = await manager.route({ query: "reset password", relPath });
    expect(result.files[0]?.path).toBe(relPath);
    expect(result.files[0]?.matches[0]?.section.title).toBe("Reset Password");
    expect(result.files[0]?.matches[0]?.blocks[0]?.startLine).toBe(4);
  });

  it("serves progressive outline and route from the index after sync", async () => {
    const relPath = "memory/manual.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(
      absPath,
      [
        "# Billing",
        "Invoices and payment settings.",
        "## Refunds",
        "Open billing settings.",
        "Choose refund and confirm the transaction.",
      ].join("\n"),
      "utf-8",
    );

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });
    await manager.sync({ force: true });

    const realReadFile = fs.readFile;
    const readSpy = vi
      .spyOn(fs, "readFile")
      .mockImplementation(async (...args: Parameters<typeof realReadFile>) => {
        const [target] = args;
        if (typeof target === "string" && path.resolve(target) === absPath) {
          throw new Error("progressive cache should avoid reading the source file");
        }
        return realReadFile(...args);
      });

    const outline = await manager.outline({ relPath });
    expect(outline.files[0]?.sections[0]?.title).toBe("Billing");

    const routed = await manager.route({ query: "refund transaction", relPath });
    expect(routed.files[0]?.matches[0]?.section.title).toBe("Refunds");

    readSpy.mockRestore();
  });

  it("falls back to progressive search when FTS and embeddings are unavailable", async () => {
    const relPath = "memory/manual.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(
      absPath,
      [
        "# 九米智能客服解决方案",
        "## 九米跨境电商的痛点",
        "客户经常咨询订单、物流、退款与海外仓异常。",
        "人工客服响应慢，跨部门转办容易掉单。",
      ].join("\n"),
      "utf-8",
    );

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });
    await manager.sync({ force: true });

    const result = await manager.search("九米跨境电商的痛点有哪些", {
      maxResults: 3,
      minScore: 0,
    });
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: relPath,
          source: "memory",
          snippet: expect.stringContaining("人工客服"),
        }),
      ]),
    );
    expect(result[0]).toMatchObject({
      path: relPath,
      source: "memory",
    });
  });

  it("returns empty text when the requested slice is past EOF", async () => {
    const relPath = "memory/window.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, ["alpha", "beta"].join("\n"), "utf-8");

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });

    const result = await manager.readFile({ relPath, from: 10, lines: 5 });
    expect(result).toEqual({ text: "", path: relPath });
  });

  it("returns empty text when the file disappears after stat", async () => {
    const relPath = "memory/transient.md";
    const absPath = path.join(workspaceDir, relPath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, "first\nsecond", "utf-8");

    manager = await getRequiredMemoryIndexManager({
      cfg: createMemorySearchCfg({ workspaceDir, indexPath }),
      agentId: "main",
    });

    const realReadFile = fs.readFile;
    let injected = false;
    const readSpy = vi
      .spyOn(fs, "readFile")
      .mockImplementation(async (...args: Parameters<typeof realReadFile>) => {
        const [target, options] = args;
        if (!injected && typeof target === "string" && path.resolve(target) === absPath) {
          injected = true;
          const err = new Error("missing") as NodeJS.ErrnoException;
          err.code = "ENOENT";
          throw err;
        }
        return realReadFile(target, options);
      });

    const result = await manager.readFile({ relPath });
    expect(result).toEqual({ text: "", path: relPath });

    readSpy.mockRestore();
  });
});
