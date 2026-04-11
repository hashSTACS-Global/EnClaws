import { z } from "zod";

export const ModelTierSchema = z.enum(["lite", "standard", "reasoning"]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const CodeStepSchema = z.object({
  name: z.string().min(1),
  type: z.literal("code"),
  command: z.string().min(1),
  skip_if: z.string().optional(),
});
export type CodeStep = z.infer<typeof CodeStepSchema>;

export const LLMStepSchema = z.object({
  name: z.string().min(1),
  type: z.literal("llm"),
  model: ModelTierSchema.default("standard"),
  prompt: z.string().min(1),
  schema: z.string().optional(), // 相对 pipeline 目录的 JSON Schema 文件路径
  validate: z.string().optional(), // 相对 pipeline 目录的验证脚本路径
  retry: z.number().int().min(0).default(2),
  skip_if: z.string().optional(),
});
export type LLMStep = z.infer<typeof LLMStepSchema>;

export const StepSchema = z.discriminatedUnion("type", [CodeStepSchema, LLMStepSchema]);
export type Step = z.infer<typeof StepSchema>;

export const PipelineDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  triggers: z.array(z.string()).default([]),
  input: z.record(z.string(), z.string()).default({}),
  steps: z.array(StepSchema).min(1),
  output: z.string().min(1),
});
export type PipelineDefinition = z.infer<typeof PipelineDefinitionSchema>;

export function parsePipelineDefinition(raw: unknown): PipelineDefinition {
  return PipelineDefinitionSchema.parse(raw);
}

/** 单个步骤执行后的输出 */
export interface StepOutput {
  output: unknown;
  error?: string;
}

/** Pipeline 执行的完整结果 */
export interface RunnerResult {
  status: "completed" | "error";
  output?: unknown;
  error?: string;
  progress: string[]; // ["prepare ✓", "gen ✓", ...]
}

/** 贯穿整个 pipeline 的执行上下文 */
export interface ExecutionContext {
  input: Record<string, unknown>;
  steps: Record<string, StepOutput>;
  pipelineDir: string;
  workspaceDir: string;
  appName: string;
  tenantId: string;
}
