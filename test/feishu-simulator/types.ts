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
};

export type TestCase = {
  name?: string;
  message: string;
  assert?: TestCaseAssert;
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
