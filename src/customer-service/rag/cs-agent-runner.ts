/**
 * Customer Service Agent runner — wraps runEmbeddedPiAgent() with CS-specific logic.
 *
 * 客服 Agent 运行器 — 包装 runEmbeddedPiAgent()，添加客服特定逻辑。
 *
 * Call chain: runWithModelFallback() → runEmbeddedPiAgent()
 *
 * System prompt strategy:
 *   promptMode: "none" — skip the 800+ line EC agent prompt, use only the CS prompt.
 *   Final LLM prompt = identity line + CS base prompt + restriction add-ons + KB chunks.
 *   システムプロンプト戦略: promptMode:"none" で EC フルプロンプトを排除し CS 専用プロンプトのみ使用。
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveDefaultAgentId,
  resolveAgentEffectiveModelPrimary,
} from "../../agents/agent-scope.js";
import {
  resolveTenantDir,
  resolveTenantAgentDir,
} from "../../config/sessions/tenant-paths.js";
import { DEFAULT_PROVIDER, DEFAULT_MODEL } from "../../agents/defaults.js";
import { parseModelRef } from "../../agents/model-selection.js";
import { runEmbeddedPiAgent } from "../../agents/pi-embedded.js";
import { runWithModelFallback } from "../../agents/model-fallback.js";
import type { OpenClawConfig } from "../../config/config.js";
import { getMemorySearchManager } from "../../memory/search-manager.js";
import type { MemorySearchResult } from "../../memory/types.js";
import { getTenantById } from "../../db/models/tenant.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";
import {
  buildCSSystemPrompt,
  DEFAULT_CS_BASE_PROMPT,
  renderCSBasePrompt,
  type CSRestrictions,
} from "./cs-system-prompt.js";
import {
  computeConfidence,
  presetsToThresholds,
  DEFAULT_THRESHOLDS,
  type ConfidenceResult,
} from "../confidence.js";
import { buildFallbackReply } from "./cs-fallback-reply.js";

const log = createSubsystemLogger("cs-agent-runner");

const CS_AGENT_TIMEOUT_MS = 30_000;
const CS_KNOWLEDGE_MAX_RESULTS = 5;
const CS_KNOWLEDGE_MIN_SCORE = 0.1;

/** Short / vague customer messages trigger the ambiguous clarify path. 短问题触发澄清追问。 */
const AMBIGUOUS_MESSAGE_MAX_CHARS = 12;

/** Keywords that mark sensitive topics (pricing / commitments). 涉敏关键词。 */
const SENSITIVE_KEYWORDS = ["价格", "收费", "多少钱", "报价", "保证", "承诺", "合同", "赔偿"];

export interface CSAgentReplyResult {
  reply: string;
  sourceChunks: MemorySearchResult[];
  /** Confidence verdict + score. null when retrieval was empty (no signal to score). */
  confidence: ConfidenceResult | null;
  /** Clarification option buttons (knowledge_gap + ambiguous path). */
  clarifyOptions?: string[];
  /** True when reply is a canned fallback (no LLM call). Used by handler for routing/metrics. */
  isFallback?: boolean;
}

/**
 * Derive confidence inputs from retrieval output.
 * Pure heuristic, no LLM — "考生不给自己改卷".
 *
 * 从检索结果推导三维度置信度输入，纯启发式规则。
 *   - accuracy:    top-1 chunk score（余弦相似度或归一化 BM25）
 *   - coverage:    问题关键词在返回片段中的命中率
 *   - completeness: 返回片段数 / 期望片段数 的比例（粗略代理）
 */
function deriveConfidenceInputs(
  query: string,
  chunks: MemorySearchResult[],
): { retrievalAccuracy: number; retrievalCoverage: number; completeness: number } | null {
  if (chunks.length === 0) return null;

  const retrievalAccuracy = Math.max(0, Math.min(1, chunks[0]?.score ?? 0));

  // Tokenize query into 2-char CJK bigrams + ASCII words. 简单分词：中文二元 + 英文单词。
  const tokens = new Set<string>();
  const ascii = query.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  ascii.forEach((w) => w.length >= 2 && tokens.add(w));
  const cjk = query.replace(/[^\u4e00-\u9fa5]/g, "");
  for (let i = 0; i + 2 <= cjk.length; i++) tokens.add(cjk.slice(i, i + 2));

  const joined = chunks.map((c) => (c.snippet ?? "").toLowerCase()).join(" ");
  let hits = 0;
  tokens.forEach((t) => {
    if (joined.includes(t)) hits++;
  });
  const retrievalCoverage = tokens.size > 0 ? hits / tokens.size : 0;

  // Completeness proxy: how saturated is the top-K result set (more = better coverage of angles).
  const completeness = Math.min(1, chunks.length / CS_KNOWLEDGE_MAX_RESULTS);

  return { retrievalAccuracy, retrievalCoverage, completeness };
}

function detectSensitive(message: string): boolean {
  const lower = message.toLowerCase();
  return SENSITIVE_KEYWORDS.some((kw) => lower.includes(kw.toLowerCase()));
}

