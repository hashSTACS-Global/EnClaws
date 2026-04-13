import { listTenantModels } from "../../db/models/tenant-model.js";
import type { TenantModel } from "../../db/types.js";
import { logWarn } from "../../logger.js";
import type { LLMCallInput, LLMStepDeps } from "./llm-step.js";

/**
 * Find the tenant model provider that hosts the requested model ID.
 * Searches all active providers' `models` arrays for a match.
 */
async function findProviderForModel(
  tenantId: string,
  modelId: string,
): Promise<TenantModel | null> {
  const providers = await listTenantModels(tenantId, { activeOnly: true });
  for (const p of providers) {
    if (p.models.some((m) => m.id === modelId)) {
      return p;
    }
  }
  return null;
}

/**
 * Call an OpenAI-compatible chat completion endpoint.
 * Most providers (Qwen, DeepSeek, Anthropic via proxy, etc.) support this format.
 */
async function callOpenAiCompatible(
  baseUrl: string,
  apiKey: string,
  model: string,
  prompt: string,
  extraHeaders: Record<string, string> = {},
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a helpful assistant. You MUST respond with valid JSON only. No markdown, no explanations outside JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API error ${res.status}: ${body.slice(0, 500)}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`LLM API returned no content: ${JSON.stringify(json).slice(0, 500)}`);
  }
  return text;
}

/**
 * Create the real EC provider call function.
 * Resolves tenant model config from DB, then calls the provider API.
 */
export function createEcProviderCall(): LLMStepDeps["callProvider"] {
  return async function callProvider(input: LLMCallInput): Promise<string> {
    const provider = await findProviderForModel(input.tenantId, input.model);
    if (!provider) {
      throw new Error(
        `No active provider found for model "${input.model}" in tenant "${input.tenantId}". ` +
          `Configure a model provider with this model in the admin panel.`,
      );
    }
    if (!provider.baseUrl) {
      throw new Error(
        `Provider "${provider.providerName}" has no baseUrl configured.`,
      );
    }
    if (!provider.apiKeyEncrypted) {
      throw new Error(
        `Provider "${provider.providerName}" has no API key configured.`,
      );
    }

    logWarn(
      `pipeline-runner: calling LLM provider="${provider.providerName}" model="${input.model}" baseUrl="${provider.baseUrl}"`,
    );

    return callOpenAiCompatible(
      provider.baseUrl,
      provider.apiKeyEncrypted,
      input.model,
      input.prompt,
      provider.extraHeaders,
    );
  };
}
