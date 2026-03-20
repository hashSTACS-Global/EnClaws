import type {
  BrowserActionOk,
  BrowserActionPathResult,
  BrowserActionTabResult,
} from "./client-actions-types.js";
import { buildProfileQuery, withBaseUrl } from "./client-actions-url.js";
import { fetchBrowserJson } from "./client-fetch.js";

export type BrowserFormField = {
  ref: string;
  type: string;
  value?: string | number | boolean;
};

export type BrowserActRequest =
  | {
      kind: "click";
      ref: string;
      targetId?: string;
      doubleClick?: boolean;
      button?: string;
      modifiers?: string[];
      timeoutMs?: number;
    }
  | {
      kind: "type";
      ref: string;
      text: string;
      targetId?: string;
      submit?: boolean;
      slowly?: boolean;
      timeoutMs?: number;
    }
  | { kind: "press"; key: string; targetId?: string; delayMs?: number }
  | { kind: "hover"; ref: string; targetId?: string; timeoutMs?: number }
  | {
      kind: "scrollIntoView";
      ref: string;
      targetId?: string;
      timeoutMs?: number;
    }
  | {
      kind: "drag";
      startRef: string;
      endRef: string;
      targetId?: string;
      timeoutMs?: number;
    }
  | {
      kind: "select";
      ref: string;
      values: string[];
      targetId?: string;
      timeoutMs?: number;
    }
  | {
      kind: "fill";
      fields: BrowserFormField[];
      targetId?: string;
      timeoutMs?: number;
    }
  | { kind: "resize"; width: number; height: number; targetId?: string }
  | {
      kind: "wait";
      timeMs?: number;
      text?: string;
      textGone?: string;
      selector?: string;
      url?: string;
      loadState?: "load" | "domcontentloaded" | "networkidle";
      fn?: string;
      targetId?: string;
      timeoutMs?: number;
    }
  | { kind: "evaluate"; fn: string; ref?: string; targetId?: string; timeoutMs?: number }
  | { kind: "close"; targetId?: string };

export type BrowserActResponse = {
  ok: true;
  targetId: string;
  url?: string;
  result?: unknown;
};

export type BrowserDownloadPayload = {
  url: string;
  suggestedFilename: string;
  path: string;
};

type BrowserDownloadResult = { ok: true; targetId: string; download: BrowserDownloadPayload };

async function postDownloadRequest(
  baseUrl: string | undefined,
  route: "/wait/download" | "/download",
  body: Record<string, unknown>,
  profile?: string,
): Promise<BrowserDownloadResult> {
  const q = buildProfileQuery(profile);
  return await fetchBrowserJson<BrowserDownloadResult>(withBaseUrl(baseUrl, `${route}${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 20000,
  });
}

export async function browserNavigate(
  baseUrl: string | undefined,
  opts: {
    url: string;
    targetId?: string;
    profile?: string;
  },
): Promise<BrowserActionTabResult> {
  const q = buildProfileQuery(opts.profile);
  return await fetchBrowserJson<BrowserActionTabResult>(withBaseUrl(baseUrl, `/navigate${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: opts.url, targetId: opts.targetId }),
    timeoutMs: 20000,
  });
}

export async function browserArmDialog(
  baseUrl: string | undefined,
  opts: {
    accept: boolean;
    promptText?: string;
    targetId?: string;
    timeoutMs?: number;
    profile?: string;
  },
): Promise<BrowserActionOk> {
  const q = buildProfileQuery(opts.profile);
  return await fetchBrowserJson<BrowserActionOk>(withBaseUrl(baseUrl, `/hooks/dialog${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      accept: opts.accept,
      promptText: opts.promptText,
      targetId: opts.targetId,
      timeoutMs: opts.timeoutMs,
    }),
    timeoutMs: 20000,
  });
}

export async function browserArmFileChooser(
  baseUrl: string | undefined,
  opts: {
    paths: string[];
    ref?: string;
    inputRef?: string;
    element?: string;
    targetId?: string;
    timeoutMs?: number;
    profile?: string;
  },
): Promise<BrowserActionOk> {
  const q = buildProfileQuery(opts.profile);
  return await fetchBrowserJson<BrowserActionOk>(withBaseUrl(baseUrl, `/hooks/file-chooser${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      paths: opts.paths,
      ref: opts.ref,
      inputRef: opts.inputRef,
      element: opts.element,
      targetId: opts.targetId,
      timeoutMs: opts.timeoutMs,
    }),
    timeoutMs: 20000,
  });
}

