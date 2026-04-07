import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "dotenv";
import { initDb, closeDb, query } from "../../src/db/index.js";
import type { ModelConfig } from "./types.js";

export function initTestEnv(): void {
  config({ path: path.resolve(process.cwd(), ".env.dev"), override: true });
  initDb();
}

export async function teardownTestEnv(): Promise<void> {
  await closeDb();
}

export async function loadModelConfig(): Promise<ModelConfig> {
  const result = await query(
    "SELECT id, provider_type, api_key_encrypted, base_url, api_protocol, models FROM tenant_models WHERE is_active = true LIMIT 1",
  );

  if (result.rows.length === 0) {
    throw new Error("No active tenant_models found in database");
  }

  const row = result.rows[0] as Record<string, unknown>;
  const models = (typeof row.models === "string" ? JSON.parse(row.models) : row.models) as Array<{ id: string }>;

  if (!models || models.length === 0) {
    throw new Error("tenant_models record has no models defined");
  }

  const apiKey = row.api_key_encrypted as string | null;
  if (!apiKey) {
    throw new Error("tenant_models record has no API key");
  }

  return {
    tenantModelId: row.id as string,
    providerType: row.provider_type as string,
    apiKey,
    baseUrl: (row.base_url as string) ?? null,
    apiProtocol: (row.api_protocol as string) ?? "openai-completions",
    modelId: models[0].id,
  };
}

export async function createTempWorkspace(memoryMd?: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-exp-live-"));
  await fs.mkdir(path.join(dir, "experience", "candidates"), { recursive: true });

  if (memoryMd !== undefined && memoryMd !== "") {
    await fs.writeFile(path.join(dir, "MEMORY.md"), memoryMd, "utf-8");
  }

  return dir;
}

export async function cleanupWorkspace(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
