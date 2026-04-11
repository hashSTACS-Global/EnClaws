import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { readAppManifest, AppManifestSchema } from "./manifest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.resolve(__dirname, "../../../test/fixtures/app-v03");

describe("AppManifestSchema", () => {
  it("parses a valid manifest", () => {
    const parsed = AppManifestSchema.parse({
      id: "pivot",
      name: "Team-Pivot",
      version: "0.1.0",
      api_version: "v0.3",
    });
    expect(parsed.id).toBe("pivot");
  });

  it("rejects invalid id (uppercase or starts with digit)", () => {
    expect(() =>
      AppManifestSchema.parse({
        id: "Pivot",
        name: "x",
        version: "0.1.0",
        api_version: "v0.3",
      }),
    ).toThrow(/id/);
    expect(() =>
      AppManifestSchema.parse({
        id: "1pivot",
        name: "x",
        version: "0.1.0",
        api_version: "v0.3",
      }),
    ).toThrow(/id/);
  });

  it("rejects missing api_version", () => {
    expect(() =>
      AppManifestSchema.parse({
        id: "x",
        name: "x",
        version: "0.1.0",
      }),
    ).toThrow(/api_version/);
  });

  it("readAppManifest reads and parses fixture app.json", async () => {
    const m = await readAppManifest(FIXTURE_DIR);
    expect(m.id).toBe("fixture-app");
    expect(m.api_version).toBe("v0.3");
  });
});
