import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, test } from "vitest";

import {
  sessionKeyToFilename,
  filenameToSessionKey,
  resolveCandidatesDir,
  resolveCandidateFilePath,
  resolveDistilledDir,
  resolveDistilledFilePath,
} from "./paths.js";
import {
  addCandidate,
  listCandidates,
  updateCandidateStatus,
} from "./store.js";
import {
  addDistilledRecords,
  listDistilledRecords,
  updateDistilledRecordStatus,
} from "./distill-store.js";
import { resolveExperienceCaptureSettings } from "./capture-config.js";
import { resolveDistillSettings } from "./distill-config.js";
import type { OpenClawConfig } from "../config/config.js";
import type { DistilledRecord } from "./types.js";

// =============================================================================
// paths.ts
// =============================================================================

describe("paths", () => {
  it("sessionKeyToFilename converts colons to double-dashes", () => {
    expect(sessionKeyToFilename("agent:bot1:main:user:ou_xxx")).toBe(
      "agent--bot1--main--user--ou_xxx.json",
    );
  });

  it("filenameToSessionKey reverses the conversion", () => {
    expect(filenameToSessionKey("agent--bot1--main--user--ou_xxx.json")).toBe(
      "agent:bot1:main:user:ou_xxx",
    );
  });

  it("roundtrip sessionKey → filename → sessionKey", () => {
    const key = "agent:bot1:feishu:group:oc_xxx:sender:ou_yyy";
    expect(filenameToSessionKey(sessionKeyToFilename(key))).toBe(key);
  });

  it("resolveCandidatesDir appends experience/candidates", () => {
    const dir = resolveCandidatesDir("/workspace");
    expect(dir).toContain("experience");
    expect(dir).toContain("candidates");
  });

  it("resolveCandidateFilePath includes sessionKey-derived filename", () => {
    const p = resolveCandidateFilePath("/workspace", "agent:main:main");
    expect(p).toContain("agent--main--main.json");
  });

  it("resolveDistilledDir appends experience/distilled", () => {
    const dir = resolveDistilledDir("/tenants/t1");
    expect(dir).toContain("experience");
    expect(dir).toContain("distilled");
  });

  it("resolveDistilledFilePath includes date", () => {
    const p = resolveDistilledFilePath("/tenants/t1", "2026-04-05");
    expect(p).toContain("2026-04-05.json");
  });
});

// =============================================================================
// store.ts — addCandidate, listCandidates, updateCandidateStatus
// =============================================================================

