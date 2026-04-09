import type { OpenClawConfig } from "../config/config.js";
import { checkDuplicates } from "./dedup-check.js";
import { listDistilledRecords, updateDistilledRecordStatus, updateDistilledRecordStatusWithMeta } from "./distill-store.js";
import { publishPromotedToTenantMemory } from "./publish.js";
import type { DistilledRecord } from "./types.js";

async function loadApprovedTenantRecords(tenantDir: string, tenantId: string): Promise<DistilledRecord[]> {
  const records = await listDistilledRecords(tenantDir, tenantId, undefined, {
    status: "approved",
    scope: "tenant",
  });
  return records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function loadPromotedRecords(tenantDir: string, tenantId: string): Promise<DistilledRecord[]> {
  const records = await listDistilledRecords(tenantDir, tenantId, undefined, {
    status: "promoted",
  });
  return records.sort((a, b) => (a.promotedAt ?? a.createdAt).localeCompare(b.promotedAt ?? b.createdAt));
}

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

export async function handleExperiencePromote(params: {
  tenantId: string;
  tenantDir: string;
  indices?: number[];
  cfg?: OpenClawConfig;
  force?: boolean;
}): Promise<string> {
  const records = await loadApprovedTenantRecords(params.tenantDir, params.tenantId);
  if (records.length === 0) {
    return "没有待发布的 tenant scope 记录。";
  }

  let targetIds: string[];
  if (params.indices && params.indices.length > 0) {
    const { valid, invalid } = resolveRecordIds(records, params.indices);
    if (invalid.length > 0) {
      return `无效编号: ${invalid.join(", ")} (有效范围: 1-${records.length})`;
    }
    targetIds = valid;
  } else {
    targetIds = records.map((r) => r.recordId);
  }

  if (targetIds.length === 0) {
    return "没有待发布的记录。";
  }

  // Filter to target records for dedup check
  const targetRecords = records.filter((r) => targetIds.includes(r.recordId));

  // Dedup check (skip if --force or no cfg)
  let recordsToPromote = targetRecords;
  let dedupWarning = "";
  if (!params.force && params.cfg) {
    const dedup = await checkDuplicates({
      tenantDir: params.tenantDir,
      records: targetRecords,
      cfg: params.cfg,
    });
    if (dedup.duplicates.length > 0) {
      const lines = ["检测到以下记录与手写记忆语义重复：", ""];
      for (const d of dedup.duplicates) {
        lines.push(`  [${d.record.kind}] ${d.record.summary}`);
        if (d.matchedLine) {
          lines.push(`  ≈ 手写: "${d.matchedLine}"`);
        }
        lines.push("");
      }
      if (dedup.unique.length > 0) {
        lines.push(`已跳过 ${dedup.duplicates.length} 条重复记录，将发布 ${dedup.unique.length} 条非重复记录。`);
        recordsToPromote = dedup.unique;
        dedupWarning = lines.join("\n") + "\n\n";
      } else {
        lines.push("所有记录均与手写记忆重复。如需强制发布，使用：/experience promote --force");
        return lines.join("\n");
      }
    }
  }

  const promoteIds = recordsToPromote.map((r) => r.recordId);
  const now = new Date().toISOString();
  await updateDistilledRecordStatusWithMeta(params.tenantDir, promoteIds, "promoted", { promotedAt: now });

  const { published } = await publishPromotedToTenantMemory({
    tenantId: params.tenantId,
    tenantDir: params.tenantDir,
  });

  const indexList = params.indices
    ? params.indices.map((i) => `#${i}`).join(", ")
    : "all";
  return `${dedupWarning}已发布 ${promoteIds.length} 条记录 (${indexList})，tenant MEMORY.md 已更新 (共 ${published} 条已发布知识)。`;
}

export async function handleExperienceRollback(params: {
  tenantId: string;
  tenantDir: string;
  indices: number[];
}): Promise<string> {
  const records = await loadPromotedRecords(params.tenantDir, params.tenantId);
  if (records.length === 0) {
    return "没有已发布的记录可回滚。";
  }

  const { valid, invalid } = resolveRecordIds(records, params.indices);
  if (invalid.length > 0) {
    return `无效编号: ${invalid.join(", ")} (有效范围: 1-${records.length})`;
  }
  if (valid.length === 0) {
    return "没有记录需要回滚。";
  }

  await updateDistilledRecordStatus(params.tenantDir, valid, "superseded");

  const { published } = await publishPromotedToTenantMemory({
    tenantId: params.tenantId,
    tenantDir: params.tenantDir,
  });

  const indexList = params.indices.map((i) => `#${i}`).join(", ");
  return `已回滚 ${valid.length} 条记录 (${indexList})，tenant MEMORY.md 已更新 (剩余 ${published} 条已发布知识)。`;
}
