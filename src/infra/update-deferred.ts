/**
 * Deferred update for Windows npm mode.
 *
 * On Windows, npm cannot rename the package directory while the gateway process
 * holds file locks. This module creates a temporary script that:
 * 1. Waits for the gateway process to exit
 * 2. Runs npm install -g to update the package
 * 3. Restarts the gateway with the same arguments
 *
 * The script is spawned detached so it outlives the parent process.
 */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";

export interface DeferredUpdateOptions {
  /** npm install spec, e.g. "enclaws@latest" */
  spec: string;
  /** Package manager: npm, pnpm, or bun */
  manager: "npm" | "pnpm" | "bun";
  /** Gateway port to wait for release */
  port: number;
  /** Current process PID to wait for exit */
  pid: number;
  /** Full command to restart gateway */
  restartCommand: string[];
  /** Working directory for restart */
  cwd: string;
}

function buildBatScript(opts: DeferredUpdateOptions): string {
  const installCmd =
    opts.manager === "pnpm"
      ? `pnpm add -g ${opts.spec}`
      : opts.manager === "bun"
        ? `bun add -g ${opts.spec}`
        : `npm i -g ${opts.spec} --no-fund --no-audit --loglevel=error`;

  const restartCmd = opts.restartCommand.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");

  return `@echo off
echo [enclaws-update] Waiting for gateway process (PID ${opts.pid}) to exit...
:wait_pid
tasklist /FI "PID eq ${opts.pid}" 2>nul | findstr /I "${opts.pid}" >nul
if not errorlevel 1 (
  timeout /t 1 /nobreak >nul
  goto wait_pid
)
echo [enclaws-update] Gateway process exited. Running update...
${installCmd}
if errorlevel 1 (
  echo [enclaws-update] Update failed, retrying with --omit=optional...
  ${installCmd} --omit=optional
)
echo [enclaws-update] Update complete. Restarting gateway...
cd /d "${opts.cwd}"
start "" ${restartCmd}
echo [enclaws-update] Done.
del "%~dp0update-deferred.vbs" 2>nul
del "%~f0"
`;
}

function buildShScript(opts: DeferredUpdateOptions): string {
  const installCmd =
    opts.manager === "pnpm"
      ? `pnpm add -g ${opts.spec}`
      : opts.manager === "bun"
        ? `bun add -g ${opts.spec}`
        : `npm i -g ${opts.spec} --no-fund --no-audit --loglevel=error`;

  const restartCmd = opts.restartCommand.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ");

  return `#!/bin/bash
echo "[enclaws-update] Waiting for gateway process (PID ${opts.pid}) to exit..."
while kill -0 ${opts.pid} 2>/dev/null; do sleep 1; done
echo "[enclaws-update] Gateway process exited. Running update..."
${installCmd} || ${installCmd} --omit=optional
echo "[enclaws-update] Update complete. Restarting gateway..."
cd "${opts.cwd}"
nohup ${restartCmd} > /dev/null 2>&1 &
echo "[enclaws-update] Done."
rm -f "$0"
`;
}

export async function spawnDeferredUpdate(opts: DeferredUpdateOptions): Promise<{ scriptPath: string }> {
  const isWindows = process.platform === "win32";
  const ext = isWindows ? ".bat" : ".sh";
  const script = isWindows ? buildBatScript(opts) : buildShScript(opts);

  const stateDir = resolveStateDir();
  await fs.mkdir(stateDir, { recursive: true });
  const scriptPath = path.join(stateDir, `update-deferred${ext}`);
  await fs.writeFile(scriptPath, script, "utf-8");

  if (!isWindows) {
    await fs.chmod(scriptPath, 0o755);
  }

  if (isWindows) {
    // Use a VBS wrapper to run the .bat hidden (cmd.exe ignores windowsHide)
    const vbsPath = path.join(stateDir, "update-deferred.vbs");
    const vbsContent = `CreateObject("Wscript.Shell").Run """${scriptPath.replace(/\\/g, "\\\\")}""", 0, False`;
    await fs.writeFile(vbsPath, vbsContent, "utf-8");
    const child = spawn("wscript.exe", [vbsPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
  } else {
    const child = spawn("/bin/bash", [scriptPath], {
      cwd: opts.cwd,
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  return { scriptPath };
}