describe("candidate store", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("addCandidate creates a candidate with auto-generated fields", async () => {
    const candidate = await addCandidate(tmpDir, "agent:main:main", {
      sessionId: "sess-1",
      kind: "workflow",
      summary: "Deploy after tests",
      evidence: "User said: always run tests before deploying",
    });

    expect(candidate.candidateId).toMatch(/^exp_/);
    expect(candidate.sessionId).toBe("sess-1");
    expect(candidate.kind).toBe("workflow");
    expect(candidate.status).toBe("pending");
    expect(candidate.createdAt).toBeTruthy();
  });

  it("listCandidates returns added candidates", async () => {
    await addCandidate(tmpDir, "agent:main:main", {
      sessionId: "sess-1",
      kind: "fact",
      summary: "Fact 1",
      evidence: "Evidence 1",
    });
    await addCandidate(tmpDir, "agent:main:main", {
      sessionId: "sess-1",
      kind: "preference",
      summary: "Pref 1",
      evidence: "Evidence 2",
    });

    const all = await listCandidates(tmpDir);
    expect(all).toHaveLength(2);
    expect(all[0].kind).toBe("fact");
    expect(all[1].kind).toBe("preference");
  });

  it("listCandidates filters by sessionKey", async () => {
    await addCandidate(tmpDir, "agent:main:main", {
      sessionId: "sess-1",
      kind: "fact",
      summary: "Fact 1",
      evidence: "Evidence 1",
    });
    await addCandidate(tmpDir, "agent:bot2:slack", {
      sessionId: "sess-2",
      kind: "workflow",
      summary: "Workflow 1",
      evidence: "Evidence 2",
    });

    const mainOnly = await listCandidates(tmpDir, "agent:main:main");
    expect(mainOnly).toHaveLength(1);
    expect(mainOnly[0].kind).toBe("fact");

    const slackOnly = await listCandidates(tmpDir, "agent:bot2:slack");
    expect(slackOnly).toHaveLength(1);
    expect(slackOnly[0].kind).toBe("workflow");
  });

  it("listCandidates returns empty for nonexistent workspace", async () => {
    const empty = await listCandidates("/nonexistent/path");
    expect(empty).toHaveLength(0);
  });

  it("updateCandidateStatus updates matching candidates", async () => {
    const c1 = await addCandidate(tmpDir, "agent:main:main", {
      sessionId: "sess-1",
      kind: "fact",
      summary: "Fact 1",
      evidence: "Ev 1",
    });
    const c2 = await addCandidate(tmpDir, "agent:main:main", {
      sessionId: "sess-1",
      kind: "preference",
      summary: "Pref 1",
      evidence: "Ev 2",
    });

    const updated = await updateCandidateStatus(
      tmpDir,
      "agent:main:main",
      [c1.candidateId],
      "distilled",
    );
    expect(updated).toBe(1);

    const all = await listCandidates(tmpDir, "agent:main:main");
    const distilled = all.find((c) => c.candidateId === c1.candidateId);
    const pending = all.find((c) => c.candidateId === c2.candidateId);
    expect(distilled?.status).toBe("distilled");
    expect(pending?.status).toBe("pending");
  });
});

// =============================================================================
// distill-store.ts — addDistilledRecords, listDistilledRecords
// =============================================================================

