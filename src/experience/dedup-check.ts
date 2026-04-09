import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveDefaultAgentId,
  resolveAgentWorkspaceDir,
  resolveAgentDir,
  resolveAgentEffectiveModelPrimary,
} from "../agents/agent-scope.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "../agents/defaults.js";
import { parseModelRef } from "../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../agents/pi-embedded.js";
import type { OpenClawConfig } from "../config/config.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import { MARKER_START, MARKER_END } from "./publish.js";
import type { DistilledRecord } from "./types.js";

const log = createSubsystemLogger("experience/dedup-check");

export interface DedupResult {
  duplicates: Array<{ record: DistilledRecord; matchedLine: string }>;
  unique: DistilledRecord[];
}

/**
 * Extract hand-written content from MEMORY.md (everything outside the marker block).
 */
export function extractHandWrittenContent(memoryContent: string): string {
  const startIdx = memoryContent.indexOf(MARKER_START);
  const endIdx = memoryContent.indexOf(MARKER_END);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = memoryContent.slice(0, startIdx).trim();
    const after = memoryContent.slice(endIdx + MARKER_END.length).trim();
    return [before, after].filter(Boolean).join("\n");
  }
  return memoryContent.trim();
}

const DEDUP_SYSTEM_PROMPT = [
  "You are a deduplication checker. Compare auto-extracted knowledge records against existing hand-written memory entries.",
  "For each record, determine if it is semantically duplicated by any existing hand-written entry.",
  "Two entries are duplicates if they convey the same core fact, even if worded differently.",
  "Return a strict JSON array of objects. Each object has:",
  '  - "recordId": the ID of the auto-extracted record',
  '  - "isDuplicate": true if semantically duplicated, false if unique',
  '  - "matchedLine": the hand-written line it duplicates (empty string if unique)',
  "Return ONLY the JSON array, no markdown fences.",
].join("\n");

function buildDedupPrompt(handWritten: string, records: DistilledRecord[]): string {
  const recordData = records.map((r) => ({
    recordId: r.recordId,
    kind: r.kind,
    summary: r.summary,
  }));
  return [
    "## Existing hand-written memory entries:",
    "",
    handWritten,
    "",
    "## Auto-extracted records to check:",
    "",
    JSON.stringify(recordData, null, 2),
    "",
    "For each record, determine if it is semantically duplicated by any hand-written entry above.",
    'Return ONLY a JSON array: [{"recordId": "...", "isDuplicate": true/false, "matchedLine": "..."}]',
  ].join("\n");
}

interface DedupLlmOutput {
  recordId: string;
  isDuplicate: boolean;
  matchedLine: string;
}

export function parseDedupResponse(text: string): DedupLlmOutput[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    const parsed: unknown = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const results: DedupLlmOutput[] = [];
    for (const item of parsed) {
      if (
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>).recordId === "string" &&
        typeof (item as Record<string, unknown>).isDuplicate === "boolean"
      ) {
        results.push({
          recordId: (item as Record<string, unknown>).recordId as string,
          isDuplicate: (item as Record<string, unknown>).isDuplicate as boolean,
          matchedLine: String((item as Record<string, unknown>).matchedLine ?? ""),
        });
      }
    }
    return results;
  } catch {
    log.warn("Failed to parse dedup response", { responsePreview: text.slice(0, 200) });
    return [];
  }
}

async function callDedupLlm(params: {
  prompt: string;
  cfg: OpenClawConfig;
}): Promise<string | null> {
  let tempSessionFile: string | null = null;
  try {
    const agentId = resolveDefaultAgentId(params.cfg);
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
    const agentDir = resolveAgentDir(params.cfg, agentId);

    const modelRef = resolveAgentEffectiveModelPrimary(params.cfg, agentId);
    const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
    const provider = parsed?.provider ?? DEFAULT_PROVIDER;
    const model = parsed?.model ?? DEFAULT_MODEL;

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-dedup-"));
    tempSessionFile = path.join(tempDir, "session.jsonl");

    const result = await runEmbeddedPiAgent({
      sessionId: `dedup-${Date.now()}`,
      sessionKey: "temp:dedup",
      agentId,
      sessionFile: tempSessionFile,
      workspaceDir,
      agentDir,
      config: params.cfg,
      prompt: params.prompt,
      extraSystemPrompt: DEDUP_SYSTEM_PROMPT,
      provider,
      model,
      timeoutMs: 120_000,
      runId: `dedup-${Date.now()}`,
      disableTools: true,
    });

    return result.payloads?.[0]?.text ?? null;
  } catch (err) {
    log.error("Dedup LLM call failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  } finally {
    if (tempSessionFile) {
      try {
        await fs.rm(path.dirname(tempSessionFile), { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Check records against hand-written MEMORY.md content for semantic duplicates.
 * Requires LLM call. If LLM call fails, returns all records as unique (fail-open).
 */
export async function checkDuplicates(params: {
  tenantDir: string;
  records: DistilledRecord[];
  cfg: OpenClawConfig;
}): Promise<DedupResult> {
  if (params.records.length === 0) {
    return { duplicates: [], unique: [] };
  }

  // Read MEMORY.md hand-written content
  const memoryPath = path.join(params.tenantDir, "MEMORY.md");
  let memoryContent: string;
  try {
    memoryContent = await fs.readFile(memoryPath, "utf-8");
  } catch {
    // No MEMORY.md — nothing to dedup against
    return { duplicates: [], unique: params.records };
  }

  const handWritten = extractHandWrittenContent(memoryContent);
  if (!handWritten) {
    return { duplicates: [], unique: params.records };
  }

  // Call LLM for semantic dedup
  const prompt = buildDedupPrompt(handWritten, params.records);

  let responseText: string | null = null;
  try {
    responseText = await callDedupLlm({ prompt, cfg: params.cfg });
  } catch (err) {
    log.warn("Dedup LLM call failed, proceeding without dedup", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { duplicates: [], unique: params.records };
  }

  if (!responseText) {
    return { duplicates: [], unique: params.records };
  }

  const llmResults = parseDedupResponse(responseText);
  const dupSet = new Map<string, string>();
  for (const r of llmResults) {
    if (r.isDuplicate) {
      dupSet.set(r.recordId, r.matchedLine);
    }
  }

  const duplicates: DedupResult["duplicates"] = [];
  const unique: DistilledRecord[] = [];
  for (const record of params.records) {
    const matchedLine = dupSet.get(record.recordId);
    if (matchedLine !== undefined) {
      duplicates.push({ record, matchedLine });
    } else {
      unique.push(record);
    }
  }

  return { duplicates, unique };
}
