import type { ExecutionContext } from "./types.js";

const TEMPLATE_RE = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

export function renderTemplate(template: string, ctx: ExecutionContext): string {
  return template.replace(TEMPLATE_RE, (_match, expr: string) => {
    const parts = expr.split(".");
    const root = parts[0];

    if (root === "input") {
      if (parts.length < 2) {
        throw new Error(`Template expression "${expr}" missing field after "input"`);
      }
      const field = parts.slice(1).join(".");
      const value = getPath(ctx.input, parts.slice(1));
      if (value === undefined) {
        throw new Error(`Template expression "input.${field}" is undefined`);
      }
      return stringify(value);
    }

    // step reference: <step_name>.output[.field]
    const stepOutput = ctx.steps[root];
    if (!stepOutput) {
      throw new Error(`Template expression references unknown step "${root}"`);
    }
    if (parts[1] !== "output") {
      throw new Error(`Template expression "${expr}" must use <step>.output[.field]`);
    }
    if (parts.length === 2) {
      return stringify(stepOutput.output);
    }
    const value = getPath(stepOutput.output, parts.slice(2));
    if (value === undefined) {
      throw new Error(`Template expression "${expr}" resolved to undefined`);
    }
    return stringify(value);
  });
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") {
      return undefined;
    }
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

function stringify(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}
