/**
 * Feishu Skills Layer 1 tests — direct script invocation.
 *
 * Executes skill JS scripts directly with CLI arguments, parses JSON output,
 * and asserts on exit code, output fields, etc.
 *
 * Prerequisites:
 * - feishu-skills repo available at the path specified in each test file's `skillsDir`
 * - Valid FEISHU_APP_ID/FEISHU_APP_SECRET in env or test file
 * - User already authorized (cached token exists)
 *
 * Usage:
 *   pnpm vitest run test/feishu-simulator/test-case/feishu-skills-layer1.test.ts
 *
 * Environment variables:
 *   TEST_DATA_DIR         — test data directory (default: test-data/feishu-skills-layer1)
 *   TEST_CSV_OUTPUT       — CSV report path
 *   TEST_COMMAND_TIMEOUT  — per-command timeout ms (default: 30000)
 */

import { config } from "dotenv";
config({ override: true });

import path from "node:path";
import { describe, it } from "vitest";
import { runScriptTestFiles } from "../test-runner/index.js";

const SIMULATOR_DIR = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..");

describe("feishu-skills-layer1 (script)", () => {
  it("run script test cases", async () => {
    const { errors } = await runScriptTestFiles({
      dataDir: process.env.TEST_DATA_DIR ?? path.join(SIMULATOR_DIR, "test-data/feishu-skills-layer1"),
      csvOutput: process.env.TEST_CSV_OUTPUT
        ?? path.join(SIMULATOR_DIR, `test-results/feishu-skills-layer1-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`),
      continueOnFailure: true,
      commandTimeoutMs: Number(process.env.TEST_COMMAND_TIMEOUT) || 30_000,
    });

    if (errors.length > 0) {
      throw new Error(`${errors.length} case(s) failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
  }, 300_000);
});
