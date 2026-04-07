/** A single conversation turn — user sends, LLM replies */
export interface ScenarioTurn {
  user: string;
}

/** Assertions on capture output */
export interface CaptureAssert {
  minCandidates?: number;
  maxCandidates?: number;
  expectedKinds?: string[];
  forbiddenKinds?: string[];
  summaryContainsAny?: string[];
}

/** Assertions on distill output */
export interface DistillAssert {
  minRecords?: number;
  summaryNotEmpty?: boolean;
  hasSourceCandidateIds?: boolean;
}

/** A single test scenario loaded from JSON */
export interface TestScenario {
  name: string;
  description?: string;
  systemPrompt: string;
  turns: ScenarioTurn[];
  memoryMd?: string;
  captureAssert?: CaptureAssert;
  distillAssert?: DistillAssert;
}

/** LLM model config resolved from tenant_models */
export interface ModelConfig {
  /** tenant_models.id (UUID) — used to build "tm-{id}" provider key */
  tenantModelId: string;
  providerType: string;
  apiKey: string;
  baseUrl: string | null;
  apiProtocol: string;
  modelId: string;
}

/** Result row for CSV report */
export interface ResultRow {
  scenario: string;
  phase: "conversation" | "capture" | "distill";
  status: "PASS" | "FAIL";
  details: string;
  duration: string;
}

/** Options for the test runner */
export interface RunnerOptions {
  dataDir: string;
  csvOutput: string;
  continueOnFailure: boolean;
}
