import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createAppApiHandlers } from "../../gateway/server-methods/app-api.js";
import { AppInstaller } from "../app-installer/installer.js";
import { readAppsManifest } from "../app-installer/store.js";
import { resolveAppDir, resolveAppWorkspaceDir } from "../app-paths.js";
import { TenantAppRegistry } from "../tenant-app-registry/registry.js";

const execFileP = promisify(execFile);

async function makeFakePivotRepo(): Promise<string> {
  const bare = await mkdtemp(path.join(os.tmpdir(), "e2e-pivot-bare-"));
  await execFileP("git", ["init", "--bare", bare]);
  // Windows fix: bare repo HEAD defaults to refs/heads/master; we push to main
  await execFileP("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const seed = await mkdtemp(path.join(os.tmpdir(), "e2e-pivot-seed-"));
  await rm(seed, { recursive: true, force: true });
  await execFileP("git", ["clone", bare, seed]);
  await execFileP("git", ["-C", seed, "config", "user.email", "t@test.com"]);
  await execFileP("git", ["-C", seed, "config", "user.name", "t"]);
  await execFileP("git", ["-C", seed, "checkout", "-b", "main"]);

  // app.json
  await writeFile(
    path.join(seed, "app.json"),
    JSON.stringify({
      id: "fake-pivot",
      name: "Fake Pivot",
      version: "0.1.0",
      api_version: "v0.3",
    }),
  );

  // echo pipeline with code step
  await mkdir(path.join(seed, "pipelines", "echo-pipeline", "steps"), {
    recursive: true,
  });
  await writeFile(
    path.join(seed, "pipelines", "echo-pipeline", "pipeline.yaml"),
    `name: echo
description: echo pipeline
input:
  message: string
steps:
  - name: prepare
    type: code
    command: python3 steps/prepare.py
output: prepare
`,
  );
  await writeFile(
    path.join(seed, "pipelines", "echo-pipeline", "steps", "prepare.py"),
    `#!/usr/bin/env python3
import json, sys
data = json.loads(sys.stdin.read())
msg = data.get("input", {}).get("message", "")
print(json.dumps({"output": {"uppercased": msg.upper()}}))
`,
  );

  await execFileP("git", ["-C", seed, "add", "-A"]);
  await execFileP("git", ["-C", seed, "commit", "-m", "initial"]);
  await execFileP("git", ["-C", seed, "push", "origin", "HEAD:main"]);
  return bare;
}

describe("E2E: install → invoke → uninstall", () => {
  let stateDir: string;
  let env: NodeJS.ProcessEnv;
  let fakeRepo: string;
  let originalStateDir: string | undefined;

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(os.tmpdir(), "e2e-state-"));
    originalStateDir = process.env.ENCLAWS_STATE_DIR;
    process.env.ENCLAWS_STATE_DIR = stateDir;
    env = { ...process.env };
    fakeRepo = await makeFakePivotRepo();
  });

  afterEach(() => {
    if (originalStateDir === undefined) {
      delete process.env.ENCLAWS_STATE_DIR;
    } else {
      process.env.ENCLAWS_STATE_DIR = originalStateDir;
    }
  });

  it("full lifecycle: install → invoke → uninstall (workspace preserved)", async () => {
    const installer = new AppInstaller(env);
    const registry = new TenantAppRegistry(env);
    const mockCallProvider = vi.fn(); // not used by this pipeline
    const handlers = createAppApiHandlers({
      registry,
      installer,
      llmDeps: { callProvider: mockCallProvider },
      env,
    });

    const client = { tenant: { tenantId: "tenant-a" } } as unknown as {
      tenant: { tenantId: string };
    };

    // 1. install
    const installResult = (await handlers["app.install"]({
      params: { gitUrl: fakeRepo },
      client,
    } as never)) as { name: string; version: string };
    expect(installResult).toEqual({ name: "fake-pivot", version: "0.1.0" });

    // 2. list
    const listResult = (await handlers["app.list"]({ client } as never)) as {
      apps: Array<{ name: string; pipelines: string[] }>;
    };
    expect(listResult.apps).toHaveLength(1);
    expect(listResult.apps[0].name).toBe("fake-pivot");
    expect(listResult.apps[0].pipelines).toEqual(["echo"]);

    // 3. invoke echo pipeline (real code step, no LLM)
    const invokeResult = (await handlers["app.invoke"]({
      params: {
        app: "fake-pivot",
        pipeline: "echo",
        params: { message: "hello world" },
      },
      client,
    } as never)) as { uppercased: string };
    expect(invokeResult).toEqual({ uppercased: "HELLO WORLD" });

    // 4. simulate business data in workspace (Pipeline would have written this)
    const wsDir = resolveAppWorkspaceDir("tenant-a", "fake-pivot", env);
    await writeFile(path.join(wsDir, "business.md"), "data");

    // 5. uninstall without purgeWorkspace → apps.json cleared, apps/ deleted, workspace kept
    await handlers["app.uninstall"]({
      params: { name: "fake-pivot" },
      client,
    } as never);

    const manifestAfter = await readAppsManifest("tenant-a", env);
    expect(manifestAfter.installed).toHaveLength(0);

    const appDir = resolveAppDir("tenant-a", "fake-pivot", env);
    await expect(access(appDir)).rejects.toThrow();

    await access(path.join(wsDir, "business.md")); // preserved
  });
});
