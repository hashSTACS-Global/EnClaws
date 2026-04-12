import { spawn } from "node:child_process";
import { getUserMap } from "../../db/models/user.js";
import { getAppCredential, buildGitAuthEnv } from "../app-installer/credentials-store.js";
import { logWarn } from "../../logger.js";
import type { CodeStep, ExecutionContext, StepOutput } from "./types.js";

/**
 * Phase 1 limitations (to be addressed in Phase 2):
 *
 * - No timeout: a step with an infinite loop will hang the runner. Phase 2
 *   should either adopt `runCommandWithTimeout` from `src/process/exec.ts`
 *   or add a per-step timeout field to the pipeline schema.
 * - stderr on successful exit is discarded. For debugging, APP authors
 *   should use stdout JSON's `output` field or file logging. Phase 2 may
 *   surface stderr via the project logger at debug level.
 * - Command parsing is whitespace-split and does NOT handle quoted args or
 *   paths with spaces. APP authors should use relative `python3 steps/x.py`
 *   style commands, not absolute paths like `C:/Program Files/...`.
 * - Process env is fully inherited via `...process.env`, which leaks host
 *   secrets (API keys, DB URLs) to user-authored step scripts. Phase 2 must
 *   add an env allowlist (PATH, HOME, LANG, TMP, PIVOT_*).
 * - `python3` must be on PATH. On Windows, APP authors who only have
 *   `python.exe` installed should customize their `command:` field.
 */

export async function runCodeStep(step: CodeStep, ctx: ExecutionContext): Promise<StepOutput> {
  const [cmd, ...args] = step.command.split(/\s+/);
  if (!cmd) {
    throw new Error(`code step "${step.name}" has empty command`);
  }

  const stdinPayload = JSON.stringify({
    input: ctx.input,
    steps: Object.fromEntries(Object.entries(ctx.steps).map(([k, v]) => [k, { output: v.output }])),
  });

  // Load user map for pipeline env injection. Failures degrade to empty map
  // so a transient DB issue does not break an otherwise-successful pipeline run.
  let userMapJson = "{}";
  try {
    const userMap = await getUserMap(ctx.tenantId);
    userMapJson = JSON.stringify(userMap);
  } catch (e) {
    logWarn(
      `pipeline-runner: getUserMap(${ctx.tenantId}) failed, using empty map: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // Load git credentials for workspace repo auth (commit + push).
  // Failures degrade to no auth — git operations may fail if the repo requires it.
  let gitAuthEnv: Record<string, string> = {};
  try {
    const cred = await getAppCredential(ctx.tenantId, ctx.appName);
    if (cred) {
      gitAuthEnv = buildGitAuthEnv(cred);
    }
  } catch (e) {
    logWarn(
      `pipeline-runner: getAppCredential(${ctx.tenantId}, ${ctx.appName}) failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ctx.pipelineDir,
      env: {
        ...process.env,
        ...gitAuthEnv,
        PIVOT_WORKSPACE_DIR: ctx.workspaceDir,
        PIVOT_TENANT_ID: ctx.tenantId,
        PIVOT_APP_NAME: ctx.appName,
        PIVOT_USER_MAP: userMapJson,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let settled = false;
    const settleOnce = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      fn();
    };

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      settleOnce(() =>
        reject(new Error(`code step "${step.name}" failed to spawn: ${err.message}`)),
      );
    });
    child.on("close", (code) => {
      settleOnce(() => {
        if (code !== 0) {
          reject(
            new Error(
              `code step "${step.name}" exited with code ${code}\nstderr: ${stderr.trim()}`,
            ),
          );
          return;
        }
        let parsed: { output?: unknown };
        try {
          parsed = JSON.parse(stdout);
        } catch {
          reject(
            new Error(
              `code step "${step.name}" produced invalid JSON on stdout: ${stdout.slice(0, 200)}`,
            ),
          );
          return;
        }
        if (parsed.output === undefined) {
          reject(new Error(`code step "${step.name}" output JSON missing "output" field`));
          return;
        }
        resolve({ output: parsed.output });
      });
    });

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
