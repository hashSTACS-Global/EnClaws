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
});
