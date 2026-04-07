import os from "node:os";
import path from "node:path";
import { describe, it, beforeAll, afterAll } from "vitest";
import { initTestEnv, teardownTestEnv, loadModelConfig } from "./test-env.js";
import { runAllScenarios } from "./test-runner/runner.js";
import type { ModelConfig } from "./types.js";

/** Resolve the real ENCLAWS state directory (same logic as src/config/paths.ts) */
function resolveStateDir(): string {
  if (process.env.ENCLAWS_STATE_DIR) return process.env.ENCLAWS_STATE_DIR;
  return path.join(os.homedir(), ".enclaws");
}

const isTruthyEnv = (v: string | undefined): boolean =>
  !!v && v !== "0" && v.toLowerCase() !== "false";

const LIVE = isTruthyEnv(process.env.LIVE) || isTruthyEnv(process.env.ENCLAWS_LIVE_TEST);
const describeLive = LIVE ? describe : describe.skip;

const SIMULATOR_DIR = path.resolve(
  new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"),
);

describeLive("experience-live", () => {
  let modelConfig: ModelConfig;

  beforeAll(async () => {
    initTestEnv();
    modelConfig = await loadModelConfig();
    console.log(`  Model: ${modelConfig.providerType}/${modelConfig.modelId}`);
  });

  afterAll(async () => {
    await teardownTestEnv();
  });

  it("run experience extraction scenarios", async () => {
    const stateDir = resolveStateDir();
    const workspaceDir = path.join(stateDir, "workspace");

    // Build config that mirrors how Gateway injects tenant_models into the Pi SDK:
    // Gateway uses "tm-{tenant_model_id}" as provider key and "tm-{id}/{modelId}" as model ref.
    // This is how model-auth.ts resolves the API key from cfg.models.providers.
    const providerKey = `tm-${modelConfig.tenantModelId}`;
    const modelRef = `${providerKey}/${modelConfig.modelId}`;
    const cfg = {
      models: {
        providers: {
          [providerKey]: {
            apiKey: modelConfig.apiKey,
            baseUrl: modelConfig.baseUrl ?? "",
            api: modelConfig.apiProtocol,
          },
        },
      },
      agents: {
        defaults: {
          workspace: workspaceDir,
          model: { primary: modelRef },
          experience: {
            capture: { enabled: true, turnInterval: 1, maxMessages: 20 },
            distill: { enabled: true, maxCandidatesPerBatch: 50 },
          },
        },
      },
    } as any;

    const { errors } = await runAllScenarios(
      {
        dataDir: process.env.TEST_DATA_DIR ?? path.join(SIMULATOR_DIR, "test-data"),
        csvOutput: process.env.TEST_CSV_OUTPUT
          ?? path.join(SIMULATOR_DIR, `test-results/${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`),
        continueOnFailure: true,
      },
      modelConfig,
      cfg,
    );

    if (errors.length > 0) {
      throw new Error(`${errors.length} assertion(s) failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);
    }
  }, 600_000);
});
