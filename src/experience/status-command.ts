import { listCandidates } from "./store.js";
import { listDistilledRecords } from "./distill-store.js";

export async function handleExperienceStatus(params: {
  tenantId: string;
  tenantDir: string;
  userWorkspaceDirs: string[];
}): Promise<string> {
  const candidateStatusCounts: Record<string, number> = {
    pending: 0, distilled: 0, approved: 0, rejected: 0, promoted: 0, superseded: 0,
  };
  let lastCaptureAt = "";

  for (const workspaceDir of params.userWorkspaceDirs) {
    const candidates = await listCandidates(workspaceDir);
    for (const c of candidates) {
      candidateStatusCounts[c.status] = (candidateStatusCounts[c.status] ?? 0) + 1;
      if (c.createdAt > lastCaptureAt) {
        lastCaptureAt = c.createdAt;
      }
    }
  }

  const recordStatusCounts: Record<string, number> = {
    pending_review: 0, approved: 0, promoted: 0, rejected: 0, superseded: 0,
  };
  let lastDistillAt = "";

  const records = await listDistilledRecords(params.tenantDir, params.tenantId);
  for (const r of records) {
    recordStatusCounts[r.status] = (recordStatusCounts[r.status] ?? 0) + 1;
    if (r.createdAt > lastDistillAt) {
      lastDistillAt = r.createdAt;
    }
  }

  const lines = [
    "Experience Extraction Status",
    "",
    "Candidates:",
    `  pending: ${candidateStatusCounts.pending}  |  distilled: ${candidateStatusCounts.distilled}  |  approved: ${candidateStatusCounts.approved}`,
    "Distilled Records:",
    `  pending_review: ${recordStatusCounts.pending_review}  |  approved: ${recordStatusCounts.approved}  |  promoted: ${recordStatusCounts.promoted}  |  rejected: ${recordStatusCounts.rejected}`,
    "",
    `Last capture:  ${lastCaptureAt ? lastCaptureAt.slice(0, 16).replace("T", " ") : "never"}`,
    `Last distill:  ${lastDistillAt ? lastDistillAt.slice(0, 16).replace("T", " ") : "never"}`,
  ];

  return lines.join("\n");
}