function buildClarifyHints(chunks: MemorySearchResult[]): string[] {
  // Use top chunks' filenames as clarify hints. Fallback: static options.
  // 用返回片段文件名作为澄清提示（如 "定价"、"功能"）。
  const hints = chunks
    .slice(0, 3)
    .map((c) => {
      const base = c.path?.split("/").pop()?.replace(/\.md$/i, "") ?? "";
      return base.replace(/[-_]/g, " ").trim();
    })
    .filter((h) => h.length > 0 && h.length <= 20);
  if (hints.length > 0) return hints;
  return ["产品功能", "使用方式", "其他问题"];
}

/**
 * Run the CS agent: search knowledge base → build prompt → call LLM → return reply.
 *
 * 运行客服 Agent：检索知识库 → 构建 prompt → 调用 LLM → 返回回复。
 */
export async function runCSAgentReply(params: {
  tenantId: string;
  sessionId: string;
  customerMessage: string;
  visitorName?: string;
  cfg: OpenClawConfig;
  workspaceDir?: string;
  /**
   * Custom base prompt (already stored with actual company name, or using {companyName} placeholder).
   * Falls back to DEFAULT_CS_BASE_PROMPT when not provided.
   * 自定义基础 prompt（已含实际企业名或使用占位符）；未提供时使用默认模板。
   */
  customSystemPrompt?: string;
  /**
   * Behavior restrictions. All default to true (restricted / safe mode).
   * Passed through from CSConfig.restrictions.
   * 行为限制项，全部默认 true（受限/安全模式）。
   */
  restrictions?: CSRestrictions;
  /**
   * Streaming callback: fired for each partial reply chunk from the LLM.
   * Used by the gateway handler to push real-time updates to the client.
   * 流式回调：LLM 每次输出片段时触发，供 handler 实时推送给客户端。
   */
  onPartialReply?: (payload: { text?: string }) => void;
  /**
   * Confidence gate sensitivity. Maps to ConfidenceThresholds.
   * When verdict < ok → short-circuit to canned fallback reply (skip LLM).
   * 置信度门控预设：低于 ok 阈值时直接返回兜底话术，不调 LLM（"考生不给自己改卷"）。
   */
  confidencePreset?: "strict" | "balanced" | "lenient";
}): Promise<CSAgentReplyResult> {
  const { tenantId, sessionId, customerMessage, visitorName, cfg } = params;
  // disableSkills defaults to true (restricted mode). Code-level enforcement.
  // disableSkills 默认 true（受限模式），代码层强制，不依赖 LLM 遵从。
  const disableTools = params.restrictions?.disableSkills ?? true;

  const agentId = resolveDefaultAgentId(cfg);
  // CS knowledge base is a shared tenant-level resource — NOT user-scoped workspace.
  // Path: ~/.enclaws/tenants/{tenantId}/customer-service/
  // getMemorySearchManager will look for memory/**/*.md under this dir.
  // 客服知识库是租户共享资源，走租户独立路径，不挂载在任何用户 workspace 下。
  const csWorkspaceDir = params.workspaceDir ?? path.join(resolveTenantDir(tenantId), "customer-service");
  const agentDir = resolveTenantAgentDir(tenantId, agentId);

  // Resolve company name from tenant record for {companyName} substitution.
  // 从租户记录获取企业名，用于替换基础 prompt 中的 {companyName} 占位符。
  let companyName = "EC";
  try {
    const tenant = await getTenantById(tenantId);
    if (tenant?.name) companyName = tenant.name;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`failed to resolve tenant name for ${tenantId}: ${message}`);
  }

  // Build base prompt: use custom if provided, else default template.
  // 构建基础 prompt：优先使用自定义，否则用默认模板，替换企业名占位符。
  const basePrompt = renderCSBasePrompt(
    params.customSystemPrompt || DEFAULT_CS_BASE_PROMPT,
    companyName,
  );

  // Step 1: Search knowledge base
  // 步骤 1：检索知识库
  let sourceChunks: MemorySearchResult[] = [];
  try {
    const { manager } = await getMemorySearchManager({ cfg, agentId, workspaceDir: csWorkspaceDir });
    if (manager) {
      sourceChunks = await manager.search(customerMessage, {
        maxResults: CS_KNOWLEDGE_MAX_RESULTS,
        minScore: CS_KNOWLEDGE_MIN_SCORE,
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(`knowledge search failed: ${message}`);
  }

  // Step 1.5: Confidence gate — decide whether to invoke LLM or return a canned fallback.
  // Gate runs on retrieval output, BEFORE calling the LLM. Pure-rule, no self-grading by AI.
  //
  // 步骤 1.5：置信度门控——在调用 LLM 前根据检索结果判定。纯规则，不让 LLM 给自己打分。
  //   verdict === "ok"              → 正常调 LLM 生成回答
  //   verdict === "knowledge_gap"   → 短问题走澄清追问，否则走范围外兜底
  //   verdict === "suspect_badcase" → 高度不确定，直接兜底转人工
  const thresholds = params.confidencePreset
    ? presetsToThresholds(params.confidencePreset)
    : DEFAULT_THRESHOLDS;
  const confInputs = deriveConfidenceInputs(customerMessage, sourceChunks);
  const confidence: ConfidenceResult | null = confInputs
    ? computeConfidence(confInputs, thresholds)
    : // No chunks returned → treat as suspect_badcase (zero signal).
      // 检索零结果 → 视为高度不确定，直接兜底。
      computeConfidence({ retrievalAccuracy: 0, retrievalCoverage: 0, completeness: 0 }, thresholds);

  if (confidence.verdict !== "ok") {
    const isAmbiguous =
      confidence.verdict === "knowledge_gap" &&
      customerMessage.length <= AMBIGUOUS_MESSAGE_MAX_CHARS;
    const sensitive = detectSensitive(customerMessage);
    const fallback = buildFallbackReply(confidence.verdict, {
      ambiguous: isAmbiguous,
      clarifyHints: isAmbiguous ? buildClarifyHints(sourceChunks) : undefined,
      sensitive,
    });
    log.info(
      `cs confidence gate [${confidence.verdict}] score=${confidence.score.toFixed(2)} — returning fallback, skipping LLM`,
    );
    return {
      reply: fallback.text,
      sourceChunks,
      confidence,
      clarifyOptions: fallback.clarifyOptions,
      isFallback: true,
    };
  }

  // Step 2: Build CS system prompt with knowledge
  // 步骤 2：用知识片段构建客服系统提示词
  const extraSystemPrompt = buildCSSystemPrompt({
    basePrompt,
    knowledgeChunks: sourceChunks,
    visitorName,
    restrictions: params.restrictions,
  });

  // Step 3: Create temporary session file
  // 步骤 3：创建临时会话文件
  let tempSessionFile: string | null = null;
  try {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "enclaws-cs-"));
    tempSessionFile = path.join(tempDir, "session.jsonl");

    // Step 4: Resolve model config
    // 步骤 4：解析模型配置
    const modelRef = resolveAgentEffectiveModelPrimary(cfg, agentId);
    const parsed = modelRef ? parseModelRef(modelRef, DEFAULT_PROVIDER) : null;
    const defaultProvider = parsed?.provider ?? DEFAULT_PROVIDER;
    const defaultModel = parsed?.model ?? DEFAULT_MODEL;

    // Step 5: Call LLM with model fallback
    // promptMode: "none" — skip the 800+ line EC agent prompt entirely.
    // The full system prompt is: "You are a personal assistant running inside EnClaws." + extraSystemPrompt.
    // 步骤 5：调用 LLM（带 model fallback）
    // promptMode:"none" 跳过 EC agent 主 prompt，只用 CS 专用 prompt，大幅减少 token 消耗。
    const fallbackResult = await runWithModelFallback({
      cfg,
      provider: defaultProvider,
      model: defaultModel,
      agentDir,
      run: (providerOverride, modelOverride) =>
        runEmbeddedPiAgent({
          sessionId: `cs-${sessionId}-${Date.now()}`,
          sessionKey: `cs:${sessionId}`,
          agentId,
          sessionFile: tempSessionFile!,
          workspaceDir: csWorkspaceDir,
          agentDir,
          config: cfg,
          prompt: customerMessage,
          provider: providerOverride,
          model: modelOverride,
          timeoutMs: CS_AGENT_TIMEOUT_MS,
          runId: `cs-run-${Date.now()}`,
          extraSystemPrompt,
          promptMode: "none",
          disableTools,
          disableMessageTool: true,
          tenantId,
          onPartialReply: params.onPartialReply,
        }),
    });

    // Step 6: Extract reply text
    // 步骤 6：提取回复文本
    const result = fallbackResult.result;
    const rawReply = result.payloads?.[0]?.text?.trim();

    if (!rawReply) {
      log.warn(`cs agent returned empty reply for session ${sessionId}`);
      return {
        reply: "抱歉，我暂时无法回答这个问题。我会通知负责人为您跟进。",
        sourceChunks,
        confidence,
        isFallback: true,
      };
    }

    // Strip the model-injected "Skills Reporting" trailer (from origin/main fix).
    // Even with promptMode:"none" excluding the Skills Reporting instruction,
    // some models (e.g. qwen) carry this pattern as training prior and emit
    // a trailing `> Skills used: ...` line that's irrelevant for CS customers.
    // 剥掉模型脑补的 Skills Reporting 末尾行——CS 场景下客户看到 meta 信息很突兀。
    const replyText = rawReply
      .replace(/\s*\n+\s*>\s*Skills\s*used\s*:[^\n]*$/i, "")
      .replace(/\s*>\s*Skills\s*used\s*:[^\n]*$/i, "")
      .trimEnd();

    return { reply: replyText, sourceChunks, confidence };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error(`cs agent failed for session ${sessionId}: ${message}`);
    return {
      reply: "抱歉，系统暂时遇到了问题。我会通知负责人为您跟进，请稍等。",
      sourceChunks,
      confidence,
      isFallback: true,
    };
  } finally {
    // Clean up temporary session file
    // 清理临时会话文件
    if (tempSessionFile) {
      try {
        await fs.rm(path.dirname(tempSessionFile), { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
        // 忽略清理错误
      }
    }
  }
}
