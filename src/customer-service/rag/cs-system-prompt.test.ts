/**
 * Tests for CS Agent system prompt builder.
 *
 * 客服 Agent 系统提示词构建器测试。
 */

import { describe, expect, it } from "vitest";
import { buildCSSystemPrompt } from "./cs-system-prompt.js";
import type { MemorySearchResult } from "../../memory/types.js";

describe("buildCSSystemPrompt", () => {
  it("includes role and behavior rules", () => {
    const prompt = buildCSSystemPrompt({ knowledgeChunks: [] });
    expect(prompt).toContain("AI 客服助手");
    expect(prompt).toContain("行为规则");
    expect(prompt).toContain("禁止行为");
  });

  it("includes knowledge chunks when provided", () => {
    const chunks: MemorySearchResult[] = [
      {
        path: "ec-faq.md",
        startLine: 1,
        endLine: 5,
        score: 0.85,
        snippet: "EC 是企业级 AI 助手容器平台",
        source: "vector",
      },
    ];
    const prompt = buildCSSystemPrompt({ knowledgeChunks: chunks });
    expect(prompt).toContain("知识片段 1");
    expect(prompt).toContain("ec-faq.md");
    expect(prompt).toContain("EC 是企业级 AI 助手容器平台");
    expect(prompt).toContain("0.85");
  });

  it("shows placeholder when no knowledge chunks", () => {
    const prompt = buildCSSystemPrompt({ knowledgeChunks: [] });
    expect(prompt).toContain("未检索到相关知识");
  });

  it("includes visitor name when provided", () => {
    const prompt = buildCSSystemPrompt({ knowledgeChunks: [], visitorName: "张三" });
    expect(prompt).toContain("张三");
  });
});
