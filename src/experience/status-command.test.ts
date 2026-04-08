import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { addCandidate } from "./store.js";
import { addDistilledRecords } from "./distill-store.js";
import { handleExperienceStatus } from "./status-command.js";

describe("handleExperienceStatus", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "exp-status-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns status with candidate and record counts", async () => {
    const workspaceDir = path.join(tempDir, "workspace");
    await fs.mkdir(path.join(workspaceDir, "experience", "candidates"), { recursive: true });
    const tenantDir = path.join(tempDir, "tenant");
    const tenantId = "test";

    await addCandidate(workspaceDir, "test:session", {
      sessionId: "s1",
      kind: "fact",
      summary: "test",
      evidence: "ev",
    });
    await addCandidate(workspaceDir, "test:session", {
      sessionId: "s1",
      kind: "workflow",
      summary: "test2",
      evidence: "ev2",
      status: "distilled",
    });
    await addDistilledRecords(tenantDir, "2026-04-07", tenantId, [{
      recordId: "dist_1",
      tenantId,
      kind: "fact",
      summary: "distilled",
      evidence: ["ev"],
      sourceCandidateIds: ["exp_1"],
      sourceUserIds: ["u1"],
      status: "pending_review",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }]);

    const result = await handleExperienceStatus({
      tenantId,
      tenantDir,
      userWorkspaceDirs: [workspaceDir],
    });

    expect(result).toContain("pending: 1");
    expect(result).toContain("distilled: 1");
    expect(result).toContain("pending_review: 1");
  });

  it("returns empty status when no data", async () => {
    const result = await handleExperienceStatus({
      tenantId: "test",
      tenantDir: path.join(tempDir, "empty-tenant"),
      userWorkspaceDirs: [],
    });

    expect(result).toContain("pending: 0");
  });
});
