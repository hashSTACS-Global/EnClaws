import { readdir, stat } from "node:fs/promises";
import path from "node:path";
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
    let entries: string[];
    try {
      entries = await readdir(pipelinesDir);
    } catch {
      return; // APP 没有 pipelines/ 目录 → 空注册表
    }
    for (const entry of entries) {
      const entryPath = path.join(pipelinesDir, entry);
      const st = await stat(entryPath);
      if (!st.isDirectory()) {
        continue;
      }
      const yamlPath = path.join(entryPath, "pipeline.yaml");
      try {
        const def = await loadPipelineYaml(yamlPath);
        if (this.byName.has(def.name)) {
          throw new Error(`Duplicate pipeline name "${def.name}" in ${appDir}`);
        }
        this.byName.set(def.name, {
          name: def.name,
          dir: entryPath,
          definition: def,
        });
      } catch (e) {
        // 单个 pipeline 加载失败不应中断整个 APP 的注册
        console.error(`Failed to load pipeline at ${yamlPath}:`, e);
      }
    }
  }

  get(name: string): RegisteredPipeline | undefined {
    return this.byName.get(name);
  }

  list(): RegisteredPipeline[] {
    return Array.from(this.byName.values());
  }
}
