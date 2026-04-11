import { readFile } from "node:fs/promises";
import AjvModule, { type ErrorObject } from "ajv";

// ajv 8 has ESM interop issues; work around by casting to the constructor shape
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Ajv = (AjvModule as any).default ?? AjvModule;
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

  const errors = (validate.errors ?? []).map((err: ErrorObject) => {
    const path = err.instancePath || "/";
    const missingProp = err.params?.missingProperty ? ` (${err.params.missingProperty})` : "";
    return `${path} ${err.message}${missingProp}`.trim();
  });

  return { valid: false, errors };
}
