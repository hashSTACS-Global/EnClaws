import crypto from "node:crypto";
import path from "node:path";
import { chatComplete } from "../llm-client.js";
import type { ChatMessage } from "../llm-client.js";
import { createTranscript, appendUserMessage, appendAssistantMessage } from "../transcript-builder.js";
import { createTempWorkspace, cleanupWorkspace } from "../test-env.js";
import { checkCaptureAssertions, checkDistillAssertions } from "./asserter.js";
import { CsvWriter } from "./csv-writer.js";
import { loadScenarios } from "./file-loader.js";
import { extractCandidates } from "../../../src/experience/capture.js";
import { runDistill } from "../../../src/experience/distill.js";
import { listCandidates } from "../../../src/experience/store.js";
import { listDistilledRecords } from "../../../src/experience/distill-store.js";
import type { OpenClawConfig } from "../../../src/config/config.js";
import type { ModelConfig, ResultRow, RunnerOptions, TestScenario } from "../types.js";

/** Build "tm-{id}/modelId" string matching Gateway's tenant model provider key format */
function buildModelRef(mc: ModelConfig): string {
  return `tm-${mc.tenantModelId}/${mc.modelId}`;
}

export async function runAllScenarios(
  opts: RunnerOptions,
  modelConfig: ModelConfig,
  cfg: OpenClawConfig,
): Promise<{ results: ResultRow[]; errors: string[] }> {
  const scenarios = loadScenarios(opts.dataDir);

  if (scenarios.length === 0) {
    console.log(`No scenario JSON files found in: ${opts.dataDir}`);
    return { results: [], errors: [] };
  }

  const csv = new CsvWriter(opts.csvOutput);
  const allResults: ResultRow[] = [];
  const allErrors: string[] = [];

  for (const { fileName, scenario } of scenarios) {
    console.log(`\n--- ${fileName}: ${scenario.name} ---`);
    const { results, errors } = await runSingleScenario(scenario, modelConfig, cfg, csv);
    allResults.push(...results);
    allErrors.push(...errors);

    if (errors.length > 0 && !opts.continueOnFailure) {
      break;
    }
  }

  console.log(`\nCSV report: ${csv.path}`);
  return { results: allResults, errors: allErrors };
}

