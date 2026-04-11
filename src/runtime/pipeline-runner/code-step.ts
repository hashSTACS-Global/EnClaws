import { spawn } from "node:child_process";
import type { CodeStep, ExecutionContext, StepOutput } from "./types.js";

export async function runCodeStep(step: CodeStep, ctx: ExecutionContext): Promise<StepOutput> {
  const [cmd, ...args] = step.command.split(/\s+/);
  if (!cmd) {
    throw new Error(`code step "${step.name}" has empty command`);
  }

  const stdinPayload = JSON.stringify({
    input: ctx.input,
    steps: Object.fromEntries(Object.entries(ctx.steps).map(([k, v]) => [k, { output: v.output }])),
  });

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: ctx.pipelineDir,
      env: {
        ...process.env,
        PIVOT_WORKSPACE_DIR: ctx.workspaceDir,
        PIVOT_TENANT_ID: ctx.tenantId,
        PIVOT_APP_NAME: ctx.appName,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });

    child.on("error", (err) => {
      reject(new Error(`code step "${step.name}" failed to spawn: ${err.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`code step "${step.name}" exited with code ${code}\nstderr: ${stderr}`));
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

    child.stdin.write(stdinPayload);
    child.stdin.end();
  });
}
