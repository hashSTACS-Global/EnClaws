import type { ExperienceCandidate, DistilledRecord } from "../../../src/experience/types.js";
import type { CaptureAssert, DistillAssert } from "../types.js";

/** Check capture assertions against actual candidates. Returns failure messages (empty = pass). */
export function checkCaptureAssertions(
  candidates: ExperienceCandidate[],
  assert?: CaptureAssert,
): string[] {
  const failures: string[] = [];

  if (!assert) {
    return failures;
  }

  if (assert.minCandidates != null && candidates.length < assert.minCandidates) {
    failures.push(`expected >= ${assert.minCandidates} candidates, got ${candidates.length}`);
  }

  if (assert.maxCandidates != null && candidates.length > assert.maxCandidates) {
    failures.push(`expected <= ${assert.maxCandidates} candidates, got ${candidates.length}`);
  }

  if (assert.expectedKinds && assert.expectedKinds.length > 0) {
    const actualKinds = new Set(candidates.map((c) => c.kind));
    for (const kind of assert.expectedKinds) {
      if (!actualKinds.has(kind as ExperienceCandidate["kind"])) {
        failures.push(`expected kind "${kind}" not found in [${[...actualKinds].join(", ")}]`);
      }
    }
  }

  if (assert.forbiddenKinds && assert.forbiddenKinds.length > 0) {
    const actualKinds = new Set(candidates.map((c) => c.kind));
    for (const kind of assert.forbiddenKinds) {
      if (actualKinds.has(kind as ExperienceCandidate["kind"])) {
        failures.push(`forbidden kind "${kind}" found in candidates`);
      }
    }
  }

  if (assert.summaryContainsAny && assert.summaryContainsAny.length > 0) {
    const allSummaries = candidates.map((c) => c.summary).join(" ");
    const found = assert.summaryContainsAny.some((kw) => allSummaries.includes(kw));
    if (!found) {
      failures.push(`no candidate summary contains any of [${assert.summaryContainsAny.join(", ")}]`);
    }
  }

  return failures;
}

/** Check distill assertions against actual records. Returns failure messages (empty = pass). */
export function checkDistillAssertions(
  records: DistilledRecord[],
  assert?: DistillAssert,
): string[] {
  const failures: string[] = [];

  if (!assert) {
    return failures;
  }

  if (assert.minRecords != null && records.length < assert.minRecords) {
    failures.push(`expected >= ${assert.minRecords} distilled records, got ${records.length}`);
  }

  if (assert.summaryNotEmpty) {
    for (const r of records) {
      if (!r.summary || r.summary.trim().length === 0) {
        failures.push(`distilled record ${r.recordId} has empty summary`);
      }
    }
  }

  if (assert.hasSourceCandidateIds !== false) {
    for (const r of records) {
      if (!r.sourceCandidateIds || r.sourceCandidateIds.length === 0) {
        failures.push(`distilled record ${r.recordId} has no sourceCandidateIds`);
      }
    }
  }

  return failures;
}

/** Format capture assertions as a readable string for CSV */
export function formatCaptureAssert(assert?: CaptureAssert): string {
  if (!assert) return "";
  const parts: string[] = [];
  if (assert.minCandidates != null) parts.push(`min:${assert.minCandidates}`);
  if (assert.maxCandidates != null) parts.push(`max:${assert.maxCandidates}`);
  if (assert.expectedKinds?.length) parts.push(`kinds:[${assert.expectedKinds.join(",")}]`);
  if (assert.summaryContainsAny?.length) parts.push(`summary~[${assert.summaryContainsAny.join(",")}]`);
  return parts.join(", ");
}

/** Format distill assertions as a readable string for CSV */
export function formatDistillAssert(assert?: DistillAssert): string {
  if (!assert) return "";
  const parts: string[] = [];
  if (assert.minRecords != null) parts.push(`min:${assert.minRecords}`);
  if (assert.summaryNotEmpty) parts.push("summaryNotEmpty");
  if (assert.hasSourceCandidateIds !== false) parts.push("hasProvenance");
  return parts.join(", ");
}
