/**
 * Shared model provider definitions.
 *
 * Used by onboarding wizard and tenant-models management page.
 */

export interface ProviderDef {
  value: string;
  label: string;
  defaultBaseUrl: string;
  defaultProtocol: string;
  placeholder?: string;
}

export const PROVIDER_TYPES: readonly ProviderDef[] = [
  { value: "openai", label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", defaultProtocol: "openai-completions", placeholder: "sk-..." },
  { value: "anthropic", label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com", defaultProtocol: "anthropic-messages", placeholder: "sk-ant-..." },
  { value: "deepseek", label: "DeepSeek", defaultBaseUrl: "https://api.deepseek.com/v1", defaultProtocol: "openai-completions", placeholder: "sk-..." },
  { value: "qwen", label: "Qwen (通义千问)", defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", defaultProtocol: "openai-completions", placeholder: "sk-..." },
  { value: "zhipu", label: "ZAI (智谱)", defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4", defaultProtocol: "openai-completions", placeholder: "..." },
  { value: "moonshot", label: "Moonshot (月之暗面)", defaultBaseUrl: "https://api.moonshot.ai/v1", defaultProtocol: "openai-completions", placeholder: "sk-..." },
  { value: "minimax", label: "MiniMax", defaultBaseUrl: "https://api.minimax.chat/v1", defaultProtocol: "openai-completions", placeholder: "..." },
  { value: "siliconflow", label: "SiliconFlow (硅基流动)", defaultBaseUrl: "https://api.siliconflow.cn/v1", defaultProtocol: "openai-completions", placeholder: "sk-..." },
  { value: "google", label: "Google Gemini", defaultBaseUrl: "", defaultProtocol: "google-generative-ai", placeholder: "..." },
  { value: "bedrock", label: "AWS Bedrock", defaultBaseUrl: "", defaultProtocol: "bedrock-converse-stream", placeholder: "..." },
  { value: "ollama", label: "Ollama", defaultBaseUrl: "http://localhost:11434", defaultProtocol: "ollama", placeholder: "..." },
  { value: "openrouter", label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", defaultProtocol: "openai-completions", placeholder: "sk-or-..." },
  { value: "custom", label: "Custom", defaultBaseUrl: "", defaultProtocol: "openai-completions", placeholder: "..." },
] as const;

export const API_PROTOCOLS = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "ollama", label: "Ollama" },
] as const;

// ─── Tier-based model routing (v4) ─────────────────────────────────────────

export const MODEL_TIERS = ["lite", "standard", "pro"] as const;
export type ModelTierValue = (typeof MODEL_TIERS)[number];

export const TIER_LABELS: Record<ModelTierValue, string> = {
  pro: "PRO 专家",
  standard: "STANDARD 标准",
  lite: "LITE 快速",
};

// Which providers are surfaced for each tier in the add-model dropdown.
// Providers not listed here for a given tier are hidden from the cascading
// form; admins can still pick "custom" to use any endpoint.
export const PROVIDERS_BY_TIER: Record<ModelTierValue, readonly string[]> = {
  pro: ["anthropic", "openai", "qwen", "deepseek", "zhipu", "custom"],
  standard: ["anthropic", "openai", "qwen", "deepseek", "zhipu", "custom"],
  lite: ["anthropic", "openai", "qwen", "zhipu", "custom"],
} as const;

// Recommended modelId for each (provider, tier) combination. Empty string means
// the provider does not publish a canonical model for that tier (e.g. DeepSeek
// has no lite model) — the form leaves modelId blank for the admin to fill.
export const MODEL_SUGGESTIONS: Record<string, Record<ModelTierValue, string>> = {
  anthropic: { lite: "claude-haiku-4-5", standard: "claude-sonnet-4-6", pro: "claude-opus-4-7" },
  openai: { lite: "gpt-4o-mini", standard: "gpt-5", pro: "gpt-5-high" },
  qwen: { lite: "qwen-turbo", standard: "qwen-plus", pro: "qwen-max" },
  deepseek: { lite: "", standard: "deepseek-v3", pro: "deepseek-r1" },
  zhipu: { lite: "glm-4-flash", standard: "glm-4", pro: "glm-5" },
  custom: { lite: "", standard: "", pro: "" },
};
