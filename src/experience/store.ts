import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { filenameToSessionKey, resolveCandidateFilePath, resolveCandidatesDir } from "./paths.js";
import type {
  ExperienceCandidate,
  ExperienceCandidateFile,
  ExperienceKind,
  ExperienceStatus,
} from "./types.js";

/** addCandidate 的输入参数：不含自动生成的 candidateId 和 createdAt */
export interface AddCandidateInput {
  sessionId: string;
  kind: ExperienceKind;
  summary: string;
  evidence: string;
  status?: ExperienceStatus;
}

/** 读取指定 sessionKey 的 candidate 文件，不存在时返回空结构 */
async function readCandidateFile(
  filePath: string,
  sessionKey: string,
): Promise<ExperienceCandidateFile> {
  try {
    const content = await fs.promises.readFile(filePath, "utf-8");
    return JSON.parse(content) as ExperienceCandidateFile;
  } catch {
    return { sessionKey, candidates: [] };
  }
}

/** 原子写入 JSON 文件：写临时文件 → rename */
async function writeAtomicJson(filePath: string, data: ExperienceCandidateFile): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const json = JSON.stringify(data, null, 2);
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;

  try {
    await fs.promises.writeFile(tmp, json, "utf-8");
    // Retry rename up to 5 times — on Windows rename can fail when the
    // target is momentarily locked by a concurrent reader.
    for (let i = 0; i < 5; i++) {
      try {
        await fs.promises.rename(tmp, filePath);
        return;
      } catch {
        if (i < 4) {
          // Short synchronous backoff before retry.
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * (i + 1));
        }
      }
    }
  } catch {
    // Clean up temp file on write failure.
    try {
      await fs.promises.unlink(tmp);
    } catch {
      // Ignore cleanup errors.
    }
    throw new Error(`Failed to write candidate file: ${filePath}`);
  }
}

/** 追加一条 candidate 到对应 sessionKey 的文件 */
export async function addCandidate(
  workspaceDir: string,
  sessionKey: string,
  input: AddCandidateInput,
): Promise<ExperienceCandidate> {
  const filePath = resolveCandidateFilePath(workspaceDir, sessionKey);

  const candidate: ExperienceCandidate = {
    candidateId: `exp_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
    sessionId: input.sessionId,
    kind: input.kind,
    summary: input.summary,
    evidence: input.evidence,
    status: input.status ?? "pending",
    createdAt: new Date().toISOString(),
  };

  const file = await readCandidateFile(filePath, sessionKey);
  file.candidates.push(candidate);
  await writeAtomicJson(filePath, file);

  return candidate;
}

/** 批量更新指定 candidateIds 的 status */
export async function updateCandidateStatus(
  workspaceDir: string,
  sessionKey: string,
  candidateIds: string[],
  newStatus: ExperienceStatus,
): Promise<number> {
  const filePath = resolveCandidateFilePath(workspaceDir, sessionKey);
  const file = await readCandidateFile(filePath, sessionKey);

  const idSet = new Set(candidateIds);
  let updated = 0;
  for (const candidate of file.candidates) {
    if (idSet.has(candidate.candidateId)) {
      candidate.status = newStatus;
      updated++;
    }
  }

  if (updated > 0) {
    await writeAtomicJson(filePath, file);
  }

  return updated;
}

/** 列出指定用户 workspace 下所有 candidate，可选按 sessionKey 过滤 */
export async function listCandidates(
  workspaceDir: string,
  sessionKey?: string,
): Promise<ExperienceCandidate[]> {
  if (sessionKey) {
    const filePath = resolveCandidateFilePath(workspaceDir, sessionKey);
    const file = await readCandidateFile(filePath, sessionKey);
    return file.candidates;
  }

  const candidatesDir = resolveCandidatesDir(workspaceDir);
  let entries: string[];
  try {
    entries = await fs.promises.readdir(candidatesDir);
  } catch {
    return [];
  }

  const results: ExperienceCandidate[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.endsWith(".tmp")) {
      continue;
    }
    const filePath = path.join(candidatesDir, entry);
    const key = filenameToSessionKey(entry);
    const file = await readCandidateFile(filePath, key);
    results.push(...file.candidates);
  }

  return results;
}
