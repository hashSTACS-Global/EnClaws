/**
 * Customer Service module — barrel exports.
 *
 * 客服模块统一导出。
 */

// Types
export type {
  CSSession,
  CSMessage,
  CSSessionState,
  CSMessageRole,
  CSEvent,
  CSAction,
  CSTransitionResult,
} from "./types.js";
export { CS_ROLE_LABELS } from "./types.js";

// Confidence (moved from types.ts — canonical location)
export type {
  ConfidenceInput,
  ConfidenceResult,
  ConfidenceVerdict,
  ConfidenceThresholds,
} from "./confidence.js";
export { DEFAULT_THRESHOLDS, computeConfidence, describeConfidence, presetsToThresholds } from "./confidence.js";

// State machine
export { transition } from "./session-state-machine.js";

// RAG agent
export { runCSAgentReply } from "./rag/cs-agent-runner.js";
export type { CSAgentReplyResult } from "./rag/cs-agent-runner.js";
export { buildCSSystemPrompt } from "./rag/cs-system-prompt.js";

// Widget
export { parseClientMessage, serializeServerMessage } from "./widget/widget-protocol.js";
export type { CSWidgetClientMessage, CSWidgetServerMessage } from "./widget/widget-protocol.js";
export { generateVisitorId, generateVisitorToken, verifyVisitorToken } from "./widget/widget-auth.js";
// widget-gateway.ts is superseded by src/gateway/server-methods/cs-widget.ts (gateway RPC handlers).
// Keeping for reference; registerConnection / handleWidgetMessage are not actively used.
// widget-gateway.ts 已被 gateway server-methods 中的 cs-widget.ts 取代，此处仅保留文件，不导出。

// Feishu notification
export { sendCSNotification } from "./feishu/notify.js";
