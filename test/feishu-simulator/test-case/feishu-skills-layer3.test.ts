/**
 * Feishu Skills Layer 3 tests — LLM-as-Judge reply quality evaluation.
 *
 * Extends Layer 2 E2E tests with LLM-based quality assessment. Each test case
 * can define `llmJudge.criteria` — a list of human-readable quality standards.
 * An LLM evaluates the bot's reply against these criteria and scores it.
 *
 * Prerequisites:
 * - Same as Layer 2 (Gateway running, Lark plugin connected)
 * - LLM API key (Anthropic or OpenAI) configured via environment variables
 *
 * Usage:
 *   pnpm vitest run test/feishu-simulator/test-case/feishu-skills-layer3.test.ts
 *
 * Environment variables:
 *   TEST_DATA_DIR          — test data directory (default: test-data/feishu-skills-layer3)
 *   TEST_CSV_OUTPUT        — CSV report path
 *   TEST_REPLY_TIMEOUT     — bot reply timeout ms (default: 120000)
 *   TEST_POLL_INTERVAL     — poll interval ms (default: 2000)
 *   LLM_JUDGE_PROVIDER     — "anthropic" or "openai" (default: "anthropic")
 *   LLM_JUDGE_MODEL        — model ID (default: "claude-haiku-4-5-20251001")
 *   LLM_JUDGE_API_KEY      — API key (required for Layer 3)
 *   LLM_JUDGE_BASE_URL     — API base URL override (optional)
 */

import { config } from "dotenv";
config({ override: true });

import path from "node:path";
import { describe, it } from "vitest";
import { runTestFiles } from "../test-runner/index.js";
import type { LlmJudgeConfig } from "../types.js";

const SIMULATOR_DIR = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..");

describe("feishu-skills-layer3 (llm-judge)", () => {
  it("run quality evaluation cases", async () => {
    const apiKey = process.env.LLM_JUDGE_API_KEY;
    if (!apiKey) {
      console.log("Skipping Layer 3: LLM_JUDGE_API_KEY not set");
      return;
    }

    const llmJudge: LlmJudgeConfig = {
      provider: (process.env.LLM_JUDGE_PROVIDER as "anthropic" | "openai") ?? "anthropic",
      model: process.env.LLM_JUDGE_MODEL ?? "claude-haiku-4-5-20251001",
      apiKey,
      baseUrl: process.env.LLM_JUDGE_BASE_URL,
    };

    const { errors } = await runTestFiles({
      dataDir: process.env.TEST_DATA_DIR ?? path.join(SIMULATOR_DIR, "test-data/feishu-skills-layer3"),
      csvOutput: process.env.TEST_CSV_OUTPUT
        ?? path.join(SIMULATOR_DIR, `test-results/feishu-skills-layer3-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`),
      continueOnFailure: true,
      concurrency: 1,
      replyTimeoutMs: Number(process.env.TEST_REPLY_TIMEOUT) || 120_000,
      pollIntervalMs: Number(process.env.TEST_POLL_INTERVAL) || 2000,
      llmJudge,
    });

    if (errors.length > 0) {
      throw new Error(`${errors.length} case(s) failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
  }, 600_000);
});
