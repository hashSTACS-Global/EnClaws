import { describe, it, expect, afterEach } from "vitest";
import { isOptEnabled } from "./token-optimization.js";

describe("isOptEnabled", () => {
  const KEYS = [
    "ENCLAWS_TOKEN_OPT_P1",
    "ENCLAWS_TOKEN_OPT_CACHE",
    "ENCLAWS_TOKEN_OPT_TRIM",
    "ENCLAWS_TOKEN_OPT_WORKER",
    "ENCLAWS_TOKEN_OPT_COMPRESS",
    "ENCLAWS_TOKEN_OPT_DEDUP",
    "ENCLAWS_TOKEN_OPT_PROMPT",
    "ENCLAWS_TOKEN_OPT_TOOLLIST",
    "ENCLAWS_TOKEN_OPT_TOOLSYNC",
  ] as const;

  afterEach(() => {
    for (const key of KEYS) {
      delete process.env[key];
    }
  });

  it("returns true when env var is not set (default on)", () => {
    expect(isOptEnabled("P1")).toBe(true);
    expect(isOptEnabled("CACHE")).toBe(true);
    expect(isOptEnabled("TRIM")).toBe(true);
    expect(isOptEnabled("WORKER")).toBe(true);
    expect(isOptEnabled("COMPRESS")).toBe(true);
    expect(isOptEnabled("DEDUP")).toBe(true);
    expect(isOptEnabled("PROMPT")).toBe(true);
    expect(isOptEnabled("TOOLLIST")).toBe(true);
    expect(isOptEnabled("TOOLSYNC")).toBe(true);
  });

  it('returns true when env var is "true"', () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "true";
    process.env.ENCLAWS_TOKEN_OPT_CACHE = "true";
    expect(isOptEnabled("P1")).toBe(true);
    expect(isOptEnabled("CACHE")).toBe(true);
  });

  it('returns false only when env var is explicitly "false"', () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "false";
    process.env.ENCLAWS_TOKEN_OPT_CACHE = "false";
    expect(isOptEnabled("P1")).toBe(false);
    expect(isOptEnabled("CACHE")).toBe(false);
  });

  it("returns true for non-false values", () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "1";
    process.env.ENCLAWS_TOKEN_OPT_CACHE = "";
    process.env.ENCLAWS_TOKEN_OPT_TRIM = "yes";
    expect(isOptEnabled("P1")).toBe(true);
    expect(isOptEnabled("CACHE")).toBe(true);
    expect(isOptEnabled("TRIM")).toBe(true);
  });

  it("toggles are independent", () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "false";
    process.env.ENCLAWS_TOKEN_OPT_WORKER = "false";
    expect(isOptEnabled("P1")).toBe(false);
    expect(isOptEnabled("CACHE")).toBe(true);
    expect(isOptEnabled("WORKER")).toBe(false);
    expect(isOptEnabled("COMPRESS")).toBe(true);
  });

  it("PROMPT toggle works independently", () => {
    process.env.ENCLAWS_TOKEN_OPT_PROMPT = "false";
    expect(isOptEnabled("PROMPT")).toBe(false);
    expect(isOptEnabled("P1")).toBe(true);
  });
});
