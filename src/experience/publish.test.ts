import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DistilledFile, DistilledRecord } from "./types.js";
import {
  generatePromotedBlock,
  MARKER_END,
  MARKER_START,
  publishPromotedToTenantMemory,
} from "./publish.js";

function makeRecord(
  overrides: Partial<DistilledRecord> & {
    recordId: string;
    kind: DistilledRecord["kind"];
    summary: string;
  },
): DistilledRecord {
  return {
    tenantId: "t1",
    evidence: [],
    sourceCandidateIds: [],
    sourceUserIds: [],
    status: "promoted",
    scope: "tenant",
    createdAt: "2026-04-08T00:00:00.000Z",
    updatedAt: "2026-04-08T00:00:00.000Z",
    promotedAt: "2026-04-08T01:00:00.000Z",
    ...overrides,
  };
}

/** Seed promoted records into the distill store as a JSON file. */
async function seedPromotedRecords(
  tenantDir: string,
  tenantId: string,
  records: DistilledRecord[],
): Promise<void> {
  const distilledDir = path.join(tenantDir, "experience", "distilled");
  await fs.mkdir(distilledDir, { recursive: true });
  const file: DistilledFile = { tenantId, records };
  await fs.writeFile(
    path.join(distilledDir, "2026-04-08.json"),
    JSON.stringify(file, null, 2),
    "utf-8",
  );
}

// =============================================================================
// generatePromotedBlock
// =============================================================================

describe("generatePromotedBlock", () => {
  it("groups records by kind (fact before workflow)", () => {
    const records = [
      makeRecord({ recordId: "r1", kind: "workflow", summary: "Deploy after tests" }),
      makeRecord({ recordId: "r2", kind: "fact", summary: "Server runs on port 3000" }),
    ];
    const block = generatePromotedBlock(records);
    const factIdx = block.indexOf("### 事实");
    const workflowIdx = block.indexOf("### 流程");
    expect(factIdx).toBeGreaterThan(-1);
    expect(workflowIdx).toBeGreaterThan(-1);
    expect(factIdx).toBeLessThan(workflowIdx);
    expect(block).toContain("- Server runs on port 3000");
    expect(block).toContain("- Deploy after tests");
  });

  it("returns empty string for no records", () => {
    expect(generatePromotedBlock([])).toBe("");
  });

  it("includes all 6 kinds when present", () => {
    const records = [
      makeRecord({ recordId: "r1", kind: "fact", summary: "fact1" }),
      makeRecord({ recordId: "r2", kind: "preference", summary: "pref1" }),
      makeRecord({ recordId: "r3", kind: "workflow", summary: "wf1" }),
      makeRecord({ recordId: "r4", kind: "policy_hint", summary: "ph1" }),
      makeRecord({ recordId: "r5", kind: "failure_pattern", summary: "fp1" }),
      makeRecord({ recordId: "r6", kind: "tool_recipe", summary: "tr1" }),
    ];
    const block = generatePromotedBlock(records);
    expect(block).toContain("### 事实");
    expect(block).toContain("### 偏好");
    expect(block).toContain("### 流程");
    expect(block).toContain("### 策略");
    expect(block).toContain("### 故障模式");
    expect(block).toContain("### 工具用法");
  });
});

// =============================================================================
// publishPromotedToTenantMemory
// =============================================================================

