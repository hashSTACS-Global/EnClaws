/**
 * ExecPathPolicy — gate shell/exec commands through PathPermissionPolicy.
 *
 * Bridges exec-style tools (Bash, process) to the same path allowlist that
 * already protects read/write/edit tools. Parses argv out of the command
 * string, resolves literal path tokens against the exec cwd, and invokes
 * policy.check() for any token landing inside the enclaws state directory.
 *
 * Two modes:
 *   - strict   (default on Linux)  — shell-quote AST + per-token analysis.
 *   - lenient  (default elsewhere) — regex scan for state-dir path literals.
 *
 * Design principle: confident-parse-only. Any parse ambiguity (variables,
 * subshells, globs) is silently skipped. The goal is zero false-positives
 * on legitimate commands; evasion via variables is mitigated by defense in
 * depth (system prompt + L2 path policy on the read tool).
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
}): string | null {
  const { command, cwd, policy } = args;
  if (!command || !cwd) {
    return null;
  }
  if (!mentionsStateDir(command)) {
    return null;
  }

  const platform = args.platform ?? process.platform;
  return platform === "linux"
    ? strictCheck(command, cwd, policy)
    : lenientCheck(command, cwd, policy);
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

function strictCheck(command: string, cwd: string, policy: PathPermissionPolicy): string | null {
  let parsed: ParseEntry[];
  try {
    parsed = shellParse(command) as ParseEntry[];
  } catch {
    return null;
  }

  const stateDir = resolveStateDir();
  let subshellDepth = 0;

  for (const token of parsed) {
    // Subshell tracking: `$(...)` expands to tokens `$`, `{op:"("}`, …, `{op:")"}`.
    // Anything inside the parens runs in a subshell whose cwd/env we cannot see,
    // so skip those tokens entirely (confident-parse-only principle).
    if (typeof token === "object" && token !== null && "op" in token) {
      const op = (token as { op: string }).op;
      if (op === "(") {
        subshellDepth++;
      } else if (op === ")") {
        subshellDepth = Math.max(0, subshellDepth - 1);
      }
      continue;
    }

    if (subshellDepth > 0) {
      continue;
    }

    // Non-string tokens (glob objects, variable refs) → skip.
    if (typeof token !== "string") {
      continue;
    }

    // String literals containing $ or backtick → skip (partial expansion).
    if (AMBIGUOUS_STRING_MARKERS.test(token)) {
      continue;
    }

    const extracted = extractPathFromToken(token);
    if (!extracted) {
      continue;
    }

    const abs = resolveTokenPath(extracted, cwd);
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

function extractPathFromToken(token: string): string | null {
  // Handle VAR=<value> assignments — use the RHS if it is a literal path.
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
