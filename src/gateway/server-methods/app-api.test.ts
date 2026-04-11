import { describe, it, expect, beforeEach, vi } from "vitest";
import * as storeModule from "../../runtime/app-installer/store.js";
import type { RegisteredPipeline } from "../../runtime/pipeline-runner/registry.js";
import type { RunnerResult } from "../../runtime/pipeline-runner/types.js";
import type { AppApiConfig } from "./app-api.js";
import { createAppApiHandlers } from "./app-api.js";

vi.mock("../../runtime/app-installer/store.js");

describe("createAppApiHandlers", () => {
  // oxlint-disable-next-line typescript/no-explicit-any
  let mockRegistry: any;
  // oxlint-disable-next-line typescript/no-explicit-any
  let mockInstaller: any;
  // oxlint-disable-next-line typescript/no-explicit-any
  let mockLlmDeps: any;
  // oxlint-disable-next-line typescript/no-explicit-any
  let mockExecute: any;
  // oxlint-disable-next-line typescript/no-explicit-any
  let handlers: any;

  beforeEach(() => {
    mockRegistry = {
      listPipelines: vi.fn(),
      getPipeline: vi.fn(),
      loadOne: vi.fn(),
      remove: vi.fn(),
    };

    mockInstaller = {
      install: vi.fn(),
      uninstall: vi.fn(),
    };

    mockLlmDeps = {
      callProvider: vi.fn(),
    };

    mockExecute = vi.fn();

    const cfg: AppApiConfig = {
      registry: mockRegistry,
      installer: mockInstaller,
      llmDeps: mockLlmDeps,
      executePipeline: mockExecute,
    };

    handlers = createAppApiHandlers(cfg);
  });

  it("app.install clones, records, and triggers registry load", async () => {
    mockInstaller.install.mockResolvedValue({
      name: "pivot",
      version: "0.1.0",
      appDir: "/app/dir",
      commit: "abc123",
    });

    const result = await handlers["app.install"]({
      params: { gitUrl: "https://github.com/example/pivot.git" },
      client: { tenantContext: { tenantId: "tenant-a" } },
    });

    expect(mockInstaller.install).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      gitUrl: "https://github.com/example/pivot.git",
    });
    expect(mockRegistry.loadOne).toHaveBeenCalledWith("tenant-a", "pivot");
    expect(result).toEqual({ name: "pivot", version: "0.1.0" });
  });

  it("app.uninstall removes from registry then calls installer", async () => {
    mockInstaller.uninstall.mockResolvedValue(undefined);

    const result = await handlers["app.uninstall"]({
      params: { name: "pivot", purgeWorkspace: false },
      client: { tenantContext: { tenantId: "tenant-a" } },
    });

    expect(mockRegistry.remove).toHaveBeenCalledWith("tenant-a", "pivot");
    expect(mockInstaller.uninstall).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      appName: "pivot",
      purgeWorkspace: false,
    });
    expect(result).toEqual({ ok: true });
  });

  it("app.invoke dispatches to the pipeline via registry lookup", async () => {
    const mockPipeline: RegisteredPipeline = {
      name: "process",
      dir: "/app/pivot/pipelines/process",
      definition: {
        name: "process",
        description: "Process data",
        steps: [],
        output: "final",
      },
    };

    mockRegistry.getPipeline.mockReturnValue(mockPipeline);
    mockExecute.mockResolvedValue({
      status: "completed",
      output: { result: "success" },
      progress: ["step1 ✓"],
    } as RunnerResult);

    const result = await handlers["app.invoke"]({
      params: {
        app: "pivot",
        pipeline: "process",
        params: { input: "data" },
      },
      client: { tenantContext: { tenantId: "tenant-a" } },
    });

    expect(mockRegistry.getPipeline).toHaveBeenCalledWith("tenant-a", "pivot", "process");
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        pipeline: mockPipeline,
        input: { input: "data" },
        appName: "pivot",
        tenantId: "tenant-a",
        deps: mockLlmDeps,
      }),
    );
    expect(result).toEqual({ result: "success" });
  });

  it("app.invoke throws when pipeline not found", async () => {
    mockRegistry.getPipeline.mockReturnValue(undefined);

    const promise = handlers["app.invoke"]({
      params: {
        app: "nonexistent",
        pipeline: "missing",
        params: {},
      },
      client: { tenantContext: { tenantId: "tenant-a" } },
    });

    await expect(promise).rejects.toThrow(
      'pipeline "nonexistent/missing" not found for tenant "tenant-a"',
    );
  });

  it("app.list returns installed apps with pipelines", async () => {
    const mockAppsManifest = {
      version: 1,
      installed: [
        {
          name: "pivot",
          version: "0.1.0",
          installedAt: "2026-01-01T00:00:00Z",
          gitUrl: "https://github.com/example/pivot.git",
          commit: "abc123",
          apiVersion: "1.0.0",
        },
      ],
    };

    vi.mocked(storeModule.readAppsManifest).mockResolvedValue(mockAppsManifest);

    const mockPipeline1: RegisteredPipeline = {
      name: "process",
      dir: "/app/pivot/pipelines/process",
      definition: {
        name: "process",
        description: "Process data",
        steps: [],
        output: "final",
      },
    };

    const mockPipeline2: RegisteredPipeline = {
      name: "analyze",
      dir: "/app/pivot/pipelines/analyze",
      definition: {
        name: "analyze",
        description: "Analyze results",
        steps: [],
        output: "report",
      },
    };

    mockRegistry.listPipelines.mockReturnValue([mockPipeline1, mockPipeline2]);

    const result = await handlers["app.list"]({
      client: { tenantContext: { tenantId: "tenant-a" } },
    });

    expect(mockRegistry.listPipelines).toHaveBeenCalledWith("tenant-a", "pivot");
    expect(result).toEqual({
      apps: [
        {
          name: "pivot",
          version: "0.1.0",
          installedAt: "2026-01-01T00:00:00Z",
          pipelines: ["process", "analyze"],
        },
      ],
    });
  });

  describe("all handlers reject when tenantId is missing", () => {
    it("app.list rejects", async () => {
      const promise = handlers["app.list"]({
        client: {},
      });

      await expect(promise).rejects.toThrow("tenant context required (missing tenantId)");
    });

    it("app.install rejects", async () => {
      const promise = handlers["app.install"]({
        params: { gitUrl: "https://example.com/repo.git" },
        client: {},
      });

      await expect(promise).rejects.toThrow("tenant context required (missing tenantId)");
    });

    it("app.uninstall rejects", async () => {
      const promise = handlers["app.uninstall"]({
        params: { name: "test" },
        client: {},
      });

      await expect(promise).rejects.toThrow("tenant context required (missing tenantId)");
    });

    it("app.invoke rejects", async () => {
      const promise = handlers["app.invoke"]({
        params: { app: "test", pipeline: "test" },
        client: {},
      });

      await expect(promise).rejects.toThrow("tenant context required (missing tenantId)");
    });
  });
});
