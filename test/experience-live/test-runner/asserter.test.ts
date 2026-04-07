import { describe, it, expect } from "vitest";
import { checkCaptureAssertions, checkDistillAssertions } from "./asserter.js";
import type { ExperienceCandidate, DistilledRecord } from "../../../src/experience/types.js";

const makeCandidate = (overrides: Partial<ExperienceCandidate> = {}): ExperienceCandidate => ({
  candidateId: "exp_test123",
  sessionId: "session-1",
  kind: "fact",
  summary: "团队使用 PostgreSQL 16",
  evidence: "用户提到数据库",
  status: "pending",
  createdAt: new Date().toISOString(),
  ...overrides,
});

const makeRecord = (overrides: Partial<DistilledRecord> = {}): DistilledRecord => ({
  recordId: "dist_test123",
  tenantId: "test",
  kind: "fact",
  summary: "团队使用 PostgreSQL 16",
  evidence: ["用户提到数据库"],
  sourceCandidateIds: ["exp_test123"],
  sourceUserIds: ["session-1"],
  status: "pending_review",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe("checkCaptureAssertions", () => {
  it("passes when candidates meet minCandidates", () => {
    const failures = checkCaptureAssertions([makeCandidate()], { minCandidates: 1 });
    expect(failures).toEqual([]);
  });

  it("fails when candidates below minCandidates", () => {
    const failures = checkCaptureAssertions([], { minCandidates: 1 });
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("expected >= 1");
  });

  it("fails when forbidden kind present", () => {
    const failures = checkCaptureAssertions([makeCandidate({ kind: "preference" })], { forbiddenKinds: ["preference"] });
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("forbidden kind");
  });

  it("checks summaryContainsAny", () => {
    const failures = checkCaptureAssertions([makeCandidate()], { summaryContainsAny: ["PostgreSQL"] });
    expect(failures).toEqual([]);
  });

  it("fails summaryContainsAny when no match", () => {
    const failures = checkCaptureAssertions([makeCandidate()], { summaryContainsAny: ["Redis"] });
    expect(failures.length).toBe(1);
  });
});

describe("checkDistillAssertions", () => {
  it("passes when records meet all assertions", () => {
    const failures = checkDistillAssertions([makeRecord()], { minRecords: 1, summaryNotEmpty: true, hasSourceCandidateIds: true });
    expect(failures).toEqual([]);
  });

  it("fails when empty summary", () => {
    const failures = checkDistillAssertions([makeRecord({ summary: "" })], { summaryNotEmpty: true });
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("empty summary");
  });

  it("fails when no sourceCandidateIds", () => {
    const failures = checkDistillAssertions([makeRecord({ sourceCandidateIds: [] })], { hasSourceCandidateIds: true });
    expect(failures.length).toBe(1);
    expect(failures[0]).toContain("no sourceCandidateIds");
  });
});