describe("distill store", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "distill-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("addDistilledRecords creates file and listDistilledRecords reads it back", async () => {
    const records: DistilledRecord[] = [
      {
        recordId: "dist_test001",
        tenantId: "t1",
        kind: "workflow",
        summary: "Deploy after tests",
        evidence: ["User said run tests", "User said push after green"],
        sourceCandidateIds: ["exp_a1", "exp_a2"],
        sourceUserIds: ["user_001"],
        status: "pending_review",
        scope: "tenant",
        createdAt: "2026-04-05T10:00:00.000Z",
        updatedAt: "2026-04-05T10:00:00.000Z",
      },
    ];

    await addDistilledRecords(tmpDir, "2026-04-05", "t1", records);

    const result = await listDistilledRecords(tmpDir, "t1", "2026-04-05");
    expect(result).toHaveLength(1);
    expect(result[0].recordId).toBe("dist_test001");
    expect(result[0].summary).toBe("Deploy after tests");
    expect(result[0].evidence).toHaveLength(2);
    expect(result[0].sourceCandidateIds).toEqual(["exp_a1", "exp_a2"]);
  });

  it("addDistilledRecords appends to existing file", async () => {
    const r1: DistilledRecord = {
      recordId: "dist_001",
      tenantId: "t1",
      kind: "fact",
      summary: "Fact 1",
      evidence: ["ev1"],
      sourceCandidateIds: ["exp_1"],
      sourceUserIds: ["u1"],
      status: "pending_review",
      scope: "tenant",
      createdAt: "2026-04-05T10:00:00.000Z",
      updatedAt: "2026-04-05T10:00:00.000Z",
    };
    const r2: DistilledRecord = {
      recordId: "dist_002",
      tenantId: "t1",
      kind: "preference",
      summary: "Pref 1",
      evidence: ["ev2"],
      sourceCandidateIds: ["exp_2"],
      sourceUserIds: ["u1"],
      status: "pending_review",
      scope: "tenant",
      createdAt: "2026-04-05T11:00:00.000Z",
      updatedAt: "2026-04-05T11:00:00.000Z",
    };

    await addDistilledRecords(tmpDir, "2026-04-05", "t1", [r1]);
    await addDistilledRecords(tmpDir, "2026-04-05", "t1", [r2]);

    const all = await listDistilledRecords(tmpDir, "t1", "2026-04-05");
    expect(all).toHaveLength(2);
  });

  it("listDistilledRecords without date returns all dates", async () => {
    const r1: DistilledRecord = {
      recordId: "dist_d1",
      tenantId: "t1",
      kind: "fact",
      summary: "Day 1",
      evidence: ["ev"],
      sourceCandidateIds: ["exp_1"],
      sourceUserIds: ["u1"],
      status: "pending_review",
      scope: "tenant",
      createdAt: "2026-04-05T10:00:00.000Z",
      updatedAt: "2026-04-05T10:00:00.000Z",
    };
    const r2: DistilledRecord = {
      recordId: "dist_d2",
      tenantId: "t1",
      kind: "workflow",
      summary: "Day 2",
      evidence: ["ev"],
      sourceCandidateIds: ["exp_2"],
      sourceUserIds: ["u1"],
      status: "pending_review",
      scope: "tenant",
      createdAt: "2026-04-06T10:00:00.000Z",
      updatedAt: "2026-04-06T10:00:00.000Z",
    };

    await addDistilledRecords(tmpDir, "2026-04-05", "t1", [r1]);
    await addDistilledRecords(tmpDir, "2026-04-06", "t1", [r2]);

    const all = await listDistilledRecords(tmpDir, "t1");
    expect(all).toHaveLength(2);
  });

  it("listDistilledRecords returns empty for nonexistent dir", async () => {
    const empty = await listDistilledRecords("/nonexistent", "t1");
    expect(empty).toHaveLength(0);
  });

  it("addDistilledRecords with empty array is a no-op", async () => {
    await addDistilledRecords(tmpDir, "2026-04-05", "t1", []);
    const result = await listDistilledRecords(tmpDir, "t1", "2026-04-05");
    expect(result).toHaveLength(0);
  });

  it("updates distilled record status", async () => {
    const tenantDir = path.join(tmpDir, "tenant");
    const tenantId = "test-tenant";
    const dateStr = "2026-04-07";

    await addDistilledRecords(tenantDir, dateStr, tenantId, [
      {
        recordId: "dist_aaa",
        tenantId,
        kind: "fact",
        summary: "test fact",
        evidence: ["evidence"],
        sourceCandidateIds: ["exp_111"],
        sourceUserIds: ["user1"],
        status: "pending_review",
        scope: "tenant",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        recordId: "dist_bbb",
        tenantId,
        kind: "workflow",
        summary: "test workflow",
        evidence: ["evidence"],
        sourceCandidateIds: ["exp_222"],
        sourceUserIds: ["user1"],
        status: "pending_review",
        scope: "tenant",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ]);

    const updated = await updateDistilledRecordStatus(tenantDir, ["dist_aaa"], "approved");
    expect(updated).toBe(1);

    const records = await listDistilledRecords(tenantDir, tenantId, dateStr);
    const aaa = records.find((r) => r.recordId === "dist_aaa");
    const bbb = records.find((r) => r.recordId === "dist_bbb");
    expect(aaa?.status).toBe("approved");
    expect(bbb?.status).toBe("pending_review");
  });
});

// =============================================================================
// Phase 3 type compatibility
// =============================================================================

describe("Phase 3 type compatibility", () => {
  test("DistilledRecord accepts promoted status and scope field", () => {
    const record: DistilledRecord = {
      recordId: "dist_abc",
      tenantId: "t1",
      kind: "fact",
      summary: "test",
      evidence: ["e1"],
      sourceCandidateIds: ["c1"],
      sourceUserIds: ["u1"],
      status: "promoted",
      scope: "tenant",
      createdAt: "2026-04-08T00:00:00.000Z",
      updatedAt: "2026-04-08T00:00:00.000Z",
      promotedAt: "2026-04-08T01:00:00.000Z",
    };
    expect(record.status).toBe("promoted");
    expect(record.scope).toBe("tenant");
    expect(record.promotedAt).toBeDefined();
  });
});

