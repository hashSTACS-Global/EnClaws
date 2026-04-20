/**
 * Confidence gate for the CS RAG pipeline.
 * Pure rule-based scoring — no LLM involvement.
 * The AI must not judge its own answer quality.
 *
 * 客服 RAG 置信度门控，纯规则评分，不依赖 LLM。
 * AI 不参与"自己对不对"的判断——考生不给自己改卷。
 */

/** Raw inputs from the retrieval step. 检索结果原始输入。 */
export interface ConfidenceInput {
  /** Fraction of query terms found in top-K results (0–1). 查询词在 top-K 中的命中率。 */
  retrievalCoverage: number;
  /** Cosine similarity of top-1 result (0–1). top-1 余弦相似度。 */
  retrievalAccuracy: number;
  /** Fraction of query intent points covered by retrieved chunks (0–1). 检索结果对查询要点的覆盖率。 */
  completeness: number;
}

/** Three-tier verdict. 三档判定结果。 */
export type ConfidenceVerdict = "ok" | "knowledge_gap" | "suspect_badcase";

export interface ConfidenceResult {
  score: number;
  verdict: ConfidenceVerdict;
  /** Which dimension(s) pulled the score down. 拖低评分的维度，用于置信度解释。 */
  weakDimensions: Array<"coverage" | "accuracy" | "completeness">;
}

/** Per-tenant configurable thresholds. 租户可覆盖的阈值。 */
export interface ConfidenceThresholds {
  /** Score ≥ okThreshold → "ok". Default 0.6. */
  okThreshold: number;
  /** Score ≥ gapThreshold → "knowledge_gap". Default 0.3. */
  gapThreshold: number;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  okThreshold: 0.6,
  gapThreshold: 0.3,
};

/**
 * Map a named preset to concrete threshold values.
 * strict  → tighter filter, more fallbacks (fewer AI answers pass through)
 * balanced → default
 * lenient → more permissive (more AI answers pass through)
 *
 * 将命名预设映射为具体阈值。
 */
export function presetsToThresholds(preset: "strict" | "balanced" | "lenient"): ConfidenceThresholds {
  switch (preset) {
    case "strict":  return { okThreshold: 0.7, gapThreshold: 0.4 };
    case "lenient": return { okThreshold: 0.5, gapThreshold: 0.2 };
    default:        return DEFAULT_THRESHOLDS; // balanced
  }
}

/**
 * Compute a confidence score and verdict for a RAG reply candidate.
 * Formula: coverage×0.4 + accuracy×0.4 + completeness×0.2
 *
 * 计算 RAG 回复的置信度分数和判定结果。
 * 公式：覆盖率×0.4 + 准确率×0.4 + 完整性×0.2
 */
export function computeConfidence(
  input: ConfidenceInput,
  thresholds: ConfidenceThresholds = DEFAULT_THRESHOLDS,
): ConfidenceResult {
  const score =
    input.retrievalCoverage * 0.4 +
    input.retrievalAccuracy * 0.4 +
    input.completeness * 0.2;

  const weakDimensions: ConfidenceResult["weakDimensions"] = [];
  if (input.retrievalCoverage < 0.5) weakDimensions.push("coverage");
  if (input.retrievalAccuracy < 0.5) weakDimensions.push("accuracy");
  if (input.completeness < 0.5) weakDimensions.push("completeness");

  let verdict: ConfidenceVerdict;
  if (score >= thresholds.okThreshold) {
    verdict = "ok";
  } else if (score >= thresholds.gapThreshold) {
    verdict = "knowledge_gap";
  } else {
    verdict = "suspect_badcase";
  }

  return { score, verdict, weakDimensions };
}

/**
 * Human-readable explanation for the confidence result (for Feishu notifications).
 * 置信度解释文本，用于飞书升级通知。
 */
export function describeConfidence(result: ConfidenceResult): string {
  if (result.verdict === "ok") return "AI 回答置信度正常";

  const dimLabels: Record<string, string> = {
    coverage: "知识库覆盖不足",
    accuracy: "检索相关性低",
    completeness: "信息不完整",
  };
  const reasons = result.weakDimensions.map((d) => dimLabels[d]).join("、");
  const prefix =
    result.verdict === "knowledge_gap"
      ? "知识盲区（置信度偏低）"
      : "可疑错误（置信度很低）";
  return reasons ? `${prefix}：${reasons}` : prefix;
}
