/**
 * tenant-boundary-guard — canonical-path alias check layered on top of
 * PathPermissionPolicy.
 *
 * PathPermissionPolicy.check() is purely lexical (string prefix match). A
 * symlink/junction inside a permitted directory can point outside the
 * allow-list OR to a file with different permissions. This guard resolves
 * the target to its canonical path and re-runs the full policy check on it.
 *
 * Three outcomes, all correct:
 *   • canonical is inside another allowed rule with matching ops  → allowed
 *     (e.g. `workspace/link-to-tools` → TOOLS.md for read is fine)
 *   • canonical is inside a rule but the op is not permitted      → blocked
 *     (e.g. symlink → READ_ONLY TOOLS.md but the caller asked for write)
 *   • canonical matches no rule (escape)                          → blocked
 *     (e.g. symlink → /etc/passwd)
 *
 * Scope: only symlink/junction resolution. We deliberately do NOT check
 * hard-link counts (nlink > 1) — on many filesystems (docker overlay,
 * btrfs/zfs dedup, backup tools) legitimate files carry nlink > 1 and
 * blocking them produces severe false positives. Hardlink creation by AI
 * tools is independently constrained (fs.writeFile does not create links;
 * `exec ln` is gated by state-dir-guard + exec approval).
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { isNotFoundPathError } from "./path-guards.js";
import type { PathOp, PathPermissionPolicy } from "./path-permission-policy.js";

/**
 * Walk the path segment-by-segment and return true if any segment is a
 * symlink (including junctions on Windows). Missing segments are skipped.
 *
 * This is the precise signal for "alias resolution will actually happen" —
 * more robust than comparing `realpath(p) !== path.resolve(p)`, which can
 * fire false positives on Windows 8.3 short-name / long-name normalisation.
 */
async function hasSymlinkInChain(p: string): Promise<boolean> {
  let cursor = path.resolve(p);
  while (true) {
    try {
      const stat = await fsp.lstat(cursor);
      if (stat.isSymbolicLink()) {
        return true;
      }
    } catch (err) {
      if (!isNotFoundPathError(err)) {
        throw err;
      }
      // segment missing — keep climbing to check ancestors
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return false;
    }
    cursor = parent;
  }
}

/**
 * Resolve a path's canonical form, tolerating non-existent leaves.
 * Walks up to the first existing ancestor, realpaths it, and re-joins the
 * missing tail. This handles the "create new file" case.
 */
async function canonicalize(p: string): Promise<string> {
  const abs = path.resolve(p);
  let cursor = abs;
  const missing: string[] = [];
  while (true) {
    try {
      const real = await fsp.realpath(cursor);
      return missing.length === 0 ? real : path.resolve(real, ...missing);
    } catch (err) {
      if (!isNotFoundPathError(err)) {
        throw err;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        return abs;
      }
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Resolve absolutePath to its canonical form and re-run the policy check on
 * the real target. Returns null if allowed, or a human-readable [SECURITY]
 * denial reason otherwise.
 *
 * Caller must have already invoked policy.check() on the lexical path and
 * passed it — this guard's job is only to catch what the lexical check
 * cannot see through symlinks/junctions.
 *
 * When canonical === lexical (no alias resolved), the re-check is a cheap
 * no-op that returns null (since the lexical check already passed).
 */
export async function assertPolicyBoundary(params: {
  policy: PathPermissionPolicy;
  absolutePath: string;
  op: PathOp;
  content?: string;
}): Promise<string | null> {
  try {
    const canonical = await canonicalize(params.absolutePath);
    const lexical = path.resolve(params.absolutePath);
    if (canonical === lexical) {
      // No symlink/junction resolution happened — lexical check was enough.
      return null;
    }
    const verdict = params.policy.check(canonical, params.op, params.content);
    if (verdict === null) {
      return null;
    }
    // Prefix with a symlink-specific marker so the AI (and logs) know the
    // denial came from alias resolution, not the original lexical check.
    return (
      `[SECURITY] Path '${lexical}' resolves via symlink/junction to '${canonical}', ` +
      `which is not permitted: ${verdict}`
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return (
      `[SECURITY] Could not verify path boundary: ${detail}. ` +
      `This is a hard security restriction — do NOT attempt alternative approaches.`
    );
  }
}