describe("publishPromotedToTenantMemory", () => {
  let tmpDir: string;
  const tenantId = "t1";

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "publish-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("appends marker block to empty MEMORY.md", async () => {
    const tenantDir = path.join(tmpDir, "tenant-empty");
    // Write an empty MEMORY.md
    await fs.mkdir(tenantDir, { recursive: true });
    await fs.writeFile(path.join(tenantDir, "MEMORY.md"), "", "utf-8");

    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r1", kind: "fact", summary: "Port is 3000" }),
    ]);

    const result = await publishPromotedToTenantMemory({ tenantId, tenantDir });
    expect(result.published).toBe(1);

    const content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).toContain(MARKER_START);
    expect(content).toContain(MARKER_END);
    expect(content).toContain("Port is 3000");
  });

  it("preserves hand-written content outside marker block", async () => {
    const tenantDir = path.join(tmpDir, "tenant-preserve");
    await fs.mkdir(tenantDir, { recursive: true });
    await fs.writeFile(
      path.join(tenantDir, "MEMORY.md"),
      "# My Notes\n\nHand-written content here.\n",
      "utf-8",
    );

    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r1", kind: "preference", summary: "Use dark theme" }),
    ]);

    await publishPromotedToTenantMemory({ tenantId, tenantDir });

    const content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).toContain("# My Notes");
    expect(content).toContain("Hand-written content here.");
    expect(content).toContain(MARKER_START);
    expect(content).toContain("Use dark theme");
  });

  it("replaces existing marker block on re-publish", async () => {
    const tenantDir = path.join(tmpDir, "tenant-replace");
    await fs.mkdir(tenantDir, { recursive: true });

    // First publish with one record
    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r1", kind: "fact", summary: "Old fact" }),
    ]);
    await publishPromotedToTenantMemory({ tenantId, tenantDir });

    let content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).toContain("Old fact");

    // Re-publish with a different record
    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r2", kind: "workflow", summary: "New workflow" }),
    ]);
    await publishPromotedToTenantMemory({ tenantId, tenantDir });

    content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).not.toContain("Old fact");
    expect(content).toContain("New workflow");

    // Only one marker block
    const startCount = content.split(MARKER_START).length - 1;
    const endCount = content.split(MARKER_END).length - 1;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it("removes marker block when no promoted records", async () => {
    const tenantDir = path.join(tmpDir, "tenant-remove");
    await fs.mkdir(tenantDir, { recursive: true });

    // First publish with a record
    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r1", kind: "fact", summary: "Will be removed" }),
    ]);
    await publishPromotedToTenantMemory({ tenantId, tenantDir });

    let content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).toContain(MARKER_START);

    // Re-publish with no promoted records (seed empty)
    await seedPromotedRecords(tenantDir, tenantId, []);
    await publishPromotedToTenantMemory({ tenantId, tenantDir });

    content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).not.toContain(MARKER_START);
    expect(content).not.toContain(MARKER_END);
    expect(content).not.toContain("Will be removed");
  });

  it("creates MEMORY.md if it does not exist", async () => {
    const tenantDir = path.join(tmpDir, "tenant-nofile");
    // Do NOT create MEMORY.md — let publish create it

    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r1", kind: "tool_recipe", summary: "Use jq for JSON" }),
    ]);

    const result = await publishPromotedToTenantMemory({ tenantId, tenantDir });
    expect(result.published).toBe(1);

    const content = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");
    expect(content).toContain(MARKER_START);
    expect(content).toContain("Use jq for JSON");
  });

  it("idempotent — two publishes produce same content", async () => {
    const tenantDir = path.join(tmpDir, "tenant-idempotent");
    await fs.mkdir(tenantDir, { recursive: true });
    await fs.writeFile(
      path.join(tenantDir, "MEMORY.md"),
      "# Existing\n\nSome notes.\n",
      "utf-8",
    );

    await seedPromotedRecords(tenantDir, tenantId, [
      makeRecord({ recordId: "r1", kind: "fact", summary: "Stable fact" }),
      makeRecord({ recordId: "r2", kind: "workflow", summary: "Stable workflow" }),
    ]);

    await publishPromotedToTenantMemory({ tenantId, tenantDir });
    const first = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");

    await publishPromotedToTenantMemory({ tenantId, tenantDir });
    const second = await fs.readFile(path.join(tenantDir, "MEMORY.md"), "utf-8");

    expect(first).toBe(second);
  });
});
