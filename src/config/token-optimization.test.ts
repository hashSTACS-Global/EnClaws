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
  ] as const;

  afterEach(() => {
    for (const key of KEYS) {
      delete process.env[key];
    }
  });

  it("returns false when env var is not set", () => {
    expect(isOptEnabled("P1")).toBe(false);
    expect(isOptEnabled("CACHE")).toBe(false);
    expect(isOptEnabled("TRIM")).toBe(false);
    expect(isOptEnabled("WORKER")).toBe(false);
    expect(isOptEnabled("COMPRESS")).toBe(false);
    expect(isOptEnabled("DEDUP")).toBe(false);
    expect(isOptEnabled("PROMPT")).toBe(false);
  });

  it('returns true when env var is "true"', () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "true";
    process.env.ENCLAWS_TOKEN_OPT_CACHE = "true";
    expect(isOptEnabled("P1")).toBe(true);
    expect(isOptEnabled("CACHE")).toBe(true);
    expect(isOptEnabled("TRIM")).toBe(false);
  });

  it('returns false for non-"true" values', () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "false";
    process.env.ENCLAWS_TOKEN_OPT_CACHE = "1";
    process.env.ENCLAWS_TOKEN_OPT_TRIM = "";
    expect(isOptEnabled("P1")).toBe(false);
    expect(isOptEnabled("CACHE")).toBe(false);
    expect(isOptEnabled("TRIM")).toBe(false);
  });

  it("toggles are independent", () => {
    process.env.ENCLAWS_TOKEN_OPT_P1 = "true";
    process.env.ENCLAWS_TOKEN_OPT_WORKER = "true";
    expect(isOptEnabled("P1")).toBe(true);
    expect(isOptEnabled("CACHE")).toBe(false);
    expect(isOptEnabled("WORKER")).toBe(true);
    expect(isOptEnabled("COMPRESS")).toBe(false);
  });

  it("PROMPT toggle works independently", () => {
    process.env.ENCLAWS_TOKEN_OPT_PROMPT = "true";
    expect(isOptEnabled("PROMPT")).toBe(true);
    expect(isOptEnabled("P1")).toBe(false);
  });
});
