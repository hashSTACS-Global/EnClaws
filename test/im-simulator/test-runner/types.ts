export type TestCaseAssert = {
  contains?: string;
  notContains?: string;
  matches?: string;
  minLength?: number;
  maxLength?: number;
};

export type TestCase = {
  name?: string;
  message: string;
  assert?: TestCaseAssert;
};

export type TestFile = {
  email: string;
  password: string;
  ownerEmail?: string;
  ownerPassword?: string;
  agentId: string;
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
  gatewayUrl: string;
  gatewayToken: string;
  dataDir: string;
  csvOutput: string;
  continueOnFailure: boolean;
  /** Number of JSON files to run in parallel (default: 1 = sequential) */
  concurrency?: number;
};
