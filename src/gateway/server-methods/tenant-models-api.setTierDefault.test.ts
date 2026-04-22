/**
 * Regression tests for tenant.models.setTierDefault: the transactional,
 * tenant-wide "mark this model as the default for its tier" RPC.
 *
 * Backend contract:
 *  - Validates tier ∈ {lite, standard, pro} and providerId/modelId presence
 *  - Refuses if the target model doesn't exist or its recorded tier
 *    doesn't match the requested tier
 *  - Walks every tenant_models row that has ≥1 model in the target tier,
 *    rewrites the in-tier entries so only the target carries
 *    isTierDefault=true, skips no-op rows
 *  - Applies all writes inside a single withTransaction so the catalog
 *    never shows "two defaults" or "zero defaults" in the middle of the
 *    operation
 *  - Returns { updated: N } where N is the number of rows actually changed
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/index.js", () => ({
  isDbInitialized: () => true,
  // Execute the callback with a fake tx client that records SQL calls,
  // then return whatever the callback resolves to. No real TX — we only
  // care that (a) the callback actually runs, (b) every update goes
  // through the same client.
  withTransaction: vi.fn(async (fn: (client: { query: ReturnType<typeof vi.fn> }) => Promise<unknown>) => {
    const client = { query: vi.fn().mockResolvedValue({ rowCount: 1 }) };
    const result = await fn(client);
    (withTransactionSpy.client as typeof client) = client;
    return result;
  }),
  getDbType: () => "postgres",
  DB_SQLITE: "sqlite",
}));

vi.mock("../../db/models/tenant-model.js", () => ({
  listTenantModels: vi.fn(),
  updateTenantModel: vi.fn(),
  createTenantModel: vi.fn(),
  getTenantModel: vi.fn(),
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

import * as dbIndex from "../../db/index.js";
import * as tenantModelDb from "../../db/models/tenant-model.js";
import { tenantModelsHandlers } from "./tenant-models-api.js";
import type { TenantModel } from "../../db/types.js";

// Shared handle so tests can inspect the fake tx client the mock produced.
const withTransactionSpy: { client: { query: ReturnType<typeof vi.fn> } | null } = { client: null };

function makeProvider(overrides: Partial<TenantModel> = {}): TenantModel {
  const now = new Date("2026-04-22T00:00:00Z");
  return {
    id: "p1",
    tenantId: "t1",
    providerType: "anthropic",
    providerName: "Anthropic",
    baseUrl: null,
    apiProtocol: "anthropic-messages",
    authMode: "api-key",
    apiKeyEncrypted: null,
    extraHeaders: {},
    extraConfig: {},
    models: [],
    visibility: "private",
    isActive: true,
    createdBy: null,
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
  withTransactionSpy.client = null;
});

describe("tenant.models.setTierDefault — input validation", () => {
  it("rejects an unknown tier", async () => {
    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "ultra", providerId: "p1", modelId: "opus" },
      ...ctx,
    } as any);
    expect(ctx.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringMatching(/tier must be/) }),
    );
  });

  it("rejects missing providerId/modelId", async () => {
    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "", modelId: "opus" },
      ...ctx,
    } as any);
    expect(ctx.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringMatching(/providerId and modelId/) }),
    );
  });

  it("rejects target model that does not exist in the catalog", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({ id: "p1", models: [{ id: "opus", name: "Opus", tier: "pro" }] }),
    ]);
    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p1", modelId: "missing" },
      ...ctx,
    } as any);
    expect(ctx.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringMatching(/Target model not found/) }),
    );
  });

  it("rejects when the target model's recorded tier doesn't match the requested tier", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({ id: "p1", models: [{ id: "sonnet", name: "Sonnet", tier: "standard" }] }),
    ]);
    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p1", modelId: "sonnet" },
      ...ctx,
    } as any);
    expect(ctx.respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({ message: expect.stringMatching(/does not match/) }),
    );
  });
});

describe("tenant.models.setTierDefault — transactional fan-out", () => {
  it("runs every update inside withTransaction (never via pool)", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({
        id: "p-anthro",
        models: [
          { id: "opus", name: "Opus", tier: "pro", isTierDefault: true },
        ],
      }),
      makeProvider({
        id: "p-openai",
        models: [{ id: "gpt5", name: "GPT-5", tier: "pro" }],
      }),
    ]);

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p-openai", modelId: "gpt5" },
      ...ctx,
    } as any);

    // Transaction was actually opened
    expect(dbIndex.withTransaction).toHaveBeenCalledTimes(1);
    // Free-standing updateTenantModel (pool path) must not be used on PG
    expect(tenantModelDb.updateTenantModel).not.toHaveBeenCalled();
    // All writes went through the tx client
    expect(withTransactionSpy.client?.query).toHaveBeenCalledTimes(2);
  });

  it("flips the previous default to false and the target to true in the same tx", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({
        id: "p-anthro",
        models: [{ id: "opus", name: "Opus", tier: "pro", isTierDefault: true }],
      }),
      makeProvider({
        id: "p-openai",
        models: [{ id: "gpt5", name: "GPT-5", tier: "pro", isTierDefault: false }],
      }),
    ]);

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p-openai", modelId: "gpt5" },
      ...ctx,
    } as any);

    expect(ctx.respond).toHaveBeenCalledWith(true, { updated: 2 });

    const calls = withTransactionSpy.client!.query.mock.calls;
    const payloads = calls.map(([, values]) => {
      const [modelsJson, tenantId, providerId] = values as [string, string, string];
      return { models: JSON.parse(modelsJson), tenantId, providerId };
    });
    // Both providers updated; only the target row has isTierDefault=true
    const anthro = payloads.find((p) => p.providerId === "p-anthro")!;
    const openai = payloads.find((p) => p.providerId === "p-openai")!;
    expect(anthro.models[0]).toMatchObject({ id: "opus", isTierDefault: false });
    expect(openai.models[0]).toMatchObject({ id: "gpt5", isTierDefault: true });
    for (const p of payloads) expect(p.tenantId).toBe("t1");
  });

  it("does not touch providers whose models array stays unchanged", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({
        id: "p-anthro",
        models: [{ id: "opus", name: "Opus", tier: "pro" }],
      }),
      // Contains only standard-tier models — not in target tier, no update needed
      makeProvider({
        id: "p-std-only",
        models: [{ id: "sonnet", name: "Sonnet", tier: "standard" }],
      }),
    ]);

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p-anthro", modelId: "opus" },
      ...ctx,
    } as any);

    expect(ctx.respond).toHaveBeenCalledWith(true, { updated: 1 });
    expect(withTransactionSpy.client?.query).toHaveBeenCalledTimes(1);
    const [, values] = withTransactionSpy.client!.query.mock.calls[0];
    expect((values as unknown[])[2]).toBe("p-anthro");
  });

  it("is a no-op when the target is already the sole tier default", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({
        id: "p-anthro",
        models: [{ id: "opus", name: "Opus", tier: "pro", isTierDefault: true }],
      }),
      makeProvider({
        id: "p-openai",
        models: [{ id: "gpt5", name: "GPT-5", tier: "pro", isTierDefault: false }],
      }),
    ]);

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p-anthro", modelId: "opus" },
      ...ctx,
    } as any);

    expect(ctx.respond).toHaveBeenCalledWith(true, { updated: 0 });
    // Nothing to do → transaction not opened
    expect(dbIndex.withTransaction).not.toHaveBeenCalled();
  });

  it("only touches the target tier — other tiers' entries are passed through verbatim", async () => {
    (tenantModelDb.listTenantModels as any).mockResolvedValue([
      makeProvider({
        id: "p-anthro",
        models: [
          { id: "opus", name: "Opus", tier: "pro" },
          { id: "sonnet", name: "Sonnet", tier: "standard", isTierDefault: true },
          { id: "haiku", name: "Haiku", tier: "lite" },
        ],
      }),
    ]);

    const ctx = makeCtx();
    await tenantModelsHandlers["tenant.models.setTierDefault"]({
      params: { tier: "pro", providerId: "p-anthro", modelId: "opus" },
      ...ctx,
    } as any);

    expect(ctx.respond).toHaveBeenCalledWith(true, { updated: 1 });
    const [, values] = withTransactionSpy.client!.query.mock.calls[0];
    const models = JSON.parse((values as [string])[0]);
    // Pro got flagged
    expect(models.find((m: { id: string }) => m.id === "opus")).toMatchObject({
      isTierDefault: true,
    });
    // Standard's isTierDefault:true stays — we didn't touch it
    expect(models.find((m: { id: string }) => m.id === "sonnet")).toMatchObject({
      id: "sonnet",
      tier: "standard",
      isTierDefault: true,
    });
    // Lite has no isTierDefault key (never had one), still not added
    expect(models.find((m: { id: string }) => m.id === "haiku")).not.toHaveProperty(
      "isTierDefault",
    );
  });
});
