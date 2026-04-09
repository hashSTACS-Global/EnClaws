import { listDistilledRecords, updateDistilledRecordStatus } from "./distill-store.js";
import type { DistilledRecord, DistilledStatus } from "./types.js";

/** Load all pending_review records sorted by createdAt. */
async function loadPendingReviewRecords(tenantDir: string, tenantId: string): Promise<DistilledRecord[]> {
  const all = await listDistilledRecords(tenantDir, tenantId);
  return all
    .filter((r) => r.status === "pending_review")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Resolve record IDs from 1-based indices against the pending review list. */
function resolveRecordIds(
  records: DistilledRecord[],
  indices: number[],
): { valid: string[]; invalid: number[] } {
  const valid: string[] = [];
  const invalid: number[] = [];
  for (const idx of indices) {
    if (idx >= 1 && idx <= records.length) {
      valid.push(records[idx - 1].recordId);
    } else {
      invalid.push(idx);
    }
  }
  return { valid, invalid };
}

export async function handleExperienceReview(params: {
  tenantId: string;
  tenantDir: string;
}): Promise<string> {
  const records = await loadPendingReviewRecords(params.tenantDir, params.tenantId);
  if (records.length === 0) {
    return "No pending review records.";
  }

  const lines = [`Pending Review (${records.length} records)`, ""];
  for (const [i, r] of records.entries()) {
    lines.push(`#${i + 1} [${r.kind}] ${r.summary}`);
    if (r.evidence.length > 0) {
      lines.push(`   evidence: ${r.evidence[0]}`);
    }
    lines.push(`   sources: ${r.sourceCandidateIds.length} candidates, ${r.sourceUserIds.length} user(s)`);
    lines.push("");
  }
  lines.push("Use: /experience approve 1,2 or /experience reject 3");

  return lines.join("\n");
}

export async function handleExperienceApprove(params: {
  tenantId: string;
  tenantDir: string;
  indices: number[];
}): Promise<string> {
  return await updateByIndices(params, "approved");
}

export async function handleExperienceReject(params: {
  tenantId: string;
  tenantDir: string;
  indices: number[];
}): Promise<string> {
  return await updateByIndices(params, "rejected");
}

export async function handleExperienceReviewApproved(params: {
  tenantId: string;
  tenantDir: string;
}): Promise<string> {
  const all = await listDistilledRecords(params.tenantDir, params.tenantId, undefined, {
    status: "approved",
    scope: "tenant",
  });
  const records = all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (records.length === 0) {
    return "No approved records awaiting promotion.";
  }

  const lines = [`Approved (${records.length} records, ready to promote)`, ""];
  for (const [i, r] of records.entries()) {
    lines.push(`#${i + 1} [${r.kind}] ${r.summary}`);
    lines.push(`   scope: ${r.scope ?? "tenant"} | sources: ${r.sourceCandidateIds.length} candidates`);
    lines.push("");
  }
  lines.push("Use: /experience promote 1,2 or /experience promote (all)");
  return lines.join("\n");
}

export async function handleExperienceReviewPromoted(params: {
  tenantId: string;
  tenantDir: string;
}): Promise<string> {
  const all = await listDistilledRecords(params.tenantDir, params.tenantId, undefined, {
    status: "promoted",
  });
  const records = all.sort((a, b) => (a.promotedAt ?? a.createdAt).localeCompare(b.promotedAt ?? b.createdAt));
  if (records.length === 0) {
    return "No promoted records.";
  }

  const lines = [`Promoted (${records.length} records)`, ""];
  for (const [i, r] of records.entries()) {
    const promoted = r.promotedAt ? r.promotedAt.slice(0, 16).replace("T", " ") : "unknown";
    lines.push(`#${i + 1} [${r.kind}] ${r.summary}`);
    lines.push(`   promoted: ${promoted} | scope: ${r.scope ?? "tenant"}`);
    lines.push("");
  }
  lines.push("Use: /experience rollback 1,2 to unpublish");
  return lines.join("\n");
}

async function updateByIndices(
  params: { tenantId: string; tenantDir: string; indices: number[] },
  newStatus: DistilledStatus,
): Promise<string> {
  const records = await loadPendingReviewRecords(params.tenantDir, params.tenantId);
  const { valid, invalid } = resolveRecordIds(records, params.indices);

  if (invalid.length > 0) {
    return `Invalid index(es): ${invalid.join(", ")} (valid range: 1-${records.length})`;
  }
  if (valid.length === 0) {
    return "No records to update.";
  }

  const updated = await updateDistilledRecordStatus(params.tenantDir, valid, newStatus);
  const label = newStatus === "approved" ? "Approved" : "Rejected";
  const indexList = params.indices.map((i) => `#${i}`).join(", ");
  return `${label} ${updated} record(s): ${indexList}`;
}
