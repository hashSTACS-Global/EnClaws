export type MemorySource = "memory" | "sessions";

export type MemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
  source: MemorySource;
  scope?: "tenant" | "agent";
  sourceLabel?: string;
  citation?: string;
};

export type MemoryProgressiveSection = {
  id: string;
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  preview: string;
  summary: string;
  keywords: string[];
  titlePath: string[];
  parentId?: string;
};

export type MemoryOutlineNode = MemoryProgressiveSection;

export type MemoryProgressiveBlock = {
  id: string;
  sectionId: string;
  titlePath: string[];
  startLine: number;
  endLine: number;
  preview: string;
  keywords: string[];
};

export type MemoryProgressiveRouteMatch = {
  section: MemoryProgressiveSection;
  blocks: MemoryProgressiveBlock[];
  score: number;
};

export type MemoryOutlineFile = {
  path: string;
  sections: MemoryProgressiveSection[];
};

export type MemoryRouteFile = {
  path: string;
  matches: MemoryProgressiveRouteMatch[];
};

export type MemoryEmbeddingProbeResult = {
  ok: boolean;
  error?: string;
};

export type MemorySyncProgressUpdate = {
  completed: number;
  total: number;
  label?: string;
};

export type MemoryProviderStatus = {
  backend: "builtin" | "qmd";
  provider: string;
  model?: string;
  requestedProvider?: string;
  files?: number;
  chunks?: number;
  dirty?: boolean;
  workspaceDir?: string;
  dbPath?: string;
  extraPaths?: string[];
  sources?: MemorySource[];
  sourceCounts?: Array<{ source: MemorySource; files: number; chunks: number }>;
  cache?: { enabled: boolean; entries?: number; maxEntries?: number };
  fts?: { enabled: boolean; available: boolean; error?: string };
  fallback?: { from: string; reason?: string };
  vector?: {
    enabled: boolean;
    available?: boolean;
    extensionPath?: string;
    loadError?: string;
    dims?: number;
  };
  batch?: {
    enabled: boolean;
    failures: number;
    limit: number;
    wait: boolean;
    concurrency: number;
    pollIntervalMs: number;
    timeoutMs: number;
    lastError?: string;
    lastProvider?: string;
  };
  custom?: Record<string, unknown>;
};

export interface MemorySearchManager {
  search(
    query: string,
    opts?: { maxResults?: number; minScore?: number; sessionKey?: string },
  ): Promise<MemorySearchResult[]>;
  readFile(params: {
    relPath: string;
    from?: number;
    lines?: number;
  }): Promise<{ text: string; path: string }>;
  outline?(params?: {
    relPath?: string;
    maxSections?: number;
    previewChars?: number;
  }): Promise<{ files: MemoryOutlineFile[] }>;
  route?(params: {
    query: string;
    relPath?: string;
    maxResults?: number;
    maxBlocksPerSection?: number;
    previewChars?: number;
  }): Promise<{ files: MemoryRouteFile[] }>;
  status(): MemoryProviderStatus;
  sync?(params?: {
    reason?: string;
    force?: boolean;
    progress?: (update: MemorySyncProgressUpdate) => void;
  }): Promise<void>;
  probeEmbeddingAvailability(): Promise<MemoryEmbeddingProbeResult>;
  probeVectorAvailability(): Promise<boolean>;
  close?(): Promise<void>;
}
