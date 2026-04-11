import { describe, it, expect, vi } from "vitest";
import type { TenantAppRegistry } from "../runtime/tenant-app-registry/registry.js";
import { createPipelineCronAction } from "./pipeline-action.js";

function mockRegistry(overrides: Partial<TenantAppRegistry> = {}): TenantAppRegistry {
  return {
    getPipeline: vi.fn(),
    ...overrides,
  } as unknown as TenantAppRegistry;
}

describe("pipeline cron action", () => {
  it("invokes executePipeline with the configured (app, pipeline)", async () => {
    const mockExecute = vi.fn().mockResolvedValue({
      status: "completed",
      output: {},
      progress: [],
    });
    const registry = mockRegistry({
      getPipeline: vi.fn().mockReturnValue({
        name: "monitor-scan",
        dir: "/fake",
        definition: {
          name: "monitor-scan",
          description: "",
          input: {},
          steps: [],
          output: "",
          triggers: [],
        },
      }),
    });

    const action = createPipelineCronAction({
      registry,
      llmDeps: { callProvider: vi.fn() },
      executePipeline: mockExecute,
    });

    await action({
      type: "pipeline",
      app: "pivot",
      pipeline: "monitor-scan",
      params: { window_hours: 24 },
      tenantId: "tenant-a",
    });

    expect(registry.getPipeline).toHaveBeenCalledWith("tenant-a", "pivot", "monitor-scan");
    expect(mockExecute).toHaveBeenCalled();
    const args = mockExecute.mock.calls[0][0];
    expect(args.tenantId).toBe("tenant-a");
    expect(args.appName).toBe("pivot");
    expect(args.input).toEqual({ window_hours: 24 });
  });

  it("throws when (app, pipeline) not found for tenant", async () => {
    const registry = mockRegistry({
      getPipeline: vi.fn().mockReturnValue(undefined),
    });
    const action = createPipelineCronAction({
      registry,
      llmDeps: { callProvider: vi.fn() },
      executePipeline: vi.fn(),
    });
    await expect(
      action({
        type: "pipeline",
        app: "pivot",
        pipeline: "missing",
        params: {},
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("surfaces pipeline execution errors", async () => {
    const registry = mockRegistry({
      getPipeline: vi.fn().mockReturnValue({
        name: "x",
        dir: "/fake",
        definition: {
          name: "x",
          description: "",
          input: {},
          steps: [],
          output: "",
          triggers: [],
        },
      }),
    });
    const mockExecute = vi.fn().mockResolvedValue({
      status: "error",
      error: "boom",
      progress: [],
    });
    const action = createPipelineCronAction({
      registry,
      llmDeps: { callProvider: vi.fn() },
      executePipeline: mockExecute,
    });
    await expect(
      action({
        type: "pipeline",
        app: "pivot",
        pipeline: "x",
        params: {},
        tenantId: "tenant-a",
      }),
    ).rejects.toThrow(/boom/);
  });
});
