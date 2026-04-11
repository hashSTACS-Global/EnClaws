import type { LLMCallInput, LLMStepDeps } from "./llm-step.js";

/**
 * Placeholder shape for an EC provider call. Phase 1 treats this as a skeleton:
 *
 * **Integration notes**: the real wire-up needs to:
 * 1. Find the actual LLM call entry point in EC (likely under `src/providers/`
 *    or `src/infra/provider-usage.*.ts`).
 * 2. Adjust `EcProviderCall` to match the real signature.
 * 3. If EC has no single-shot call API, wrap one.
 *
 * The unit test locks in the expected behavior: translate an `LLMCallInput`
 * into an EC provider call and return a raw string response.
 */
export type EcProviderCall = (input: {
  model: string;
  prompt: string;
  tenantId: string;
}) => Promise<{ text: string }>;

export interface ProviderAdapterConfig {
  ecProvider: EcProviderCall;
}

export function createProviderCallFn(cfg: ProviderAdapterConfig): LLMStepDeps["callProvider"] {
  return async function callProvider(input: LLMCallInput): Promise<string> {
    const result = await cfg.ecProvider({
      model: input.model,
      prompt: input.prompt,
      tenantId: input.tenantId,
    });
    return result.text;
  };
}
