/**
 * ExecPathPolicy — gate shell/exec commands through PathPermissionPolicy.
 *
 * Bridges exec-style tools (Bash, process) to the same path allowlist that
 * already protects read/write/edit tools. Parses argv out of the command
 * string, resolves literal path tokens against the exec cwd, and invokes
 * policy.check() to decide.
 *
 * Two layers of enforcement:
 *   1. Destructive commands (rm / mv / cp / dd / truncate / find -delete /
 *      rsync --delete / sed -i / redirect > / tee / shred / unlink / rmdir):
 *      EVERY path argument is checked against the allowlist with the "write"
 *      op. Anything outside the allowlist is blocked — defense against the
 *      AI destroying arbitrary host files.
 *   2. Non-destructive commands: only paths that land inside the state dir
 *      get checked (existing behaviour — keeps `ls /usr/bin` and `cat
 *      /etc/hostname` free).
 *
 * Two modes:
 *   - strict   (default on Linux)  — shell-quote AST + per-segment analysis.
 *   - lenient  (default elsewhere) — regex scan; destructive path check not
 *     available without a reliable parser.
 *
 * Design principle: confident-parse-only. Any parse ambiguity (variables,
 * subshells, globs) is silently skipped. Evasion via variables or language
 * runtimes (node -e 'fs.rmSync…') is accepted as a known limitation and
 * mitigated by defense in depth (system prompt + PathPermissionPolicy on
 * file tools + gateway exec denylist).
 */

import path from "node:path";
import { parse as shellParse } from "shell-quote";
import { resolveStateDir } from "../config/paths.js";
import { expandHomePrefix } from "./home-dir.js";
import { isPathInside } from "./path-guards.js";
import type { PathPermissionPolicy } from "./path-permission-policy.js";

type ParseEntry = string | { op: string } | { pattern: string; op?: string } | { comment: string };

