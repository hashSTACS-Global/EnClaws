import crypto from "node:crypto";
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
import type { DistillSettings } from "./distill-config.js";
import { addDistilledRecords } from "./distill-store.js";
import { filenameToSessionKey } from "./paths.js";
import { listCandidates, updateCandidateStatus } from "./store.js";
import type { DistilledRecord, ExperienceCandidate, ExperienceKind } from "./types.js";

const log = createSubsystemLogger("experience/distill");

const DISTILL_SYSTEM_PROMPT = [
  "You are a knowledge refiner. Merge scattered experience candidates into refined knowledge units.",
  "Rules:",
  "- Merge semantically duplicate or highly similar candidates.",
  "- Preserve core information from each candidate, do not lose key details.",
  "- If candidates contradict each other, keep the most specific or recent one, note the contradiction in evidence.",
  "- Output summary should be a directly usable knowledge statement, not a conversation summary.",
  "- Preserve all sourceCandidateIds for provenance.",
  "- Return a strict JSON array.",
].join("\n");

function buildDistillPrompt(kind: ExperienceKind, candidates: ExperienceCandidate[]): string {
  const candidateData = candidates.map((c) => ({
    candidateId: c.candidateId,
    summary: c.summary,
    evidence: c.evidence,
  }));
  return [
    `## The following are "${kind}" type experience candidates (${candidates.length} total)`,
    "",
    JSON.stringify(candidateData, null, 2),
    "",
    "Merge into refined knowledge units. Return ONLY a JSON array (no markdown fences).",
    'Each item: {"summary": "...", "evidence": ["...", "..."], "sourceCandidateIds": ["...", "..."]}',
  ].join("\n");
}

interface DistillLlmOutput {
  summary: string;
  evidence: string[];
  sourceCandidateIds: string[];
}

function parseDistillResponse(text: string): DistillLlmOutput[] {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const results: DistillLlmOutput[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).summary === "string" &&
      Array.isArray((item as Record<string, unknown>).evidence) &&
      Array.isArray((item as Record<string, unknown>).sourceCandidateIds)
    ) {
      results.push({
        summary: (item as Record<string, unknown>).summary as string,
        evidence: ((item as Record<string, unknown>).evidence as unknown[]).map(String),
        sourceCandidateIds: ((item as Record<string, unknown>).sourceCandidateIds as unknown[]).map(
          String,
        ),
      });
    }
  }
  return results;
}

