import path from "node:path";
import { resolveModelTier } from "./model-tier.js";
import { loadSchemaFile, validateAgainstSchema } from "./schema-validator.js";
import { renderTemplate } from "./template.js";
import type { LLMStep, ExecutionContext, StepOutput } from "./types.js";

export interface LLMCallInput {
  prompt: string;
  model: string;
  tenantId: string;
}

export interface LLMStepDeps {
  /** Call EC provider to get LLM output as a JSON string */
  callProvider: (input: LLMCallInput) => Promise<string>;
}

export async function runLLMStep(
  step: LLMStep,
  ctx: ExecutionContext,
  deps: LLMStepDeps,
): Promise<StepOutput> {
  const renderedPrompt = renderTemplate(step.prompt, ctx);
  const model = await resolveModelTier(step.model, ctx.tenantId);

  let schema: Record<string, unknown> | null = null;
  if (step.schema) {
    const schemaPath = path.join(ctx.pipelineDir, step.schema);
    schema = await loadSchemaFile(schemaPath);
  }

  const maxAttempts = step.retry + 1;
  let lastError: string | undefined;

  for (let i = 0; i < maxAttempts; i++) {
    const rawResponse = await deps.callProvider({
      prompt: renderedPrompt,
      model,
      tenantId: ctx.tenantId,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawResponse);
    } catch {
      lastError = `LLM response is not valid JSON: ${rawResponse.slice(0, 200)}`;
      continue;
    }

    if (schema) {
      const vr = validateAgainstSchema(parsed, schema);
      if (!vr.valid) {
        lastError = `schema validation failed: ${vr.errors.join("; ")}`;
        continue;
      }
    }

    return { output: parsed };
  }

  throw new Error(`LLM step "${step.name}" retry budget exhausted. Last error: ${lastError}`);
}
