import { describe, expect, it } from "vitest";
import {
  computeConfidence,
  describeConfidence,
  DEFAULT_THRESHOLDS,
  type ConfidenceInput,
} from "./confidence.js";

const full: ConfidenceInput = { retrievalCoverage: 1, retrievalAccuracy: 1, completeness: 1 };
const zero: ConfidenceInput = { retrievalCoverage: 0, retrievalAccuracy: 0, completeness: 0 };

describe("computeConfidence", () => {
  it("perfect input → ok, score 1.0", () => {
    const r = computeConfidence(full);
    expect(r.verdict).toBe("ok");
    expect(r.score).toBeCloseTo(1.0);
    expect(r.weakDimensions).toHaveLength(0);
  });

  it("zero input → suspect_badcase, score 0.0", () => {
    const r = computeConfidence(zero);
    expect(r.verdict).toBe("suspect_badcase");
    expect(r.score).toBeCloseTo(0.0);
    expect(r.weakDimensions).toContain("coverage");
    expect(r.weakDimensions).toContain("accuracy");
    expect(r.weakDimensions).toContain("completeness");
  });

  it("score at ok threshold boundary → ok", () => {
    // score = 0.6×0.4 + 0.6×0.4 + 0.6×0.2 = 0.6 (default okThreshold)
    const r = computeConfidence({ retrievalCoverage: 0.6, retrievalAccuracy: 0.6, completeness: 0.6 });
    expect(r.verdict).toBe("ok");
    expect(r.score).toBeCloseTo(0.6);
  });

  it("score just below ok threshold → knowledge_gap", () => {
    // coverage and accuracy together: 0.55×0.4 + 0.55×0.4 + 0.55×0.2 = 0.55
    const r = computeConfidence({ retrievalCoverage: 0.55, retrievalAccuracy: 0.55, completeness: 0.55 });
    expect(r.verdict).toBe("knowledge_gap");
  });

  it("score at gap threshold boundary → knowledge_gap", () => {
    // 0.3×0.4 + 0.3×0.4 + 0.3×0.2 = 0.3 (default gapThreshold)
    const r = computeConfidence({ retrievalCoverage: 0.3, retrievalAccuracy: 0.3, completeness: 0.3 });
    expect(r.verdict).toBe("knowledge_gap");
  });

  it("score just below gap threshold → suspect_badcase", () => {
    const r = computeConfidence({ retrievalCoverage: 0.2, retrievalAccuracy: 0.2, completeness: 0.2 });
    expect(r.verdict).toBe("suspect_badcase");
  });

  it("formula weights: accuracy dominates when coverage/completeness differ", () => {
    // coverage=0, accuracy=1, completeness=0 → score = 0.4
    const r = computeConfidence({ retrievalCoverage: 0, retrievalAccuracy: 1, completeness: 0 });
    expect(r.score).toBeCloseTo(0.4);
    expect(r.verdict).toBe("knowledge_gap");
  });

  it("custom thresholds are respected", () => {
    const r = computeConfidence(
      { retrievalCoverage: 0.5, retrievalAccuracy: 0.5, completeness: 0.5 },
      { okThreshold: 0.4, gapThreshold: 0.2 },
    );
    expect(r.verdict).toBe("ok");
  });

  it("weakDimensions only flags dims below 0.5", () => {
    const r = computeConfidence({ retrievalCoverage: 0.8, retrievalAccuracy: 0.3, completeness: 0.9 });
    expect(r.weakDimensions).toEqual(["accuracy"]);
  });
});

describe("describeConfidence", () => {
  it("ok verdict → short positive message", () => {
    const msg = describeConfidence(computeConfidence(full));
    expect(msg).toBe("AI 回答置信度正常");
  });

  it("knowledge_gap includes dimension reason", () => {
    // score = 0.4×0.4 + 0.4×0.4 + 0.4×0.2 = 0.4 → knowledge_gap
    const r = computeConfidence({ retrievalCoverage: 0.4, retrievalAccuracy: 0.4, completeness: 0.4 });
    expect(r.verdict).toBe("knowledge_gap");
    const msg = describeConfidence(r);
    expect(msg).toContain("知识盲区");
    expect(msg).toContain("知识库覆盖不足");
  });

  it("suspect_badcase includes label", () => {
    const r = computeConfidence({ retrievalCoverage: 0.1, retrievalAccuracy: 0.1, completeness: 0.1 });
    const msg = describeConfidence(r);
    expect(msg).toContain("可疑错误");
  });
});
