import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

describe("system-prompt PROMPT optimization", () => {
  beforeEach(() => {
    process.env.ENCLAWS_TOKEN_OPT_PROMPT = "true";
  });

  afterEach(() => {
    delete process.env.ENCLAWS_TOKEN_OPT_PROMPT;
  });

  it("does not contain inline_skill instruction when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      skillsPrompt: [
        "<available_skills>",
        "- feishu-auth: Auth skill [/skills/feishu-auth/SKILL.md]",
        "</available_skills>",
      ].join("\n"),
    });
    expect(prompt).not.toContain("follow its instructions DIRECTLY");
  });

  it("skips empty context files when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      contextFiles: [
        { path: "SOUL.md", content: "# Soul\n\nBe helpful and concise. Have strong opinions about everything." },
        { path: "USER.md", content: "# USER.md\n\n_(empty)_\n" },
        { path: "HEARTBEAT.md", content: "# HEARTBEAT.md\n\n# Keep this file empty\n" },
      ],
    });
    expect(prompt).toContain("SOUL.md");
    expect(prompt).toContain("Be helpful and concise");
    expect(prompt).not.toContain("HEARTBEAT.md");
    expect(prompt).not.toContain("USER.md");
  });

  it("skips Reply Tags for feishu channel when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      runtimeInfo: { channel: "feishu" },
    });
    expect(prompt).not.toContain("## Reply Tags");
    expect(prompt).not.toContain("[[reply_to_current]]");
  });

  it("keeps Reply Tags for web channel when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      runtimeInfo: { channel: "web" },
    });
    expect(prompt).toContain("## Reply Tags");
  });

  it("skips CLI Quick Reference for IM channels when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      runtimeInfo: { channel: "telegram" },
    });
    expect(prompt).not.toContain("## EnClaws CLI Quick Reference");
  });

  it("skips Memory Management section when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      toolNames: ["tenant_memory", "user_memory"],
    });
    expect(prompt).not.toContain("## Memory Management");
  });

  it("preserves all sections when PROMPT toggle is off", () => {
    delete process.env.ENCLAWS_TOKEN_OPT_PROMPT;
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      toolNames: ["tenant_memory", "user_memory"],
      runtimeInfo: { channel: "feishu" },
      contextFiles: [
        { path: "HEARTBEAT.md", content: "# Keep empty\n" },
      ],
    });
    expect(prompt).toContain("## Reply Tags");
    expect(prompt).toContain("## Memory Management");
    expect(prompt).toContain("HEARTBEAT.md");
  });
});
