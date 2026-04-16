import { describe, it, expect } from "vitest";
import { DEFAULT_DISABLED_BUNDLED_SKILLS } from "./defaults.js";

describe("DEFAULT_DISABLED_BUNDLED_SKILLS", () => {
  it("contains exactly 26 skills", () => {
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).toHaveLength(26);
  });

  it("contains no duplicates", () => {
    const unique = new Set(DEFAULT_DISABLED_BUNDLED_SKILLS);
    expect(unique.size).toBe(DEFAULT_DISABLED_BUNDLED_SKILLS.length);
  });

  it("includes known consumer/personal skills", () => {
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).toContain("spotify-player");
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).toContain("xiaohongshu-publisher");
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).toContain("apple-notes");
  });

  it("does not include enterprise-relevant skills", () => {
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).not.toContain("github");
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).not.toContain("slack");
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).not.toContain("notion");
    expect(DEFAULT_DISABLED_BUNDLED_SKILLS).not.toContain("summarize");
  });

  it("is frozen (immutable)", () => {
    expect(Object.isFrozen(DEFAULT_DISABLED_BUNDLED_SKILLS)).toBe(true);
  });
});