async function callDistillLlm(params: {
  prompt: string;
  cfg: OpenClawConfig;
  modelOverride: string | null;
}): Promise<string | null> {
  let tempSessionFile: string | null = null;
  try {
    const agentId = resolveDefaultAgentId(params.cfg);
    const workspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
    const agentDir = resolveAgentDir(params.cfg, agentId);

    let provider: string;
    let model: string;
    if (params.modelOverride) {
      const parsed = parseModelRef(params.modelOverride, DEFAULT_PROVIDER);
      provider = parsed?.provider ?? DEFAULT_PROVIDER;
      model = parsed?.model ?? DEFAULT_MODEL;
    } else {
      const modelRef = resolveAgentEffectiveModelPrimary(params.cfg, agentId);
      const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
      provider = parsed?.provider ?? DEFAULT_PROVIDER;
      model = parsed?.model ?? DEFAULT_MODEL;
    }

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-distill-"));
    tempSessionFile = path.join(tempDir, "session.jsonl");

    const result = await runEmbeddedPiAgent({
      sessionId: `distill-${Date.now()}`,
      sessionKey: "temp:distill",
      agentId,
      sessionFile: tempSessionFile,
      workspaceDir,
      agentDir,
      config: params.cfg,
      prompt: params.prompt,
      extraSystemPrompt: DISTILL_SYSTEM_PROMPT,
      provider,
      model,
      timeoutMs: 120_000,
      runId: `distill-${Date.now()}`,
      disableTools: true,
    });

    return result.payloads?.[0]?.text ?? null;
  } catch (err) {
    log.error("Distill LLM call failed", {
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

async function distillKindBatch(params: {
  kind: ExperienceKind;
  candidates: ExperienceCandidate[];
  cfg: OpenClawConfig;
  settings: DistillSettings;
  tenantId: string;
}): Promise<{ records: DistilledRecord[]; processedCandidateIds: string[] }> {
  const { kind, candidates, cfg, settings, tenantId } = params;
  const now = new Date().toISOString();

  const batches: ExperienceCandidate[][] = [];
  for (let i = 0; i < candidates.length; i += settings.maxCandidatesPerBatch) {
    batches.push(candidates.slice(i, i + settings.maxCandidatesPerBatch));
  }

  const allOutputs: DistillLlmOutput[] = [];
  const processedCandidateIds: string[] = [];

  for (const batch of batches) {
    const prompt = buildDistillPrompt(kind, batch);
    const responseText = await callDistillLlm({ prompt, cfg, modelOverride: settings.model });

    if (!responseText) {
      log.warn("No response from distill LLM", { kind, batchSize: batch.length });
      continue;
    }

    try {
      const outputs = parseDistillResponse(responseText);
      allOutputs.push(...outputs);
      processedCandidateIds.push(...batch.map((c) => c.candidateId));
    } catch {
      log.warn("Failed to parse distill response", {
        kind,
        responsePreview: responseText.slice(0, 200),
      });
    }
  }

  // Second-pass merge if multiple batches
  if (batches.length > 1 && allOutputs.length > 1) {
    const mergePrompt = [
      `## Intermediate distilled results for "${kind}" (${allOutputs.length} items from multiple batches)`,
      "",
      JSON.stringify(allOutputs, null, 2),
      "",
      "Merge any remaining duplicates. Return ONLY a JSON array.",
      'Each item: {"summary": "...", "evidence": ["...", "..."], "sourceCandidateIds": ["...", "..."]}',
    ].join("\n");

    const mergeText = await callDistillLlm({
      prompt: mergePrompt,
      cfg,
      modelOverride: settings.model,
    });
    if (mergeText) {
      try {
        const merged = parseDistillResponse(mergeText);
        if (merged.length > 0) {
          allOutputs.length = 0;
          allOutputs.push(...merged);
        }
      } catch {
        log.warn("Failed to parse second-pass merge response", { kind });
      }
    }
  }

  // Build candidate lookup for userId resolution
  const candidateMap = new Map<string, ExperienceCandidate>();
  for (const c of candidates) {
    candidateMap.set(c.candidateId, c);
  }

  const records: DistilledRecord[] = allOutputs.map((output) => {
    const userIds = new Set<string>();
    for (const cid of output.sourceCandidateIds) {
      const c = candidateMap.get(cid);
      if (c) {
        userIds.add(c.sessionId);
      }
    }
    return {
      recordId: `dist_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`,
      tenantId,
      kind,
      summary: output.summary,
      evidence: output.evidence,
      sourceCandidateIds: output.sourceCandidateIds,
      sourceUserIds: [...userIds],
      status: "pending_review" as const,
      createdAt: now,
      updatedAt: now,
    };
  });

  return { records, processedCandidateIds };
}

export interface DistillResult {
  totalCandidates: number;
  totalRecords: number;
  byKind: Record<string, { candidates: number; records: number }>;
  outputPath: string;
}

export async function runDistill(params: {
  cfg: OpenClawConfig;
  tenantId: string;
  tenantDir: string;
  userWorkspaceDirs: string[];
  settings: DistillSettings;
}): Promise<DistillResult> {
  const { cfg, tenantId, tenantDir, userWorkspaceDirs, settings } = params;
  const dateStr = new Date().toISOString().slice(0, 10);

  // 1. Collect all pending candidates
  const allCandidates: ExperienceCandidate[] = [];
  for (const workspaceDir of userWorkspaceDirs) {
    const candidates = await listCandidates(workspaceDir);
    for (const c of candidates) {
      if (c.status === "pending") {
        allCandidates.push(c);
      }
    }
  }

  if (allCandidates.length === 0) {
    return { totalCandidates: 0, totalRecords: 0, byKind: {}, outputPath: "" };
  }

  // 2. Group by kind
  const byKind = new Map<ExperienceKind, ExperienceCandidate[]>();
  for (const c of allCandidates) {
    const group = byKind.get(c.kind) ?? [];
    group.push(c);
    byKind.set(c.kind, group);
  }

  // 3. Process each kind
  const allRecords: DistilledRecord[] = [];
  const allProcessedIds: string[] = [];
  const resultByKind: Record<string, { candidates: number; records: number }> = {};

  for (const [kind, candidates] of byKind) {
    const { records, processedCandidateIds } = await distillKindBatch({
      kind,
      candidates,
      cfg,
      settings,
      tenantId,
    });
    allRecords.push(...records);
    allProcessedIds.push(...processedCandidateIds);
    resultByKind[kind] = { candidates: candidates.length, records: records.length };
  }

  // 4. Write distilled records
  if (allRecords.length > 0) {
    await addDistilledRecords(tenantDir, dateStr, tenantId, allRecords);
  }

  // 5. Update candidate statuses to "distilled"
  const processedSet = new Set(allProcessedIds);
  for (const workspaceDir of userWorkspaceDirs) {
    const candidatesDir = path.join(workspaceDir, "experience", "candidates");
    let entries: string[];
    try {
      entries = await fs.readdir(candidatesDir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".json") || entry.endsWith(".tmp")) {
        continue;
      }
      const sessionKey = filenameToSessionKey(entry);
      const fileCandidates = await listCandidates(workspaceDir, sessionKey);
      const idsInFile = fileCandidates
        .filter((c) => processedSet.has(c.candidateId))
        .map((c) => c.candidateId);

      if (idsInFile.length > 0) {
        await updateCandidateStatus(workspaceDir, sessionKey, idsInFile, "distilled");
      }
    }
  }

  const outputPath = `tenants/${tenantId}/experience/distilled/${dateStr}.json`;
  return {
    totalCandidates: allProcessedIds.length,
    totalRecords: allRecords.length,
    byKind: resultByKind,
    outputPath,
  };
}
