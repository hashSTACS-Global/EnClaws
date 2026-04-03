export type TestCaseAssert = {
  contains?: string;
  notContains?: string;
  matches?: string;
  minLength?: number;
  maxLength?: number;
  /** Assert the message type (e.g. "text", "file", "image", "interactive") */
  msgType?: string;
  /** Assert the reply contains a file (file_key is non-empty) */
  hasFile?: boolean;
  /** Assert the reply contains an image (image_key is non-empty) */
  hasImage?: boolean;
  /** Assert the file name matches a regex pattern */
  fileNameMatches?: string;
  /** Assert the reply contains ANY of the given strings (pass if at least one matches) */
  containsAny?: string[];
  /** Assert the reply contains ALL of the given strings */
  containsAll?: string[];
};

export type TestCase = {
  name?: string;
  message: string;
  assert?: TestCaseAssert;
  /** Tags for filtering (e.g. ["feishu-skills", "create-doc", "P0"]) */
  tags?: string[];
};

export type TestFile = {
  appId: string;
  appSecret: string;
  userOpenId: string;
  cases: TestCase[];
};

export type ResultRow = {
  file: string;
  name: string;
  message: string;
  expected: string;
  actual: string;
  passed: boolean;
  duration: string;
};

export type RunnerOptions = {
  dataDir: string;
  csvOutput: string;
  continueOnFailure: boolean;
  concurrency?: number;
  replyTimeoutMs?: number;
  pollIntervalMs?: number;
};

// ---------------------------------------------------------------------------
// Layer 1: Script-level testing (direct skill script invocation)
// ---------------------------------------------------------------------------

export type ScriptAssert = {
  /** Expected exit code (default: 0) */
  exitCode?: number;
  /** Assert JSON output fields by dot-path */
  jsonPath?: Record<string, {
    equals?: unknown;
    contains?: string;
    matches?: string;
    notContains?: string;
    exists?: boolean;
  }>;
  /** Assert stdout contains string */
  stdoutContains?: string;
  /** Assert stdout does NOT contain string */
  stdoutNotContains?: string;
  /** Assert stderr contains string (for error cases) */
  stderrContains?: string;
};

export type ScriptTestCase = {
  name: string;
  /** Command to execute (supports {{VAR}} template substitution) */
  command: string;
  assert?: ScriptAssert;
  /** Cleanup command to run after test (supports {{result.field}} substitution) */
  cleanup?: string;
  tags?: string[];
};

export type ScriptTestFile = {
  /** Base directory for resolving relative script paths */
  skillsDir: string;
  /** Environment variables to set for all commands */
  env?: Record<string, string>;
  /** Template variables for {{VAR}} substitution in commands */
  vars?: Record<string, string>;
  cases: ScriptTestCase[];
};

export type ScriptResultRow = ResultRow & {
  exitCode?: number;
  stdout?: string;
  stderr?: string;
};

// ---------------------------------------------------------------------------
// Layer 3: LLM-as-Judge (reply quality evaluation)
// ---------------------------------------------------------------------------

export type LlmJudgeCriteria = {
  /** Human-readable criterion description */
  description: string;
  /** Weight (default: 1). Higher = more important */
  weight?: number;
};

export type LlmJudgeConfig = {
  /** LLM provider: "anthropic" | "openai" */
  provider: "anthropic" | "openai";
  /** Model ID (e.g. "claude-haiku-4-5-20251001") */
  model: string;
  /** API key */
  apiKey: string;
  /** API base URL override (optional) */
  baseUrl?: string;
};

export type LlmJudgeAssert = {
  /** List of criteria to evaluate */
  criteria: string[];
  /** Pass threshold: fraction of criteria that must pass (default: 0.75) */
  passThreshold?: number;
};

export type TestCaseWithJudge = TestCase & {
  /** Optional LLM-as-Judge evaluation */
  llmJudge?: LlmJudgeAssert;
};

export type TestFileWithJudge = Omit<TestFile, "cases"> & {
  cases: TestCaseWithJudge[];
};

export type JudgeResultRow = ResultRow & {
  /** Per-criterion pass/fail details */
  criteriaResults?: Array<{ criterion: string; passed: boolean; reason: string }>;
  /** Overall judge score (0-1) */
  judgeScore?: number;
};