export async function browserWaitForDownload(
  baseUrl: string | undefined,
  opts: {
    path?: string;
    targetId?: string;
    timeoutMs?: number;
    profile?: string;
  },
): Promise<BrowserDownloadResult> {
  return await postDownloadRequest(
    baseUrl,
    "/wait/download",
    {
      targetId: opts.targetId,
      path: opts.path,
      timeoutMs: opts.timeoutMs,
    },
    opts.profile,
  );
}

export async function browserDownload(
  baseUrl: string | undefined,
  opts: {
    ref: string;
    path: string;
    targetId?: string;
    timeoutMs?: number;
    profile?: string;
  },
): Promise<BrowserDownloadResult> {
  return await postDownloadRequest(
    baseUrl,
    "/download",
    {
      targetId: opts.targetId,
      ref: opts.ref,
      path: opts.path,
      timeoutMs: opts.timeoutMs,
    },
    opts.profile,
  );
}

export async function browserAct(
  baseUrl: string | undefined,
  req: BrowserActRequest,
  opts?: { profile?: string },
): Promise<BrowserActResponse> {
  const q = buildProfileQuery(opts?.profile);
  return await fetchBrowserJson<BrowserActResponse>(withBaseUrl(baseUrl, `/act${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    timeoutMs: 20000,
  });
}

export async function browserScreenshotAction(
  baseUrl: string | undefined,
  opts: {
    targetId?: string;
    fullPage?: boolean;
    ref?: string;
    element?: string;
    type?: "png" | "jpeg";
    profile?: string;
  },
): Promise<BrowserActionPathResult> {
  const q = buildProfileQuery(opts.profile);
  return await fetchBrowserJson<BrowserActionPathResult>(withBaseUrl(baseUrl, `/screenshot${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetId: opts.targetId,
      fullPage: opts.fullPage,
      ref: opts.ref,
      element: opts.element,
      type: opts.type,
    }),
    timeoutMs: 20000,
  });
}

// ─── Batch Actions ───────────────────────────────────────────────────────────
// Mirrors agent-browser's `&&` command chaining design:
//   agent-browser open url && agent-browser wait --load networkidle && agent-browser snapshot -i
// Submit a sequence of steps in a single request to minimize round-trips.

/**
 * A single step in a batch request. Supports act steps (click, type, wait, etc.),
 * navigate steps, and snapshot steps. Executed in order; stops on first error.
 */
export type BrowserBatchStep =
  | (BrowserActRequest & { kind: BrowserActRequest["kind"] })
  | {
      kind: "navigate";
      url: string;
      targetId?: string;
      timeoutMs?: number;
    }
  | {
      kind: "snapshot";
      targetId?: string;
      /** Use 'efficient' to return only interactive refs — mirrors agent-browser -i flag */
      mode?: "efficient";
      interactive?: boolean;
      compact?: boolean;
      depth?: number;
    };

export type BrowserBatchRequest = {
  steps: BrowserBatchStep[];
  targetId?: string;
  profile?: string;
  /**
   * If true, stop processing steps after the first snapshot step succeeds.
   * Useful for navigate → wait → snapshot patterns where you only need the final snapshot.
   */
  stopOnSnapshot?: boolean;
};

export type BrowserBatchStepResult =
  | { ok: true; kind: string; result?: unknown }
  | { ok: false; kind: string; error: string };

export type BrowserBatchResponse = {
  ok: true;
  targetId: string;
  url?: string;
  results: BrowserBatchStepResult[];
  /**
   * The last successful snapshot result promoted to top-level for easy AI access.
   * AI agents can read this directly without scanning results[].
   * Present only when a snapshot step succeeded.
   */
  snapshot?: unknown;
  /** Index of the step that failed, if any */
  failedAt?: number;
};

/**
 * Execute a batch of browser steps in sequence.
 * Mirrors agent-browser's `&&` command chaining — submit navigate + wait + snapshot
 * in a single call to minimize LLM round-trips and token overhead.
 *
 * @example
 * await browserBatch(baseUrl, {
 *   steps: [
 *     { kind: "navigate", url: "https://example.com" },
 *     { kind: "wait", loadState: "networkidle" },
 *     { kind: "snapshot", mode: "efficient" },
 *   ],
 *   stopOnSnapshot: true,
 * });
 */
export async function browserBatch(
  baseUrl: string | undefined,
  req: BrowserBatchRequest,
  opts?: { profile?: string },
): Promise<BrowserBatchResponse> {
  const q = buildProfileQuery(opts?.profile ?? req.profile);
  return await fetchBrowserJson<BrowserBatchResponse>(withBaseUrl(baseUrl, `/batch${q}`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(req),
    timeoutMs: 120000,
  });
}
