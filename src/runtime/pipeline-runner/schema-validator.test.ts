import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { loadSchemaFile, validateAgainstSchema } from "./schema-validator.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(
  __dirname,
  "../../../test/fixtures/app-v03/pipelines/echo-pipeline/schemas/summary.json",
);

describe("schema-validator", () => {
  it("validates a well-formed object", async () => {
    const schema = await loadSchemaFile(SCHEMA_PATH);
    const result = validateAgainstSchema(
      { summary: "a valid ten-char plus summary string" },
      schema,
    );
    expect(result.valid).toBe(true);
  });

  it("rejects missing required field", async () => {
    const schema = await loadSchemaFile(SCHEMA_PATH);
    const result = validateAgainstSchema({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.join(",")).toContain("summary");
  });

  it("rejects too-short string", async () => {
    const schema = await loadSchemaFile(SCHEMA_PATH);
    const result = validateAgainstSchema({ summary: "short" }, schema);
    expect(result.valid).toBe(false);
    expect(result.errors.join(",")).toMatch(/minLength|characters/);
  });

  it("rejects additional properties", async () => {
    const schema = await loadSchemaFile(SCHEMA_PATH);
    const result = validateAgainstSchema(
      { summary: "a valid summary with enough length", extra: 123 },
      schema,
    );
    expect(result.valid).toBe(false);
  });
});
