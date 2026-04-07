import fs from "node:fs";
import path from "node:path";
import type { TestScenario } from "../types.js";

export function loadScenarios(dataDir: string): Array<{ fileName: string; scenario: TestScenario }> {
  const results: Array<{ fileName: string; scenario: TestScenario }> = [];

  if (!fs.existsSync(dataDir)) {
    return results;
  }

  const files = fs.readdirSync(dataDir).filter((f) => f.endsWith(".json")).sort();
  for (const file of files) {
    const content = fs.readFileSync(path.join(dataDir, file), "utf-8");
    const scenario = JSON.parse(content) as TestScenario;
    results.push({ fileName: file, scenario });
  }

  return results;
}
