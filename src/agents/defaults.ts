// Defaults for agent metadata when upstream does not supply them.
// Model id uses DeepSeek Web as the default fallback.
export const DEFAULT_PROVIDER = "deepseek-web";
export const DEFAULT_MODEL = "deepseek-chat";
// Conservative fallback used when model metadata is unavailable.
export const DEFAULT_CONTEXT_TOKENS = 200_000;
