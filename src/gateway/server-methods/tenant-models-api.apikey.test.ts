/**
 * Regression tests for tenant.models API:
 *  - tier field is transparently passed through create/update into JSONB
 *  - apiKey semantics on update:
 *      undefined  → keep existing (DB-layer partial update)
 *      ""         → keep existing (v4 addition: frontend edit modal leaves blank)
 *      non-empty  → overwrite
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js", () => ({
  isDbInitialized: () => true,
}));
vi.mock("../../db/models/tenant-model.js", () => ({
  createTenantModel: vi.fn(),
  listTenantModels: vi.fn().mockResolvedValue([]),
  getTenantModel: vi.fn(),
  updateTenantModel: vi.fn(),
  deleteTenantModel: vi.fn(),
}));
vi.mock("../../db/models/tenant-agent.js", () => ({
  listTenantAgents: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../db/models/audit-log.js", () => ({
  createAuditLog: vi.fn(),
}));
vi.mock("../../auth/rbac.js", () => ({
  assertPermission: vi.fn(),
  RbacError: class RbacError extends Error {},
}));
vi.mock("../../config/tenant-config.js", () => ({
  invalidateTenantConfigCache: vi.fn(),
}));

import * as tenantModelDb from "../../db/models/tenant-model.js";
import { tenantModelsHandlers } from "./tenant-models-api.js";
import type { TenantModel } from "../../db/types.js";

function makeStubModel(overrides: Partial<TenantModel> = {}): TenantModel {
  const now = new Date("2026-04-22T00:00:00Z");
  return {
    id: "m-1",
    tenantId: "t1",
    providerType: "anthropic",
    providerName: "Main",
    baseUrl: "https://api.anthropic.com/v1",
    apiProtocol: "anthropic-messages",
    authMode: "api-key",
    apiKeyEncrypted: "sk-original",
    extraHeaders: {},
    extraConfig: {},
    models: [{ id: "claude-sonnet-4-6", name: "Sonnet" }],
    visibility: "private",
    isActive: true,
    createdBy: "u1",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeCtx() {
  return {
    client: {
      tenant: { tenantId: "t1", userId: "u1", role: "admin" as const },
    },
    respond: vi.fn(),
    context: { reloadDbChannels: vi.fn() },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  (tenantModelDb.listTenantModels as any).mockResolvedValue([]);
  (tenantModelDb.listTenantModels as any).mockResolvedValue([]);
});

describe("tenant.models.create — tier field passthrough", () => {
  it("writes tier from request models into the DB layer", async () => {
    (tenantModelDb.createTenantModel as any).mockResolvedValue(
      makeStubModel({
        models: [{ id: "claude-opus-4-7", name: "Opus", tier: "pro", contextWindow: 200000 }],
      }),
    );

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.create"]({
      params: {
        providerType: "anthropic",
        providerName: "Main",
        baseUrl: "https://api.anthropic.com/v1",
        apiProtocol: "anthropic-messages",
        authMode: "api-key",
        apiKey: "sk-xxx",
        models: [{ id: "claude-opus-4-7", name: "Opus", tier: "pro" }],
      },
      ...ctx,
    } as any);

    expect(tenantModelDb.createTenantModel).toHaveBeenCalledWith(
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({ id: "claude-opus-4-7", tier: "pro" }),
        ]),
      }),
    );
    expect(ctx.respond).toHaveBeenCalledWith(true, expect.any(Object));
  });

  it("accepts models array with mixed tiers", async () => {
    (tenantModelDb.createTenantModel as any).mockResolvedValue(makeStubModel());

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.create"]({
      params: {
        providerType: "anthropic",
        providerName: "Main",
        models: [
          { id: "opus", name: "Opus", tier: "pro" },
          { id: "sonnet", name: "Sonnet", tier: "standard" },
          { id: "haiku", name: "Haiku", tier: "lite" },
        ],
      },
      ...ctx,
    } as any);

    const [[call]] = (tenantModelDb.createTenantModel as any).mock.calls;
    const tiers = call.models.map((m: { tier?: string }) => m.tier);
    expect(tiers).toEqual(["pro", "standard", "lite"]);
  });

  it("accepts models without tier (legacy/未分档)", async () => {
    (tenantModelDb.createTenantModel as any).mockResolvedValue(makeStubModel());

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.create"]({
      params: {
        providerType: "qwen",
        providerName: "Qwen",
        models: [{ id: "qwen-plus", name: "Qwen Plus" }],
      },
      ...ctx,
    } as any);

    const [[call]] = (tenantModelDb.createTenantModel as any).mock.calls;
    expect(call.models[0].tier).toBeUndefined();
  });
});

describe("tenant.models.update — tier field passthrough", () => {
  it("passes tier through models array update", async () => {
    (tenantModelDb.updateTenantModel as any).mockResolvedValue(makeStubModel());

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.update"]({
      params: {
        id: "m-1",
        models: [{ id: "claude-sonnet-4-6", name: "Sonnet", tier: "standard" }],
      },
      ...ctx,
    } as any);

    expect(tenantModelDb.updateTenantModel).toHaveBeenCalledWith(
      "t1",
      "m-1",
      expect.objectContaining({
        models: expect.arrayContaining([
          expect.objectContaining({ id: "claude-sonnet-4-6", tier: "standard" }),
        ]),
      }),
    );
  });
});

describe("tenant.models.update — apiKey keep-on-empty semantics", () => {
  it("preserves apiKey when apiKey is undefined (not passed)", async () => {
    (tenantModelDb.updateTenantModel as any).mockResolvedValue(makeStubModel());

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.update"]({
      params: { id: "m-1", providerName: "Renamed" },
      ...ctx,
    } as any);

    const [, , updates] = (tenantModelDb.updateTenantModel as any).mock.calls[0];
    expect(updates).not.toHaveProperty("apiKeyEncrypted");
  });

  it("preserves apiKey when apiKey is empty string (v4: edit modal left blank)", async () => {
    (tenantModelDb.updateTenantModel as any).mockResolvedValue(makeStubModel());

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.update"]({
      params: { id: "m-1", apiKey: "" },
      ...ctx,
    } as any);

    const [, , updates] = (tenantModelDb.updateTenantModel as any).mock.calls[0];
    expect(updates).not.toHaveProperty("apiKeyEncrypted");
  });

  it("overwrites apiKey when a non-empty value is provided", async () => {
    (tenantModelDb.updateTenantModel as any).mockResolvedValue(makeStubModel());

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.update"]({
      params: { id: "m-1", apiKey: "sk-new" },
      ...ctx,
    } as any);

    const [, , updates] = (tenantModelDb.updateTenantModel as any).mock.calls[0];
    expect(updates.apiKeyEncrypted).toBe("sk-new");
  });
});
