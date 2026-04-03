/**
 * Feishu Skills E2E tests (Layer 2).
 *
 * Sends natural-language messages to the bot via Feishu API, waits for the bot
 * to process through EnClaws (LLM + skill execution), then polls for the reply
 * and runs assertions.
 *
 * Prerequisites:
 * - Gateway running with Lark plugin connected
 * - Test data JSON files in test-data/feishu-skills-layer2/ with valid appId/appSecret/userOpenId
 *
 * Usage:
 *   pnpm vitest run test/feishu-simulator/test-case/feishu-skills-layer2.test.ts
 *
 * Environment variables:
 *   TEST_DATA_DIR        — test data directory (default: test-data/feishu-skills-layer2)
 *   TEST_CSV_OUTPUT      — CSV report path
 *   TEST_CONCURRENCY     — parallel file count (default: 1, sequential for skill tests)
 *   TEST_REPLY_TIMEOUT   — bot reply timeout ms (default: 120000, longer for LLM)
 *   TEST_POLL_INTERVAL   — poll interval ms (default: 2000)
 */

import { config } from "dotenv";
config({ override: true });

import path from "node:path";
import { describe, it } from "vitest";
import { runTestFiles } from "../test-runner/index.js";

const SIMULATOR_DIR = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..");

describe("feishu-skills (e2e)", () => {
  it("run feishu-skills test cases", async () => {
    const { errors } = await runTestFiles({
      dataDir: process.env.TEST_DATA_DIR ?? path.join(SIMULATOR_DIR, "test-data/feishu-skills-layer2"),
      csvOutput: process.env.TEST_CSV_OUTPUT
        ?? path.join(SIMULATOR_DIR, `test-results/feishu-skills-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`),
      continueOnFailure: true,
      // Sequential by default — skill tests may have ordering dependencies
      concurrency: Number(process.env.TEST_CONCURRENCY) || 1,
      // Longer timeout for LLM processing + skill execution
      replyTimeoutMs: Number(process.env.TEST_REPLY_TIMEOUT) || 120_000,
      pollIntervalMs: Number(process.env.TEST_POLL_INTERVAL) || 2000,
    });

    if (errors.length > 0) {
      throw new Error(`${errors.length} case(s) failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
  }, 600_000);
});
