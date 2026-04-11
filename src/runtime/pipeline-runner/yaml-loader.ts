import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { parsePipelineDefinition, type PipelineDefinition } from "./types.js";

export async function loadPipelineYaml(yamlPath: string): Promise<PipelineDefinition> {
  const raw = await readFile(yamlPath, "utf8");
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (e) {
    throw new Error(`Failed to parse YAML at ${yamlPath}: ${(e as Error).message}`, { cause: e });
  }
  try {
    return parsePipelineDefinition(parsed);
  } catch (e) {
    throw new Error(`Invalid pipeline definition at ${yamlPath}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}