const AMBIGUOUS_STRING_MARKERS = /[`$]/;
const LENIENT_AMBIGUOUS_MARKERS = /\$env:|\$\(|%[A-Za-z_][A-Za-z0-9_]*%|`/;
const PATHLIKE_PREFIX = /^(?:~[/\\]?|\/|\.\/|\.\.\/|[A-Za-z]:[/\\])/;
const ASSIGNMENT_REGEX = /^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/;

/**
 * Bins whose entire argv list is treated as destructive targets. A strict
 * allowlist check (op="write") runs on EVERY path argument.
 */
const DESTRUCTIVE_BINS: ReadonlySet<string> = new Set([
  "rm",
  "rmdir",
  "unlink",
  "shred",
  "truncate",
  "mv",
  "cp",
  "dd",
  "tee",
]);

/**
 * Bins that are only destructive with a specific flag. First match of the
 * flag pattern (regex against the remainder of the segment's raw string)
 * elevates the whole segment to destructive.
 */
const CONDITIONAL_DESTRUCTIVE_BINS: ReadonlyArray<{ bin: string; flagPattern: RegExp }> = [
  { bin: "find", flagPattern: /(?:^|\s)(?:-delete\b|-exec\s+rm\b|-execdir\s+rm\b)/ },
  { bin: "rsync", flagPattern: /(?:^|\s)--delete\b/ },
  { bin: "sed", flagPattern: /(?:^|\s)-i\b/ },
  { bin: "xargs", flagPattern: /\brm\b/ },
];

/**
 * System devices treated as safe sources/sinks for destructive commands.
 * `dd if=/dev/null of=…`, `> /dev/null`, etc. shouldn't get flagged as
 * out-of-allowlist reads.
 */
const SAFE_DEVICES: ReadonlySet<string> = new Set([
  "/dev/null",
  "/dev/zero",
  "/dev/random",
  "/dev/urandom",
  "/dev/stdin",
  "/dev/stdout",
  "/dev/stderr",
]);

/** Shell operators that end a pipeline segment. */
const SEGMENT_BREAK_OPS: ReadonlySet<string> = new Set(["|", "||", "&&", ";", "&"]);

/** Shell write-redirect operators — the next string token is the write target.
 * Note: `>|` is not listed explicitly because shell-quote decomposes it into
 *       `>` + `|` (the pipe then ends the segment). Accept that as a known
 *       limitation — it's rarely used in automated agent commands. */
const WRITE_REDIRECT_OPS: ReadonlySet<string> = new Set([">", ">>"]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildLenientPathRegex(stateDirBasename: string): RegExp {
  const esc = escapeRegex(stateDirBasename);
  return new RegExp(
    `(?:~[/\\\\]|[A-Za-z]:[/\\\\]|\\\\\\\\|\\$HOME[/\\\\]|\\$USERPROFILE[/\\\\])[^\\s"'|;&><]*${esc}[/\\\\][^\\s"'|;&><]*`,
    "gi",
  );
}

export function checkExecPathsAgainstPolicy(args: {
  command: string;
  cwd: string;
  policy: PathPermissionPolicy;
  /** Override platform for testing. Defaults to process.platform. */
  platform?: NodeJS.Platform;
  /**
   * When true, suppresses the destructive-args check (not the state-dir
   * check). Set this for sandbox-hosted exec where command paths are
   * container-relative and can't be resolved against the host allowlist.
   */
  skipDestructiveCheck?: boolean;
}): string | null {
  const { command, cwd, policy, skipDestructiveCheck } = args;
  if (!command || !cwd) {
    return null;
  }

  const platform = args.platform ?? process.platform;
  if (platform === "linux") {
    return strictCheck(command, cwd, policy, skipDestructiveCheck === true);
  }
  // Non-Linux: destructive-args check requires a reliable parser; fall back
  // to state-dir-only regex scan (existing behaviour).
  return lenientCheck(command, cwd, policy);
}

function mentionsStateDir(command: string): boolean {
  const stateDir = resolveStateDir();
  const basename = path.basename(stateDir);
  const stateLower = stateDir.replace(/\\/g, "/").toLowerCase();
  const needleLower = command.replace(/\\/g, "/").toLowerCase();
  if (needleLower.includes(stateLower)) {
    return true;
  }
  const basenameRe = new RegExp(`${escapeRegex(basename)}\\b`, "i");
  if (basenameRe.test(command)) {
    return true;
  }
  return false;
}

// ── strict (Linux) ───────────────────────────────────────────────────────────

type Segment = {
  tokens: ParseEntry[];
  /** Indices (relative to `tokens`) of write-redirect target tokens. */
  redirectTargets: Set<number>;
};

function strictCheck(
  command: string,
  cwd: string,
  policy: PathPermissionPolicy,
  skipDestructiveCheck: boolean,
): string | null {
  let parsed: ParseEntry[];
  try {
    parsed = shellParse(command) as ParseEntry[];
  } catch {
    return null;
  }

  const stateDir = resolveStateDir();
  const segments = splitIntoSegments(parsed);

  for (const segment of segments) {
    const destructive = !skipDestructiveCheck && isSegmentDestructive(segment);

    for (let i = 0; i < segment.tokens.length; i++) {
      const token = segment.tokens[i];
      if (typeof token !== "string") {
        continue;
      }
      if (AMBIGUOUS_STRING_MARKERS.test(token)) {
        continue;
      }

      const extracted = extractPathFromToken(token);
      if (!extracted) {
        continue;
      }

      // Safe-device exemption — matched against the original posix-style token
      // rather than the resolved absolute path, because `path.resolve` on
      // Windows rewrites `/dev/null` into `C:\dev\null` and breaks the match.
      if (SAFE_DEVICES.has(extracted.replace(/\\/g, "/"))) {
        continue;
      }

      const abs = resolveTokenPath(extracted, cwd);
      if (!abs) {
        continue;
      }

      const isRedirectTarget = segment.redirectTargets.has(i);
      const strictHere = destructive || isRedirectTarget;

      if (strictHere) {
        const violation = policy.check(abs, "write");
        if (violation) {
          return violation;
        }
      } else if (isPathInside(stateDir, abs)) {
        const violation = policy.check(abs, "read");
        if (violation) {
          return violation;
        }
      }
    }
  }

  return null;
}

/**
 * Break a flat shell-quote token array into pipeline segments.
 * - Subshell contents (between `(` and `)`) are dropped entirely — we can't
 *   reason about them confidently (see `confident-parse-only` principle).
 * - Segment boundaries: `|`, `||`, `&&`, `;`, `&`.
 * - Write-redirect ops (`>`, `>|`, `>>`) don't split the segment; instead we
 *   mark the NEXT string token as a destructive write target.
 */
function splitIntoSegments(parsed: ParseEntry[]): Segment[] {
  const segments: Segment[] = [];
  let current: Segment = { tokens: [], redirectTargets: new Set() };
  let subshellDepth = 0;
  let pendingRedirect = false;

  const commitSegment = () => {
    if (current.tokens.length > 0) {
      segments.push(current);
    }
    current = { tokens: [], redirectTargets: new Set() };
    pendingRedirect = false;
  };

  for (const token of parsed) {
    if (typeof token === "object" && token !== null && "op" in token) {
      const op = (token as { op: string }).op;
      if (op === "(") {
        subshellDepth++;
        continue;
      }
      if (op === ")") {
        subshellDepth = Math.max(0, subshellDepth - 1);
        continue;
      }
      if (subshellDepth > 0) {
        continue;
      }
      if (SEGMENT_BREAK_OPS.has(op)) {
        commitSegment();
        continue;
      }
      if (WRITE_REDIRECT_OPS.has(op)) {
        pendingRedirect = true;
        continue;
      }
      // Other operators (`2>`, `<`, `&>`, etc.) — leave them silent.
      continue;
    }

    if (subshellDepth > 0) {
      continue;
    }

    // Absorb string / pattern / comment tokens into the current segment.
    const idx = current.tokens.length;
    current.tokens.push(token);
    if (pendingRedirect && typeof token === "string") {
      current.redirectTargets.add(idx);
      pendingRedirect = false;
    }
  }

  commitSegment();
  return segments;
}

function isSegmentDestructive(segment: Segment): boolean {
  // Find the first string token — that's the bin (argv[0]).
  let binIndex = -1;
  for (let i = 0; i < segment.tokens.length; i++) {
    const token = segment.tokens[i];
    if (typeof token === "string") {
      binIndex = i;
      break;
    }
  }
  if (binIndex === -1) {
    return false;
  }
  const rawBin = segment.tokens[binIndex] as string;
  // Strip any leading path (`/usr/bin/rm` → `rm`) and env prefix (`env rm`).
  const bin = path.basename(rawBin).toLowerCase();
  if (DESTRUCTIVE_BINS.has(bin)) {
    return true;
  }
  const cond = CONDITIONAL_DESTRUCTIVE_BINS.find((c) => c.bin === bin);
  if (!cond) {
    return false;
  }
  // Reconstruct a string view of the remaining args for the flag regex.
  const rest = segment.tokens
    .slice(binIndex + 1)
    .filter((t): t is string => typeof t === "string")
    .join(" ");
  return cond.flagPattern.test(rest);
}

function extractPathFromToken(token: string): string | null {
  // Handle VAR=<value> assignments (e.g. `dd of=/opt/foo`).
  const assignment = token.match(ASSIGNMENT_REGEX);
  if (assignment) {
    const rhs = assignment[2];
    if (rhs && PATHLIKE_PREFIX.test(rhs)) {
      return rhs;
    }
    return null;
  }
  if (PATHLIKE_PREFIX.test(token)) {
    return token;
  }
  return null;
}

function resolveTokenPath(token: string, cwd: string): string | null {
  try {
    return path.resolve(cwd, expandHomePrefix(token));
  } catch {
    return null;
  }
}

// ── lenient (non-Linux) ──────────────────────────────────────────────────────

function lenientCheck(command: string, cwd: string, policy: PathPermissionPolicy): string | null {
  if (!mentionsStateDir(command)) {
    return null;
  }
  if (LENIENT_AMBIGUOUS_MARKERS.test(command)) {
    return null;
  }

  const stateDir = resolveStateDir();
  const basename = path.basename(stateDir);
  const regex = buildLenientPathRegex(basename);
  const matches = command.matchAll(regex);

  for (const m of matches) {
    const hit = m[0];
    const expanded = expandHomeTokens(hit);
    const abs = resolveTokenPath(expanded, cwd);
    if (!abs) {
      continue;
    }
    if (!isPathInside(stateDir, abs)) {
      continue;
    }
    const violation = policy.check(abs, "read");
    if (violation) {
      return violation;
    }
  }

  return null;
}

function expandHomeTokens(p: string): string {
  // Rewrite $HOME and $USERPROFILE to `~` then defer to expandHomePrefix,
  // which honours ENCLAWS_HOME / HOME / USERPROFILE precedence.
  if (p.startsWith("$HOME/") || p.startsWith("$HOME\\")) {
    return "~" + p.slice("$HOME".length);
  }
  if (p.startsWith("$USERPROFILE/") || p.startsWith("$USERPROFILE\\")) {
    return "~" + p.slice("$USERPROFILE".length);
  }
  return p;
}
