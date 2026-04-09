import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addDistilledRecords, listDistilledRecords } from "./distill-store.js";
import { handleExperiencePromote, handleExperienceRollback } from "./promote-command.js";
import { MARKER_START } from "./publish.js";
import type { DistilledRecord } from "./types.js";

const tenantId = "t1";
const dateStr = "2026-04-08";

function makeApproved(id: string, summary: string): DistilledRecord {
  return {
    recordId: id,
    tenantId,
    kind: "fact",
    summary,
    evidence: ["e1"],
    sourceCandidateIds: ["c1"],
    sourceUserIds: ["u1"],
    status: "approved",
    scope: "tenant",
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
  };
}

function makePromoted(id: string, summary: string): DistilledRecord {
  return {
    ...makeApproved(id, summary),
    status: "promoted",
    promotedAt: "2026-04-08T01:00:00.000Z",
  };
}

describe("handleExperiencePromote", () => {
  let tmpDir: string;
  let tenantDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "promote-test-"));
    tenantDir = path.join(tmpDir, "tenant");
    await fs.mkdir(tenantDir, { recursive: true });
    await fs.writeFile(path.join(tenantDir, "MEMORY.md"), "", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("promotes all approved tenant records", async () => {
    await addDistilledRecords(tenantDir, dateStr, tenantId, [
      makeApproved("r1", "Fact one"),
      makeApproved("r2", "Fact two"),
    ]);

    const result = await handleExperiencePromote({ tenantId, tenantDir });

    expect(result).toContain("已发布 2 条记录");
    expect(result).toContain("all");

    // Verify records became promoted with promotedAt
    const records = await listDistilledRecords(tenantDir, tenantId, undefined, { status: "promoted" });
    expect(records).toHaveLength(2);
    for (const r of records) {
      expect(r.status).toBe("promoted");
      expect(r.promotedAt).toBeDefined();
    }

    // Verify MEMORY.md has content
    const memory = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(memory).toContain(MARKER_START);
    expect(memory).toContain("Fact one");
    expect(memory).toContain("Fact two");
  });

  it("promotes specific indices", async () => {
    await addDistilledRecords(tenantDir, dateStr, tenantId, [
      makeApproved("r1", "First"),
      makeApproved("r2", "Second"),
      makeApproved("r3", "Third"),
    ]);

    const result = await handleExperiencePromote({ tenantId, tenantDir, indices: [1, 3] });

    expect(result).toContain("已发布 2 条记录");
    expect(result).toContain("#1");
    expect(result).toContain("#3");

    const promoted = await listDistilledRecords(tenantDir, tenantId, undefined, { status: "promoted" });
    expect(promoted).toHaveLength(2);
    const promotedIds = promoted.map((r) => r.recordId).sort();
    expect(promotedIds).toEqual(["r1", "r3"]);

    // r2 should still be approved
    const approved = await listDistilledRecords(tenantDir, tenantId, undefined, { status: "approved" });
    expect(approved).toHaveLength(1);
    expect(approved[0].recordId).toBe("r2");
  });

  it("returns message when no approved records", async () => {
    const result = await handleExperiencePromote({ tenantId, tenantDir });
    expect(result).toContain("没有");
  });

  it("rejects personal scope records", async () => {
    await addDistilledRecords(tenantDir, dateStr, tenantId, [
      { ...makeApproved("r1", "Personal fact"), scope: "personal" },
    ]);

    const result = await handleExperiencePromote({ tenantId, tenantDir });
    expect(result).toContain("没有");
  });
});

describe("handleExperienceRollback", () => {
  let tmpDir: string;
  let tenantDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "rollback-test-"));
    tenantDir = path.join(tmpDir, "tenant");
    await fs.mkdir(tenantDir, { recursive: true });
    await fs.writeFile(path.join(tenantDir, "MEMORY.md"), "", "utf-8");
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("rolls back specified promoted records", async () => {
    await addDistilledRecords(tenantDir, dateStr, tenantId, [
      makePromoted("r1", "Promoted one"),
      makePromoted("r2", "Promoted two"),
    ]);

    const result = await handleExperienceRollback({ tenantId, tenantDir, indices: [1] });

    expect(result).toContain("已回滚 1 条记录");
    expect(result).toContain("#1");

    // First record should be superseded
    const superseded = await listDistilledRecords(tenantDir, tenantId, undefined, { status: "superseded" });
    expect(superseded).toHaveLength(1);
    expect(superseded[0].recordId).toBe("r1");

    // Second record should still be promoted
    const promoted = await listDistilledRecords(tenantDir, tenantId, undefined, { status: "promoted" });
    expect(promoted).toHaveLength(1);
    expect(promoted[0].recordId).toBe("r2");

    // MEMORY.md should only have the remaining promoted record
    const memory = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(memory).toContain("Promoted two");
    expect(memory).not.toContain("Promoted one");
  });

  it("returns message when no promoted records", async () => {
    const result = await handleExperienceRollback({ tenantId, tenantDir, indices: [1] });
    expect(result).toContain("没有");
  });
});
