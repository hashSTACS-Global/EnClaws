import type { ModelDefinitionConfig } from "../config/types.models.js";

export const SILICONFLOW_GLOBAL_DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-V3";
export const SILICONFLOW_GLOBAL_BASE_URL = "https://api.siliconflow.com/v1";

export const SILICONFLOW_CN_DEFAULT_MODEL_ID = "deepseek-ai/DeepSeek-V3";
export const SILICONFLOW_CN_BASE_URL = "https://api.siliconflow.cn/v1";

const SILICONFLOW_DEFAULT_CONTEXT_WINDOW = 64000;
const SILICONFLOW_DEFAULT_MAX_TOKENS = 4096;

const SILICONFLOW_DEFAULT_COST = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
};

export const SILICONFLOW_MODEL_CATALOG: ModelDefinitionConfig[] = [
  {
    id: "deepseek-ai/DeepSeek-V3",
    name: "DeepSeek V3",
    reasoning: false,
    input: ["text"],
    cost: SILICONFLOW_DEFAULT_COST,
    contextWindow: 64000,
    maxTokens: SILICONFLOW_DEFAULT_MAX_TOKENS,
  },
  {
    id: "deepseek-ai/DeepSeek-R1",
    name: "DeepSeek R1",
    reasoning: true,
    input: ["text"],
    cost: SILICONFLOW_DEFAULT_COST,
    contextWindow: 64000,
    maxTokens: SILICONFLOW_DEFAULT_MAX_TOKENS,
  },
  {
    id: "deepseek-ai/DeepSeek-R1-Distill-Llama-70B",
    name: "DeepSeek R1 Distill Llama 70B",
    reasoning: true,
    input: ["text"],
    cost: SILICONFLOW_DEFAULT_COST,
    contextWindow: 64000,
    maxTokens: SILICONFLOW_DEFAULT_MAX_TOKENS,
  },
];

interface SiliconFlowModelEntry {
  id: string;
  sub_type?: string;
  [key: string]: unknown;
}

interface SiliconFlowListModelsResponse {
  data?: SiliconFlowModelEntry[];
}

export function buildSiliconFlowModelDefinition(params: {
  id: string;
  name?: string;
  reasoning?: boolean;
}): ModelDefinitionConfig {
  const lower = params.id.toLowerCase();
  const reasoning =
    params.reasoning ??
    (lower.includes("/r1") || lower.includes("reasoning") || lower.includes("think"));

  return {
    id: params.id,
    name: params.name ?? params.id.split("/").pop() ?? params.id,
    reasoning,
    input: ["text"], // SiliconFlow is primarily text-based in their chat completions API
    cost: SILICONFLOW_DEFAULT_COST,
    contextWindow: SILICONFLOW_DEFAULT_CONTEXT_WINDOW,
    maxTokens: SILICONFLOW_DEFAULT_MAX_TOKENS,
  };
}

export async function discoverSiliconFlowModels(params: {
  baseUrl: string;
  apiKey: string;
}): Promise<ModelDefinitionConfig[]> {
  if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") {
    return SILICONFLOW_MODEL_CATALOG.map((m) => buildSiliconFlowModelDefinition(m));
  }

  const trimmedKey = params.apiKey?.trim();
  if (!trimmedKey) {
    return SILICONFLOW_MODEL_CATALOG.map((m) => buildSiliconFlowModelDefinition(m));
  }

  try {
    const response = await fetch(`${params.baseUrl}/models`, {
      signal: AbortSignal.timeout(10_000),
      headers: {
        Authorization: `Bearer ${trimmedKey}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      console.warn(
        `[siliconflow-models] GET /models failed: HTTP ${response.status}, using static catalog`,
      );
      return SILICONFLOW_MODEL_CATALOG.map((m) => buildSiliconFlowModelDefinition(m));
    }

    const body = (await response.json()) as SiliconFlowListModelsResponse;
    const data = body?.data;
    if (!Array.isArray(data) || data.length === 0) {
      console.warn("[siliconflow-models] No models in response, using static catalog");
      return SILICONFLOW_MODEL_CATALOG.map((m) => buildSiliconFlowModelDefinition(m));
    }

    const models: ModelDefinitionConfig[] = [];
    const seen = new Set<string>();

    for (const entry of data) {
      const id = typeof entry?.id === "string" ? entry.id.trim() : "";
      if (!id || seen.has(id)) {
        continue;
      }
      // SiliconFlow includes embeddings and other types in their /models list.
      // We only want chat models. They usually have sub_type: "chat".
      if (entry.sub_type && entry.sub_type !== "chat") {
        continue;
      }

      seen.add(id);
      models.push(buildSiliconFlowModelDefinition({ id }));
    }

    return models.length > 0
      ? models
      : SILICONFLOW_MODEL_CATALOG.map((m) => buildSiliconFlowModelDefinition(m));
  } catch (error) {
    console.warn(`[siliconflow-models] Discovery failed: ${String(error)}, using static catalog`);
    return SILICONFLOW_MODEL_CATALOG.map((m) => buildSiliconFlowModelDefinition(m));
  }
}
