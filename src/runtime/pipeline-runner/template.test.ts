import { describe, it, expect } from "vitest";
import { renderTemplate } from "./template.js";
import type { ExecutionContext } from "./types.js";

function makeCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    input: { message: "hello" },
    steps: {
      prepare: { output: { content: "prepared text", count: 42 } },
    },
    pipelineDir: "/tmp/pipeline",
    workspaceDir: "/tmp/workspace",
    appName: "test-app",
    tenantId: "test-tenant",
    ...overrides,
  };
}

describe("renderTemplate", () => {
  it("substitutes {{input.x}}", () => {
    const result = renderTemplate("Hello {{input.message}}!", makeCtx());
    expect(result).toBe("Hello hello!");
  });

  it("substitutes {{step.output}} with the whole output as JSON", () => {
    const result = renderTemplate("Data: {{prepare.output}}", makeCtx());
    expect(result).toContain("prepared text");
    expect(result).toContain("42");
  });

  it("substitutes {{step.output.field}}", () => {
    const result = renderTemplate(
      "Content: {{prepare.output.content}}, count={{prepare.output.count}}",
      makeCtx(),
    );
    expect(result).toBe("Content: prepared text, count=42");
  });

  it("throws on unknown step reference", () => {
    expect(() => {
      renderTemplate("{{nonexistent.output}}", makeCtx());
    }).toThrow(/nonexistent/);
  });

  it("throws on unknown input field", () => {
    expect(() => {
      renderTemplate("{{input.missing}}", makeCtx());
    }).toThrow(/input.missing/);
  });

  it("leaves unrelated braces alone", () => {
    const result = renderTemplate('JSON: {"key": "value"}', makeCtx());
    expect(result).toBe('JSON: {"key": "value"}');
  });

  it("rejects prototype method names as step references (prototype pollution guard)", () => {
    expect(() => renderTemplate("{{toString.output}}", makeCtx())).toThrow(
      /unknown step.*toString/,
    );
    expect(() => renderTemplate("{{hasOwnProperty.output}}", makeCtx())).toThrow(
      /unknown step.*hasOwnProperty/,
    );
    expect(() => renderTemplate("{{constructor.output}}", makeCtx())).toThrow(
      /unknown step.*constructor/,
    );
  });

  it("rejects prototype method names as input field names", () => {
    expect(() => renderTemplate("{{input.toString}}", makeCtx())).toThrow(/undefined|toString/);
  });

  it("rejects empty path segments with a descriptive error", () => {
    expect(() => renderTemplate("{{input.}}", makeCtx())).toThrow(/empty path segment/);
    expect(() => renderTemplate("{{input..x}}", makeCtx())).toThrow(/empty path segment/);
  });

  it("handles multiple substitutions in one string", () => {
    const result = renderTemplate("A={{input.message}} B={{prepare.output.count}}", makeCtx());
    expect(result).toBe("A=hello B=42");
  });
});
