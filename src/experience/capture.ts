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
import { hasInterSessionUserProvenance } from "../sessions/input-provenance.js";
import { addCandidate } from "./store.js";
import type { ExperienceKind } from "./types.js";

const log = createSubsystemLogger("experience/capture");

const EXTRACTION_SYSTEM_PROMPT = [
  "You are an experience extractor. Identify durable knowledge worth retaining from conversations.",
  "Only extract long-lived knowledge: facts, preferences, workflows, policy hints, failure patterns, tool recipes.",
  "Skip: temporary/one-time content, pure Q&A, content already in MEMORY.md.",
  "Return a strict JSON array. Each item has: kind, summary, evidence.",
  'Valid kind values: "fact", "preference", "workflow", "policy_hint", "failure_pattern", "tool_recipe".',
  "If nothing worth extracting, return [].",
].join("\n");

function buildExtractionPrompt(transcriptContent: string, memoryContent: string | null): string {
  const parts = ["## Recent conversation\n", transcriptContent];
  if (memoryContent) {
    parts.unshift("## Current MEMORY.md\n", memoryContent, "\n");
  }
  parts.push(
    "\n\nExtract durable experience candidates from the conversation above.",
    "Return ONLY a JSON array (no markdown fences, no explanation).",
    'Example: [{"kind":"workflow","summary":"...","evidence":"..."}]',
  );
  return parts.join("\n");
}

interface ExtractionCandidate {
  kind: string;
  summary: string;
  evidence: string;
}

const VALID_KINDS = new Set<string>([
  "fact",
  "preference",
  "workflow",
  "policy_hint",
  "failure_pattern",
  "tool_recipe",
]);

function parseExtractionResponse(text: string): ExtractionCandidate[] {
  // Strip markdown fences if the model wrapped the JSON
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const results: ExtractionCandidate[] = [];
  for (const item of parsed) {
    if (
      typeof item === "object" &&
      item !== null &&
      typeof (item as Record<string, unknown>).kind === "string" &&
      typeof (item as Record<string, unknown>).summary === "string" &&
      typeof (item as Record<string, unknown>).evidence === "string" &&
      VALID_KINDS.has((item as Record<string, unknown>).kind as string)
    ) {
      results.push({
        kind: (item as Record<string, unknown>).kind as string,
        summary: (item as Record<string, unknown>).summary as string,
        evidence: (item as Record<string, unknown>).evidence as string,
      });
    }
  }
  return results;
}

/**
 * Read recent messages from a session transcript JSONL file.
 * Returns formatted "role: text" lines, or null if unreadable.
 */
export async function readRecentTranscriptMessages(
  sessionFilePath: string,
  messageCount: number,
): Promise<string | null> {
  try {
    const content = await fs.readFile(sessionFilePath, "utf-8");
    const lines = content.trim().split("\n");

    const allMessages: string[] = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.type === "message" && entry.message) {
          const msg = entry.message;
          const role = msg.role;
          if ((role === "user" || role === "assistant") && msg.content) {
            if (role === "user" && hasInterSessionUserProvenance(msg)) {
              continue;
            }
            const text = Array.isArray(msg.content)
              ? // oxlint-disable-next-line typescript/no-explicit-any
                msg.content.find((c: any) => c.type === "text")?.text
              : msg.content;
            if (text && !text.startsWith("/")) {
              allMessages.push(`${role}: ${text}`);
            }
          }
        }
      } catch {
        // Skip invalid JSON lines
      }
    }

    const recentMessages = allMessages.slice(-messageCount);
    return recentMessages.length > 0 ? recentMessages.join("\n") : null;
  } catch {
    return null;
  }
}

/**
 * Try primary session file first; if unreadable (e.g. rotated by /new),
 * fallback to the latest .jsonl.reset.* sibling.
 */
async function readTranscriptWithResetFallback(
  sessionFilePath: string,
  messageCount: number,
): Promise<string | null> {
  const primary = await readRecentTranscriptMessages(sessionFilePath, messageCount);
  if (primary) {
    return primary;
  }

  try {
    const dir = path.dirname(sessionFilePath);
    const base = path.basename(sessionFilePath);
    const resetPrefix = `${base}.reset.`;
    const files = await fs.readdir(dir);
    const resetCandidates = files.filter((name) => name.startsWith(resetPrefix)).toSorted();

    if (resetCandidates.length === 0) {
      return null;
    }

    const latestResetPath = path.join(dir, resetCandidates[resetCandidates.length - 1]);
    log.info("Falling back to reset transcript", { latestResetPath });
    return readRecentTranscriptMessages(latestResetPath, messageCount);
  } catch {
    return null;
  }
}