// =============================================================================
// capture-config.ts — resolveExperienceCaptureSettings
// =============================================================================

describe("capture config", () => {
  it("defaults to enabled with interval=5, maxMessages=20, model=null", () => {
    const settings = resolveExperienceCaptureSettings();
    expect(settings).not.toBeNull();
    expect(settings?.enabled).toBe(true);
    expect(settings?.turnInterval).toBe(5);
    expect(settings?.maxMessages).toBe(20);
    expect(settings?.model).toBeNull();
  });

  it("returns null when disabled", () => {
    const cfg = {
      agents: { defaults: { experience: { capture: { enabled: false } } } },
    } as unknown as OpenClawConfig;
    expect(resolveExperienceCaptureSettings(cfg)).toBeNull();
  });

  it("respects custom turnInterval", () => {
    const cfg = {
      agents: { defaults: { experience: { capture: { turnInterval: 10 } } } },
    } as unknown as OpenClawConfig;
    const settings = resolveExperienceCaptureSettings(cfg);
    expect(settings?.turnInterval).toBe(10);
  });

  it("falls back to defaults for invalid values", () => {
    const cfg = {
      agents: {
        defaults: { experience: { capture: { turnInterval: -1, maxMessages: 0 } } },
      },
    } as unknown as OpenClawConfig;
    const settings = resolveExperienceCaptureSettings(cfg);
    expect(settings?.turnInterval).toBe(5);
    expect(settings?.maxMessages).toBe(20);
  });

  it("parses model string", () => {
    const cfg = {
      agents: {
        defaults: { experience: { capture: { model: "anthropic/claude-haiku-4-5-20251001" } } },
      },
    } as unknown as OpenClawConfig;
    const settings = resolveExperienceCaptureSettings(cfg);
    expect(settings?.model).toBe("anthropic/claude-haiku-4-5-20251001");
  });
});

// =============================================================================
// distill-config.ts — resolveDistillSettings
// =============================================================================

describe("distill config", () => {
  it("defaults to enabled with maxCandidatesPerBatch=50, model=null", () => {
    const settings = resolveDistillSettings();
    expect(settings).not.toBeNull();
    expect(settings?.enabled).toBe(true);
    expect(settings?.maxCandidatesPerBatch).toBe(50);
    expect(settings?.model).toBeNull();
  });

  it("returns null when disabled", () => {
    const cfg = {
      agents: { defaults: { experience: { distill: { enabled: false } } } },
    } as unknown as OpenClawConfig;
    expect(resolveDistillSettings(cfg)).toBeNull();
  });

  it("respects custom maxCandidatesPerBatch", () => {
    const cfg = {
      agents: { defaults: { experience: { distill: { maxCandidatesPerBatch: 25 } } } },
    } as unknown as OpenClawConfig;
    const settings = resolveDistillSettings(cfg);
    expect(settings?.maxCandidatesPerBatch).toBe(25);
  });

  it("falls back to defaults for invalid values", () => {
    const cfg = {
      agents: { defaults: { experience: { distill: { maxCandidatesPerBatch: -10 } } } },
    } as unknown as OpenClawConfig;
    const settings = resolveDistillSettings(cfg);
    expect(settings?.maxCandidatesPerBatch).toBe(50);
  });

  it("parses model string", () => {
    const cfg = {
      agents: {
        defaults: { experience: { distill: { model: "openai/gpt-4o" } } },
      },
    } as unknown as OpenClawConfig;
    const settings = resolveDistillSettings(cfg);
    expect(settings?.model).toBe("openai/gpt-4o");
  });

  it("resolves cron field with default", () => {
    const settings = resolveDistillSettings({} as any);
    expect(settings).not.toBeNull();
    expect(settings!.cron).toBe("0 3 * * *");
  });

  it("resolves custom cron from config", () => {
    const settings = resolveDistillSettings({
      agents: { defaults: { experience: { distill: { cron: "0 5 * * 0" } } } },
    } as any);
    expect(settings).not.toBeNull();
    expect(settings!.cron).toBe("0 5 * * 0");
  });
});
