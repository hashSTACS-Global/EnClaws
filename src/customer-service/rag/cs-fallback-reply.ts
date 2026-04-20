/**
 * Fallback reply generator for CS RAG pipeline.
 * Returns canned responses when confidence is below threshold.
 * Decoupled from the agent runner so it can be tested independently.
 *
 * 客服 RAG 兜底话术生成器。置信度低时返回预设回复，与 agent runner 解耦便于独立测试。
 */

import type { ConfidenceVerdict } from "../confidence.js";

export interface FallbackReply {
  text: string;
  /**
   * For "ambiguous" cases: optional clarification options shown as buttons in the widget.
   * 模糊场景可选的澄清选项，Widget 渲染为按钮（追问权）。
   */
  clarifyOptions?: string[];
}

/**
 * Generate a fallback reply based on the confidence verdict.
 *
 * Three postures (产品文档 S2 §三种"我不知道"的姿势):
 *   - knowledge_gap + ambiguous hint → clarify with options (追问权)
 *   - knowledge_gap → out-of-scope apology + escalation notice
 *   - suspect_badcase → sensitive/incomplete apology + escalation notice
 *
 * 三种兜底姿势：模糊追问 / 范围外 / 涉敏感或信息不完整。
 */
export function buildFallbackReply(
  verdict: ConfidenceVerdict,
  opts: {
    /** Whether the question seems ambiguous (triggers clarify posture). 问题是否模糊。 */
    ambiguous?: boolean;
    /** Topic hints for clarification options (e.g. ["定价", "功能"]). 澄清选项提示词。 */
    clarifyHints?: string[];
    /** True when the question involves pricing, permissions, or commitments. 是否涉及金额/权限/承诺。 */
    sensitive?: boolean;
  } = {},
): FallbackReply {
  const { ambiguous, clarifyHints, sensitive } = opts;

  // Posture 1: ambiguous knowledge_gap → one clarification attempt
  // 姿势1：模糊的知识盲区 → 一次追问权
  if (verdict === "knowledge_gap" && ambiguous && clarifyHints && clarifyHints.length > 0) {
    const options = clarifyHints.slice(0, 3); // max 3 options / 最多3个选项
    return {
      text: "我没有完全理解您的问题，您是想了解：",
      clarifyOptions: options,
    };
  }

  // Posture 2: sensitive topic — refer to human
  // 姿势2：涉及金额/权限 → 人工确认
  if (sensitive) {
    return {
      text: "根据我了解到的信息，建议您直接联系我们的负责人以获取最准确的答案，我已通知他们，请稍等。",
    };
  }

  // Posture 3: knowledge_gap (out of scope)
  // 姿势3：超出知识库范围
  if (verdict === "knowledge_gap") {
    return {
      text: "这个问题超出了我目前掌握的知识范围，我已通知负责人，请您稍等片刻，或者您可以提供更多信息，也许我能重新为您解答。",
    };
  }

  // Posture 3b: suspect_badcase — extra caution
  // 姿势3b：高度不确定 → 保守兜底
  return {
    text: "我对这个问题还不够了解，为了给您准确的答案，我已通知负责人跟进，请您稍等。",
  };
}
