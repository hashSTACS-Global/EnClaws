import { vi } from "vitest";

export type SearchImpl = () => Promise<unknown[]>;
export type MemoryReadParams = { relPath: string; from?: number; lines?: number };
export type MemoryReadResult = { text: string; path: string };
type MemoryBackend = "builtin" | "qmd";

let backend: MemoryBackend = "builtin";
let searchImpl: SearchImpl = async () => [];
let readFileImpl: (params: MemoryReadParams) => Promise<MemoryReadResult> = async (params) => ({
  text: "",
  path: params.relPath,
});
let lastManagerParams: unknown;
let managerParamCalls: unknown[] = [];

const stubManager = {
  search: vi.fn(async () => await searchImpl()),
  readFile: vi.fn(async (params: MemoryReadParams) => await readFileImpl(params)),
  status: () => ({
    backend,
    files: 1,
    chunks: 1,
    dirty: false,
    workspaceDir: "/workspace",
    dbPath: "/workspace/.memory/index.sqlite",
    provider: "builtin",
    model: "builtin",
    requestedProvider: "builtin",
    sources: ["memory" as const],
    sourceCounts: [{ source: "memory" as const, files: 1, chunks: 1 }],
  }),
  sync: vi.fn(),
  probeVectorAvailability: vi.fn(async () => true),
  close: vi.fn(),
};

vi.mock("../../src/memory/index.js", () => ({
  getMemorySearchManager: async (params: unknown) => {
    lastManagerParams = params;
    managerParamCalls.push(params);
    return { manager: stubManager };
  },
}));

export function setMemoryBackend(next: MemoryBackend): void {
  backend = next;
}

export function setMemorySearchImpl(next: SearchImpl): void {
  searchImpl = next;
}

export function setMemoryReadFileImpl(
  next: (params: MemoryReadParams) => Promise<MemoryReadResult>,
): void {
  readFileImpl = next;
}

export function resetMemoryToolMockState(overrides?: {
  backend?: MemoryBackend;
  searchImpl?: SearchImpl;
  readFileImpl?: (params: MemoryReadParams) => Promise<MemoryReadResult>;
}): void {
  backend = overrides?.backend ?? "builtin";
  searchImpl = overrides?.searchImpl ?? (async () => []);
  readFileImpl =
    overrides?.readFileImpl ??
    (async (params: MemoryReadParams) => ({ text: "", path: params.relPath }));
  lastManagerParams = undefined;
  managerParamCalls = [];
  vi.clearAllMocks();
}

export function getLastMemoryManagerParams<T = unknown>(): T | undefined {
  return lastManagerParams as T | undefined;
}

export function getMemoryManagerParamCalls<T = unknown>(): T[] {
  return managerParamCalls as T[];
}
