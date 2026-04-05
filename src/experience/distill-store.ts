import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveDistilledDir, resolveDistilledFilePath } from "./paths.js";
import type { DistilledFile, DistilledRecord } from "./types.js";

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

/** 列出指定租户的所有 distilled records，可选按日期过滤 */
export async function listDistilledRecords(
  tenantDir: string,
  tenantId: string,
  dateStr?: string,
): Promise<DistilledRecord[]> {
  if (dateStr) {
    const filePath = resolveDistilledFilePath(tenantDir, dateStr);
    const file = await readDistilledFile(filePath, tenantId);
    return file.records;
  }

  const distilledDir = resolveDistilledDir(tenantDir);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(distilledDir);
  } catch {
    return [];
  }

  const results: DistilledRecord[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) {
      continue;
    }
    const filePath = path.join(distilledDir, entry);
    const file = await readDistilledFile(filePath, tenantId);
    results.push(...file.records);
  }

  return results;
}
