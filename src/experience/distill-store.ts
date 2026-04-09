import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveDistilledDir, resolveDistilledFilePath } from "./paths.js";
import type { DistilledFile, DistilledRecord, DistilledStatus } from "./types.js";

/** 读取指定日期的 distilled 文件，不存在时返回空结构 */
async function readDistilledFile(filePath: string, tenantId: string): Promise<DistilledFile> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(content) as DistilledFile;
  } catch {
    return { tenantId, records: [] };
  }
}

/** 原子写入 distilled JSON 文件 */
async function writeAtomicDistilledJson(filePath: string, data: DistilledFile): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const json = JSON.stringify(data, null, 2);
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.promises.writeFile(tmp, json, "utf-8");
    for (let i = 0; i < 5; i++) {
      try {
        await fs.promises.rename(tmp, filePath);
        return;
      } catch {
        if (i < 4) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
        }
      }
    }
  } catch {
    try {
      await fs.promises.unlink(tmp);
    } catch {
      // Ignore cleanup errors.
    }
    throw new Error(`Failed to write distilled file: ${filePath}`);
  }
}

/** 追加 distilled records 到指定日期的文件 */
export async function addDistilledRecords(
  tenantDir: string,
  dateStr: string,
  tenantId: string,
  records: DistilledRecord[],
): Promise<void> {
  if (records.length === 0) {
    return;
  }
  const filePath = resolveDistilledFilePath(tenantDir, dateStr);
  const file = await readDistilledFile(filePath, tenantId);
  file.records.push(...records);
  await writeAtomicDistilledJson(filePath, file);
}

/** 列出指定租户的所有 distilled records，可选按日期/状态/范围过滤 */
export async function listDistilledRecords(
  tenantDir: string,
  tenantId: string,
  dateStr?: string,
  filter?: { status?: DistilledStatus; scope?: "tenant" | "personal" },
): Promise<DistilledRecord[]> {
  let records: DistilledRecord[];

  if (dateStr) {
    const filePath = resolveDistilledFilePath(tenantDir, dateStr);
    const file = await readDistilledFile(filePath, tenantId);
    records = file.records;
  } else {
    const distilledDir = resolveDistilledDir(tenantDir);
    let entries: string[];
    try {
      entries = await fs.promises.readdir(distilledDir);
    } catch {
      return [];
    }

    records = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry.endsWith(".tmp")) {
        continue;
      }
      const filePath = path.join(distilledDir, entry);
      const file = await readDistilledFile(filePath, tenantId);
      records.push(...file.records);
    }
  }

  // Backfill scope for old records that lack the field
  for (const r of records) {
    if (!r.scope) {
      (r as unknown as Record<string, unknown>).scope = "tenant";
    }
  }

  if (!filter) {
    return records;
  }
  return records.filter((r) => {
    if (filter.status && r.status !== filter.status) return false;
    if (filter.scope && r.scope !== filter.scope) return false;
    return true;
  });
}

/** Update status of distilled records by recordId across all date files. */
export async function updateDistilledRecordStatus(
  tenantDir: string,
  recordIds: string[],
  newStatus: DistilledStatus,
): Promise<number> {
  if (recordIds.length === 0) {
    return 0;
  }
  const idSet = new Set(recordIds);
  const distilledDir = resolveDistilledDir(tenantDir);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(distilledDir);
  } catch {
    return 0;
  }

  const now = new Date().toISOString();
  let totalUpdated = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) {
      continue;
    }
    const filePath = path.join(distilledDir, entry);
    const file = await readDistilledFile(filePath, "");
    let fileChanged = false;

    for (const record of file.records) {
      if (idSet.has(record.recordId)) {
        record.status = newStatus;
        record.updatedAt = now;
        fileChanged = true;
        totalUpdated++;
      }
    }

    if (fileChanged) {
      await writeAtomicDistilledJson(filePath, file);
    }
  }

  return totalUpdated;
}

/** Update status and set additional metadata fields on matching records. */
export async function updateDistilledRecordStatusWithMeta(
  tenantDir: string,
  recordIds: string[],
  newStatus: DistilledStatus,
  meta: { promotedAt?: string; supersededBy?: string },
): Promise<number> {
  if (recordIds.length === 0) {
    return 0;
  }
  const idSet = new Set(recordIds);
  const distilledDir = resolveDistilledDir(tenantDir);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(distilledDir);
  } catch {
    return 0;
  }

  const now = new Date().toISOString();
  let totalUpdated = 0;

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) {
      continue;
    }
    const filePath = path.join(distilledDir, entry);
    const file = await readDistilledFile(filePath, "");
    let fileChanged = false;

    for (const record of file.records) {
      if (idSet.has(record.recordId)) {
        record.status = newStatus;
        record.updatedAt = now;
        if (meta.promotedAt) {
          record.promotedAt = meta.promotedAt;
        }
        if (meta.supersededBy) {
          record.supersededBy = meta.supersededBy;
        }
        fileChanged = true;
        totalUpdated++;
      }
    }

    if (fileChanged) {
      await writeAtomicDistilledJson(filePath, file);
    }
  }

  return totalUpdated;
}
