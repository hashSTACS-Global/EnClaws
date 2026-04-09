import { vi } from "vitest";

// Mock heavy transitive deps so the module can be imported in isolation
vi.mock("../gateway/call.js", () => ({ callGateway: vi.fn() }));
vi.mock("./agent-scope.js", () => ({ resolveAgentConfig: vi.fn() }));
vi.mock("./subagent-announce.js", () => ({
  buildSubagentSystemPrompt: vi.fn(),
  readLatestSubagentOutput: vi.fn(),
}));
vi.mock("./subagent-depth.js", () => ({ getSubagentDepthFromSessionStore: vi.fn() }));
vi.mock("./subagent-registry.js", () => ({
  countActiveRunsForSession: vi.fn(),
  registerSubagentRun: vi.fn(),
  waitForSubagentCompletion: vi.fn(),
}));
vi.mock("./tools/sessions-helpers.js", () => ({
  resolveDisplaySessionKey: vi.fn(),
  resolveInternalSessionKey: vi.fn(),
  resolveMainSessionAlias: vi.fn(),
}));
vi.mock("./openclaw-tools.js", () => ({}));
vi.mock("../plugins/hook-runner-global.js", () => ({ getGlobalHookRunner: vi.fn() }));
vi.mock("./sandbox/runtime-status.js", () => ({ resolveSandboxRuntimeStatus: vi.fn() }));
vi.mock("./model-selection.js", () => ({ resolveSubagentSpawnModelSelection: vi.fn() }));

import { describe, it, expect, afterEach } from "vitest";
import { compressSubagentResult, resolveSubagentTools } from "./subagent-spawn.js";

describe("compressSubagentResult", () => {
  afterEach(() => {
    delete process.env.ENCLAWS_TOKEN_OPT_COMPRESS;
  });

  it("returns short results unchanged regardless of toggle", () => {
    process.env.ENCLAWS_TOKEN_OPT_COMPRESS = "true";
    const short = "a".repeat(5_000);
    expect(compressSubagentResult(short)).toBe(short);
  });

  it("returns results unchanged when toggle is off", () => {
    const long = "x".repeat(10_000);
    expect(compressSubagentResult(long)).toBe(long);
  });

  it("compresses long results when toggle is on", () => {
    process.env.ENCLAWS_TOKEN_OPT_COMPRESS = "true";
    const long = "H".repeat(3_000) + "M".repeat(4_000) + "T".repeat(2_000);
    const result = compressSubagentResult(long);
    expect(result).toContain("H".repeat(3_000));
    expect(result).toContain("T".repeat(2_000));
    expect(result).toContain("[4000 chars trimmed]");
    expect(result.length).toBeLessThan(long.length);
  });

  it("returns results at threshold unchanged", () => {
    process.env.ENCLAWS_TOKEN_OPT_COMPRESS = "true";
    const exact = "a".repeat(6_000);
    expect(compressSubagentResult(exact)).toBe(exact);
  });
});

describe("resolveSubagentTools (OPT-11)", () => {
  afterEach(() => {
    delete process.env.ENCLAWS_TOKEN_OPT_TOOLSYNC;
  });

  it("passes tools through when TOOLSYNC toggle is off", () => {
    const tools = ["exec", "read", "write"];
    expect(resolveSubagentTools(tools)).toEqual(tools);
  });

  it("returns undefined when TOOLSYNC toggle is on", () => {
    process.env.ENCLAWS_TOKEN_OPT_TOOLSYNC = "true";
    const tools = ["exec", "read", "write"];
    expect(resolveSubagentTools(tools)).toBeUndefined();
  });

  it("returns undefined when TOOLSYNC is on and tools is undefined", () => {
    process.env.ENCLAWS_TOKEN_OPT_TOOLSYNC = "true";
    expect(resolveSubagentTools(undefined)).toBeUndefined();
  });
});