/**
 * Run experience candidate extraction from a session transcript.
 * Async fire-and-forget: logs errors but never throws.
 */
export async function extractCandidates(params: {
  workspaceDir: string;
  sessionKey: string;
  sessionId: string;
  sessionFilePath: string;
  turnsSinceLastCapture: number;
  maxMessages: number;
  cfg: OpenClawConfig;
  modelOverride: string | null;
}): Promise<void> {
  let tempSessionFile: string | null = null;

  try {
    const messageCount = Math.min(params.turnsSinceLastCapture * 2, params.maxMessages);
    if (messageCount < 1) {
      return;
    }

    // Read transcript tail (with fallback to .reset.* files for /new|/reset scenarios)
    log.info("Reading transcript", {
      sessionFilePath: params.sessionFilePath,
      messageCount,
      sessionKey: params.sessionKey,
    });
    const transcriptContent = await readTranscriptWithResetFallback(
      params.sessionFilePath,
      messageCount,
    );
    if (!transcriptContent) {
      log.info("No transcript content to extract from", {
        sessionKey: params.sessionKey,
        sessionFilePath: params.sessionFilePath,
      });
      return;
    }

    log.info("Transcript loaded, preparing LLM call", {
      sessionKey: params.sessionKey,
      transcriptLength: transcriptContent.length,
    });

    // Read MEMORY.md for dedup reference
    let memoryContent: string | null = null;
    try {
      memoryContent = await fs.readFile(path.join(params.workspaceDir, "MEMORY.md"), "utf-8");
      log.info("MEMORY.md loaded for dedup", { length: memoryContent.length });
    } catch {
      log.info("MEMORY.md not found, skipping dedup reference");
    }

    // Resolve model/provider
    const agentId = resolveDefaultAgentId(params.cfg);
    const agentWorkspaceDir = resolveAgentWorkspaceDir(params.cfg, agentId);
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

    log.info("Calling LLM for extraction", {
      provider,
      model,
      sessionKey: params.sessionKey,
    });

    // Create temp session file for the one-off LLM call
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-exp-capture-"));
    tempSessionFile = path.join(tempDir, "session.jsonl");

    const prompt = buildExtractionPrompt(transcriptContent, memoryContent);

    const result = await runEmbeddedPiAgent({
      sessionId: `experience-capture-${Date.now()}`,
      sessionKey: "temp:experience-capture",
      agentId,
      sessionFile: tempSessionFile,
      workspaceDir: agentWorkspaceDir,
      agentDir,
      config: params.cfg,
      prompt,
      extraSystemPrompt: EXTRACTION_SYSTEM_PROMPT,
      disableTools: true,
      provider,
      model,
      timeoutMs: 60_000,
      runId: `exp-capture-${Date.now()}`,
    });

    log.info("LLM call completed", {
      sessionKey: params.sessionKey,
      hasPayloads: Boolean(result.payloads?.length),
      payloadCount: result.payloads?.length ?? 0,
      error: result.meta?.error,
    });

    // Parse LLM response
    const responseText = result.payloads?.[0]?.text;
    if (!responseText) {
      log.info("No response from extraction LLM", {
        sessionKey: params.sessionKey,
        meta: JSON.stringify(result.meta ?? {}),
      });
      return;
    }

    let candidates: ExtractionCandidate[];
    try {
      candidates = parseExtractionResponse(responseText);
    } catch (parseErr) {
      log.warn("Failed to parse extraction response as JSON", {
        sessionKey: params.sessionKey,
        responsePreview: responseText.slice(0, 300),
        error: parseErr instanceof Error ? parseErr.message : String(parseErr),
      });
      return;
    }

    log.info("Parsed extraction response", {
      sessionKey: params.sessionKey,
      candidateCount: candidates.length,
    });

    if (candidates.length === 0) {
      return;
    }

    // Write candidates to store
    for (const c of candidates) {
      try {
        await addCandidate(params.workspaceDir, params.sessionKey, {
          sessionId: params.sessionId,
          kind: c.kind as ExperienceKind,
          summary: c.summary,
          evidence: c.evidence,
        });
      } catch (err) {
        log.error("Failed to write experience candidate", {
          sessionKey: params.sessionKey,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    log.info("Experience candidates written to store", {
      sessionKey: params.sessionKey,
      count: candidates.length,
      workspaceDir: params.workspaceDir,
    });
  } catch (err) {
    log.error("Experience extraction failed", {
      sessionKey: params.sessionKey,
      error: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    });
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