async function runSingleScenario(
  scenario: TestScenario,
  modelConfig: ModelConfig,
  cfg: OpenClawConfig,
  csv: CsvWriter,
): Promise<{ results: ResultRow[]; errors: string[] }> {
  const results: ResultRow[] = [];
  const errors: string[] = [];
  let workspaceDir: string | null = null;

  function record(row: ResultRow, error?: string) {
    results.push(row);
    csv.append(row);
    if (error) errors.push(error);
  }

  try {
    // 1. Create temp workspace
    workspaceDir = await createTempWorkspace(scenario.memoryMd);
    const sessionId = crypto.randomUUID();
    const sessionKey = "test:experience:live";
    const transcriptPath = path.join(workspaceDir, `${sessionId}.jsonl`);

    // 2. Build transcript via real LLM conversation
    const convStart = Date.now();
    await createTranscript(sessionId, transcriptPath);

    const conversationHistory: ChatMessage[] = [];
    if (scenario.systemPrompt) {
      conversationHistory.push({ role: "system", content: scenario.systemPrompt });
    }

    for (const turn of scenario.turns) {
      await appendUserMessage(transcriptPath, turn.user);
      conversationHistory.push({ role: "user", content: turn.user });

      const reply = await chatComplete(modelConfig, conversationHistory);
      await appendAssistantMessage(transcriptPath, reply);
      conversationHistory.push({ role: "assistant", content: reply });
    }

    const convDuration = Date.now() - convStart;
    console.log(`  Conversation: ${scenario.turns.length} turns (${convDuration}ms)`);
    record({
      scenario: scenario.name,
      phase: "conversation",
      status: "PASS",
      details: `${scenario.turns.length} turns completed`,
      duration: `${convDuration}ms`,
    });

    // 3. Run capture
    if (scenario.captureAssert) {
      const captureStart = Date.now();
      try {
        // Debug: verify transcript is readable
        const { readRecentTranscriptMessages } = await import("../../../src/experience/capture.js");
        const debugTranscript = await readRecentTranscriptMessages(transcriptPath, 20);
        console.log(`    [debug] transcript readable: ${!!debugTranscript}, length: ${debugTranscript?.length ?? 0}`);
        console.log(`    [debug] modelOverride: ${buildModelRef(modelConfig)}`);
        console.log(`    [debug] workspaceDir: ${workspaceDir}`);

        await extractCandidates({
          workspaceDir,
          sessionKey,
          sessionId,
          sessionFilePath: transcriptPath,
          turnsSinceLastCapture: scenario.turns.length,
          maxMessages: 20,
          cfg,
          modelOverride: buildModelRef(modelConfig),
        });

        const candidates = await listCandidates(workspaceDir, sessionKey);
        const captureDuration = Date.now() - captureStart;
        const failures = checkCaptureAssertions(candidates, scenario.captureAssert);

        if (failures.length > 0) {
          const msg = failures.join("; ");
          console.log(`  Capture: FAIL - ${msg} (${captureDuration}ms)`);
          console.log(`    Actual candidates: ${candidates.length} [${candidates.map((c) => `${c.kind}:"${c.summary.slice(0, 50)}"`).join(", ")}]`);
          record({
            scenario: scenario.name,
            phase: "capture",
            status: "FAIL",
            details: msg,
            duration: `${captureDuration}ms`,
          }, `[${scenario.name}] capture: ${msg}`);
        } else {
          console.log(`  Capture: PASS - ${candidates.length} candidates (${captureDuration}ms)`);
          record({
            scenario: scenario.name,
            phase: "capture",
            status: "PASS",
            details: `${candidates.length} candidates [${[...new Set(candidates.map((c) => c.kind))].join(",")}]`,
            duration: `${captureDuration}ms`,
          });
        }
      } catch (err) {
        const captureDuration = Date.now() - captureStart;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  Capture: ERROR - ${errMsg}`);
        record({
          scenario: scenario.name,
          phase: "capture",
          status: "FAIL",
          details: `ERROR: ${errMsg}`,
          duration: `${captureDuration}ms`,
        }, `[${scenario.name}] capture error: ${errMsg}`);
      }
    }

    // 4. Run distill (if assertions defined)
    if (scenario.distillAssert) {
      const distillStart = Date.now();
      try {
        const distillResult = await runDistill({
          cfg,
          tenantId: "test-live",
          tenantDir: workspaceDir,
          userWorkspaceDirs: [workspaceDir],
          settings: {
            enabled: true,
            model: buildModelRef(modelConfig),
            maxCandidatesPerBatch: 50,
          },
        });

        const dateStr = new Date().toISOString().slice(0, 10);
        const records = await listDistilledRecords(workspaceDir, "test-live", dateStr);
        const distillDuration = Date.now() - distillStart;
        const failures = checkDistillAssertions(records, scenario.distillAssert);

        if (failures.length > 0) {
          const msg = failures.join("; ");
          console.log(`  Distill: FAIL - ${msg} (${distillDuration}ms)`);
          record({
            scenario: scenario.name,
            phase: "distill",
            status: "FAIL",
            details: msg,
            duration: `${distillDuration}ms`,
          }, `[${scenario.name}] distill: ${msg}`);
        } else {
          console.log(`  Distill: PASS - ${records.length} records (${distillDuration}ms)`);
          record({
            scenario: scenario.name,
            phase: "distill",
            status: "PASS",
            details: `${distillResult.totalRecords} records from ${distillResult.totalCandidates} candidates`,
            duration: `${distillDuration}ms`,
          });
        }
      } catch (err) {
        const distillDuration = Date.now() - distillStart;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.log(`  Distill: ERROR - ${errMsg}`);
        record({
          scenario: scenario.name,
          phase: "distill",
          status: "FAIL",
          details: `ERROR: ${errMsg}`,
          duration: `${distillDuration}ms`,
        }, `[${scenario.name}] distill error: ${errMsg}`);
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`  Scenario ERROR: ${errMsg}`);
    record({
      scenario: scenario.name,
      phase: "conversation",
      status: "FAIL",
      details: `ERROR: ${errMsg}`,
      duration: "-",
    }, `[${scenario.name}] ${errMsg}`);
  } finally {
    if (workspaceDir) {
      await cleanupWorkspace(workspaceDir);
    }
  }

  return { results, errors };
}
