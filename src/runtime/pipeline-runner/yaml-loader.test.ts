import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { loadPipelineYaml } from "./yaml-loader.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FIXTURE_DIR = path.resolve(
  __dirname,
  "../../../test/fixtures/app-v03/pipelines/echo-pipeline",
);

describe("loadPipelineYaml", () => {
  it("loads and parses pipeline.yaml from fixture", async () => {
    const def = await loadPipelineYaml(path.join(FIXTURE_DIR, "pipeline.yaml"));
    expect(def.name).toBe("echo");
    expect(def.description).toContain("echo");
    expect(def.steps).toHaveLength(2);
    expect(def.steps[0].type).toBe("code");
    expect(def.steps[1].type).toBe("llm");
    expect(def.triggers).toEqual(["echo", "test echo"]);
  });

  it("throws a descriptive error on malformed YAML", async () => {
    await expect(loadPipelineYaml(path.join(FIXTURE_DIR, "does-not-exist.yaml"))).rejects.toThrow(
      /ENOENT|not exist/,
    );
  });
});
