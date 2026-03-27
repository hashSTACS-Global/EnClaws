/**
 * Shared types for the IM simulator test framework.
 */

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

export type SimulatorConnectionOptions = {
  /** Gateway WebSocket URL, e.g. "ws://127.0.0.1:18789" */
  url: string;
  /** Gateway shared token (for initial connection before JWT is available) */
  gatewayToken?: string;
};

// ---------------------------------------------------------------------------
// Admin — tenant registration / login
// ---------------------------------------------------------------------------

export type RegisterOptions = {
  tenantName: string;
  tenantSlug: string;
  email: string;
  password: string;
  displayName?: string;
};

export type RegisterResult = {
  tenant: { id: string; name: string; slug: string };
  user: { id: string; email: string; role: string; displayName?: string };
  accessToken: string;
  refreshToken: string;
};

export type LoginOptions = {
  email: string;
  password: string;
  tenantSlug?: string;
};

export type LoginResult = {
  user: { id: string; email: string; role: string; displayName?: string; tenantId: string };
  accessToken: string;
  refreshToken: string;
};

export type InviteUserOptions = {
  email: string;
  password: string;
  role?: "admin" | "member";
  displayName?: string;
};

export type InviteUserResult = {
  id: string;
  email: string;
  role: string;
  displayName?: string;
};

// ---------------------------------------------------------------------------
// Admin — model
// ---------------------------------------------------------------------------

export type ModelDefinition = {
  id: string;
  name: string;
  reasoning?: boolean;
  input?: string[];
  contextWindow?: number;
  maxTokens?: number;
};

export type CreateModelOptions = {
  providerType: string;
  providerName?: string;
  baseUrl?: string;
  apiKey?: string;
  apiProtocol?: string;
  authMode?: string;
  models: ModelDefinition[];
};

export type CreateModelResult = {
  id: string;
  providerType: string;
  providerName: string;
  models: ModelDefinition[];
};

// ---------------------------------------------------------------------------
// Admin — agent
// ---------------------------------------------------------------------------

export type ModelConfigEntry = {
  providerId: string;
  modelId: string;
  isDefault: boolean;
};

export type CreateAgentOptions = {
  agentId: string;
  name: string;
  systemPrompt?: string;
  modelConfig?: ModelConfigEntry[];
};

export type CreateAgentResult = {
  id: string;
  agentId: string;
  name: string;
};

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export type SendMessageOptions = {
  /** Target agent ID */
  agentId: string;
  /** Message text */
  message: string;
  /** Timeout in ms for waiting for the agent reply (default: 60_000) */
  timeoutMs?: number;
};

export type SendMessageResult = {
  /** Final reply text from the agent */
  text: string;
  /** Run ID (idempotency key) */
  runId: string;
  /** Duration in milliseconds */
  durationMs: number;
};

export type ChatEventPayload = {
  runId?: string;
  sessionKey?: string;
  state?: string;
  seq?: number;
  message?: {
    role?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
};
