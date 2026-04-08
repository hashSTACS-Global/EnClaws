import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addDistilledRecords, listDistilledRecords } from "./distill-store.js";
import { handleExperienceReview, handleExperienceApprove, handleExperienceReject } from "./review-command.js";

function makeRecord(id: string, kind: string, summary: string) {
  return {
    recordId: id,
    tenantId: "test",
    kind: kind as any,
    summary,
    evidence: ["ev"],
    sourceCandidateIds: [`exp_${id}`],
    sourceUserIds: ["u1"],
    status: "pending_review" as const,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("review-command", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-review-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("lists pending review records with numbers", async () => {
    await addDistilledRecords(tempDir, "2026-04-07", "test", [
      makeRecord("dist_aaa", "fact", "PostgreSQL 16 是主数据库"),
      makeRecord("dist_bbb", "workflow", "PR 需要两人 review"),
    ]);

    const result = await handleExperienceReview({ tenantId: "test", tenantDir: tempDir });
    expect(result).toContain("#1");
    expect(result).toContain("#2");
    expect(result).toContain("[fact]");
    expect(result).toContain("[workflow]");
    expect(result).toContain("PostgreSQL");
    expect(result).toContain("/experience approve");
  });

  it("returns message when no pending records", async () => {
    const result = await handleExperienceReview({ tenantId: "test", tenantDir: tempDir });
    expect(result).toContain("No pending");
  });

  it("approves records by index", async () => {
    await addDistilledRecords(tempDir, "2026-04-07", "test", [
      makeRecord("dist_aaa", "fact", "fact one"),
      makeRecord("dist_bbb", "workflow", "workflow one"),
    ]);

    const result = await handleExperienceApprove({ tenantId: "test", tenantDir: tempDir, indices: [1] });
    expect(result).toContain("Approved 1");

    const records = await listDistilledRecords(tempDir, "test");
    const aaa = records.find((r) => r.recordId === "dist_aaa");
    const bbb = records.find((r) => r.recordId === "dist_bbb");
    expect(aaa?.status).toBe("approved");
    expect(bbb?.status).toBe("pending_review");
  });

  it("rejects records by index", async () => {
    await addDistilledRecords(tempDir, "2026-04-07", "test", [
      makeRecord("dist_aaa", "fact", "fact one"),
      makeRecord("dist_bbb", "workflow", "workflow one"),
    ]);

    const result = await handleExperienceReject({ tenantId: "test", tenantDir: tempDir, indices: [2] });
    expect(result).toContain("Rejected 1");

    const records = await listDistilledRecords(tempDir, "test");
    expect(records.find((r) => r.recordId === "dist_bbb")?.status).toBe("rejected");
  });

  it("returns error for out-of-range index", async () => {
    await addDistilledRecords(tempDir, "2026-04-07", "test", [
      makeRecord("dist_aaa", "fact", "fact one"),
    ]);

    const result = await handleExperienceApprove({ tenantId: "test", tenantDir: tempDir, indices: [5] });
    expect(result).toContain("Invalid");
  });
});
