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
  logWarn(`pipeline-runner: LLM request → ${url} model=${model} prompt_length=${prompt.length}`);

  let res: Response;
  try {
    res = await fetch(url, {
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
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const cause = e instanceof Error && e.cause ? ` cause=${String(e.cause)}` : "";
    throw new Error(`LLM API fetch failed: url=${url} model=${model} error=${msg}${cause}`);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM API HTTP ${res.status}: url=${url} model=${model} body=${body.slice(0, 500)}`);
  }

  let json: { choices?: Array<{ message?: { content?: string } }> };
  try {
    json = (await res.json()) as typeof json;
  } catch (e) {
    throw new Error(`LLM API response is not JSON: url=${url} model=${model} error=${e instanceof Error ? e.message : String(e)}`);
  }

  const text = json.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error(`LLM API returned no content: url=${url} model=${model} response=${JSON.stringify(json).slice(0, 500)}`);
  }
  logWarn(`pipeline-runner: LLM response ← model=${model} content_length=${text.length}`);
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
