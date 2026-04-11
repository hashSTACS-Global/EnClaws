import { readFile } from "node:fs/promises";
import Ajv from "ajv";

const ajv = new Ajv({ allErrors: true });

export type JsonSchema = Record<string, unknown>;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function loadSchemaFile(absolutePath: string): Promise<JsonSchema> {
  const raw = await readFile(absolutePath, "utf8");
  return JSON.parse(raw) as JsonSchema;
}

export function validateAgainstSchema(data: unknown, schema: JsonSchema): ValidationResult {
  const validate = ajv.compile(schema);
  const ok = validate(data);

  if (ok) {
    return { valid: true, errors: [] };
  }

  const errors = (validate.errors ?? []).map((err) => {
    const path = err.instancePath || "/";
    const missingProp = err.params?.missingProperty ? ` (${err.params.missingProperty})` : "";
    return `${path} ${err.message}${missingProp}`.trim();
  });

  return { valid: false, errors };
}
