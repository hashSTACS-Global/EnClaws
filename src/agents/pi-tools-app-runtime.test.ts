import { describe, it, expect, vi } from "vitest";
import type { AppInstaller } from "../runtime/app-installer/installer.js";
import type { LLMStepDeps } from "../runtime/pipeline-runner/llm-step.js";
import type { TenantAppRegistry } from "../runtime/tenant-app-registry/registry.js";
import { createAppRuntimeTools } from "./pi-tools-app-runtime.js";

function mockDeps() {
  return {
    registry: {
      loadOne: vi.fn(),
      remove: vi.fn(),
      getPipeline: vi.fn().mockReturnValue({
        name: "echo",
        dir: "/fake",
        definition: {
          name: "echo",
          description: "",
          input: {},
          steps: [],
          output: "step1",
          triggers: [],
        },
      }),
      listPipelines: vi.fn().mockReturnValue([]),
      listApps: vi.fn().mockReturnValue([]),
    } as unknown as TenantAppRegistry,
    installer: {
      install: vi.fn().mockResolvedValue({
        name: "fake-pivot",
        version: "0.1.0",
        appDir: "/tmp/apps/fake-pivot",
        commit: "a".repeat(40),
      }),
      uninstall: vi.fn(),
    } as unknown as AppInstaller,
    llmDeps: { callProvider: vi.fn() } as LLMStepDeps,
  };
}

describe("createAppRuntimeTools", () => {
  it("returns 4 AgentTool entries when deps provided", () => {
    const tools = createAppRuntimeTools({
      deps: mockDeps(),
      resolveTenantId: () => "tenant-a",
    });
    const names = tools.map((t) => t.name).toSorted();
    expect(names).toEqual(["app_install", "app_invoke", "app_list", "app_uninstall"]);
  });

  it("app_invoke passes session tenantId, not caller-provided", async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      status: "completed",
      output: { ok: true },
      progress: [],
    });
    const deps = mockDeps();
    const tools = createAppRuntimeTools({
      deps,
      resolveTenantId: () => "tenant-a",
      executePipeline: mockExecute,
    });
    const appInvoke = tools.find((t) => t.name === "app_invoke");
    if (!appInvoke) {
      throw new Error("app_invoke tool not found");
    }
    const result = await appInvoke.execute({
      app: "fake-pivot",
      pipeline: "echo",
      params: { message: "hi" },
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { getPipeline } = deps.registry;
    expect(getPipeline).toHaveBeenCalledWith("tenant-a", "fake-pivot", "echo");
    expect(mockExecute).toHaveBeenCalled();
    const callArgs = mockExecute.mock.calls[0][0];
    expect(callArgs.tenantId).toBe("tenant-a");
    expect(result).toEqual({ ok: true });
  });

  it("app_install wraps installer + calls registry.loadOne", async () => {
    const deps = mockDeps();
    const tools = createAppRuntimeTools({
      deps,
      resolveTenantId: () => "tenant-a",
    });
    const appInstall = tools.find((t) => t.name === "app_install");
    if (!appInstall) {
      throw new Error("app_install tool not found");
    }
    const result = await appInstall.execute({
      gitUrl: "https://example.com/fake.git",
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { install } = deps.installer;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const { loadOne } = deps.registry;
    expect(install).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      gitUrl: "https://example.com/fake.git",
    });
    expect(loadOne).toHaveBeenCalledWith("tenant-a", "fake-pivot");
    expect(result).toMatchObject({ name: "fake-pivot" });
  });

  it("app_list returns the manifest summary", async () => {
    const deps = mockDeps();
    const tools = createAppRuntimeTools({
      deps,
      resolveTenantId: () => "tenant-a",
    });
    const appList = tools.find((t) => t.name === "app_list");
    if (!appList) {
      throw new Error("app_list tool not found");
    }
    const result = await appList.execute({});
    expect(result).toHaveProperty("apps");
  });

  it("throws when resolveTenantId returns falsy", async () => {
    const tools = createAppRuntimeTools({
      deps: mockDeps(),
      resolveTenantId: () => undefined,
    });
    const appInvoke = tools.find((t) => t.name === "app_invoke");
    if (!appInvoke) {
      throw new Error("app_invoke tool not found");
    }
    await expect(appInvoke.execute({ app: "x", pipeline: "y", params: {} })).rejects.toThrow(
      /tenant/,
    );
  });
});
