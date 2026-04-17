import { describe, it, expect, afterEach } from "vitest";
import { buildAgentSystemPrompt } from "./system-prompt.js";

describe("system-prompt PROMPT optimization", () => {
  // PROMPT is on by default now; no beforeEach needed

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

  it("includes all valid context files when PROMPT enabled", () => {
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      contextFiles: [
        {
          path: "SOUL.md",
          content: "# Soul\n\nBe helpful and concise. Have strong opinions about everything.",
        },
        { path: "CONFIG.md", content: "# Config\n\nSome config content." },
      ],
    });
    expect(prompt).toContain("SOUL.md");
    expect(prompt).toContain("Be helpful and concise");
    expect(prompt).toContain("CONFIG.md");
  });

  it("contains inline_skill instruction when PROMPT is off", () => {
    process.env.ENCLAWS_TOKEN_OPT_PROMPT = "false";
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      skillsPrompt: [
        "<available_skills>",
        '- feishu-auth: Auth skill <inline_skill path="/skills/feishu-auth/SKILL.md">skill content</inline_skill>',
        "</available_skills>",
      ].join("\n"),
    });
    expect(prompt).toContain("follow its instructions DIRECTLY");
  });

  it("preserves empty context files when PROMPT toggle is off", () => {
    process.env.ENCLAWS_TOKEN_OPT_PROMPT = "false";
    const prompt = buildAgentSystemPrompt({
      workspaceDir: "/test",
      contextFiles: [{ path: "HEARTBEAT.md", content: "# Keep empty\n" }],
    });
    expect(prompt).toContain("HEARTBEAT.md");
  });
});
