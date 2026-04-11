import { readdir } from "node:fs/promises";
import path from "node:path";
import { logError } from "../../logger.js";
import type { PipelineDefinition } from "./types.js";
import { loadPipelineYaml } from "./yaml-loader.js";

export interface RegisteredPipeline {
  name: string;
  dir: string; // 绝对路径：<app>/pipelines/<name>-pipeline
  definition: PipelineDefinition;
}

export class PipelineRegistry {
  private byName = new Map<string, RegisteredPipeline>();

  async loadFromApp(appDir: string): Promise<void> {
    const pipelinesDir = path.join(appDir, "pipelines");
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try {
      entries = await readdir(pipelinesDir, { withFileTypes: true });
    } catch {
      return; // APP 没有 pipelines/ 目录 → 空注册表
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const entryPath = path.join(pipelinesDir, entry.name);
      const yamlPath = path.join(entryPath, "pipeline.yaml");

      let def: PipelineDefinition;
      try {
        def = await loadPipelineYaml(yamlPath);
      } catch (e) {
        // ENOENT means this subdir isn't a pipeline (e.g., _shared/, node_modules/) — skip silently
        if ((e as NodeJS.ErrnoException).code === "ENOENT") {
          continue;
        }
        // Real parse / validation error — log via project logger and continue
        logError(
          `pipeline-runner: failed to load pipeline at ${yamlPath}: ${(e as Error).message}`,
        );
        continue;
      }

      // Duplicate check is a hard error — configuration mistake that must surface
      if (this.byName.has(def.name)) {
        throw new Error(`Duplicate pipeline name "${def.name}" in ${appDir}`);
      }
      this.byName.set(def.name, {
        name: def.name,
        dir: entryPath,
        definition: def,
      });
    }
  }

  get(name: string): RegisteredPipeline | undefined {
    return this.byName.get(name);
  }

  list(): RegisteredPipeline[] {
    return Array.from(this.byName.values());
  }
}
