import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { PipelineRegistry } from "./registry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "../../../test/fixtures/app-v03");

describe("PipelineRegistry", () => {
  it("discovers all pipelines under <app>/pipelines/", async () => {
    const registry = new PipelineRegistry();
    await registry.loadFromApp(APP_DIR);
    const names = registry
      .list()
      .map((p) => p.name)
      .toSorted();
    expect(names).toEqual(["echo", "hello"]);
  });

  it("get by name returns the correct pipeline", async () => {
    const registry = new PipelineRegistry();
    await registry.loadFromApp(APP_DIR);
    const echo = registry.get("echo");
    expect(echo?.definition.name).toBe("echo");
    expect(echo?.dir).toContain("echo-pipeline");
  });

  it("returns undefined for missing pipeline", async () => {
    const registry = new PipelineRegistry();
    await registry.loadFromApp(APP_DIR);
    expect(registry.get("nonexistent")).toBeUndefined();
  });

  it("rejects duplicate pipeline names", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "reg-dup-"));
    await mkdir(path.join(tmpDir, "pipelines", "one"), { recursive: true });
    await mkdir(path.join(tmpDir, "pipelines", "two"), { recursive: true });
    const yaml = `name: shared-name
description: test
input: {}
steps:
  - name: s
    type: code
    command: python3 s.py
output: s
`;
    await writeFile(path.join(tmpDir, "pipelines", "one", "pipeline.yaml"), yaml);
    await writeFile(path.join(tmpDir, "pipelines", "two", "pipeline.yaml"), yaml);

    const registry = new PipelineRegistry();
    await expect(registry.loadFromApp(tmpDir)).rejects.toThrow(/Duplicate pipeline name/);
  });

  it("silently skips non-pipeline subdirs without pipeline.yaml", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "reg-skip-"));
    await mkdir(path.join(tmpDir, "pipelines", "_shared"), { recursive: true });
    await mkdir(path.join(tmpDir, "pipelines", "valid-pipeline"), { recursive: true });
    const yaml = `name: valid
description: test
input: {}
steps:
  - name: s
    type: code
    command: python3 s.py
output: s
`;
    await writeFile(path.join(tmpDir, "pipelines", "valid-pipeline", "pipeline.yaml"), yaml);

    const registry = new PipelineRegistry();
    await registry.loadFromApp(tmpDir);
    const names = registry.list().map((p) => p.name);
    expect(names).toEqual(["valid"]);
  });
});
