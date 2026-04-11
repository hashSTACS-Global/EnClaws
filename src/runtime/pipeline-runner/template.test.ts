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
});
