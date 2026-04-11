import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { addInstalledApp } from "../app-installer/store.js";
import { resolveAppDir } from "../app-paths.js";
import { TenantAppRegistry } from "./registry.js";

async function seedApp(env: NodeJS.ProcessEnv, tenantId: string, appName: string): Promise<void> {
  const appDir = resolveAppDir(tenantId, appName, env);
  await mkdir(path.join(appDir, "pipelines", "echo-pipeline"), {
    recursive: true,
  });
  await writeFile(
    path.join(appDir, "app.json"),
    JSON.stringify({
      id: appName,
      name: appName,
      version: "0.1.0",
      api_version: "v0.3",
    }),
  );
  await writeFile(
    path.join(appDir, "pipelines", "echo-pipeline", "pipeline.yaml"),
    `name: echo
description: echo pipeline
input: {}
steps:
  - name: prepare
    type: code
    command: python3 steps/prepare.py
output: prepare
`,
  );
  await addInstalledApp(
    tenantId,
    {
      name: appName,
      gitUrl: "https://example.com/fake.git",
      commit: "a".repeat(40),
      version: "0.1.0",
      apiVersion: "v0.3",
      installedAt: "2026-04-11T00:00:00+08:00",
    },
    env,
  );
}

describe("TenantAppRegistry", () => {
  let stateDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(os.tmpdir(), "tenant-app-reg-"));
    env = { ...process.env, ENCLAWS_STATE_DIR: stateDir };
  });

  it("loadTenant loads all apps listed in apps.json", async () => {
    await seedApp(env, "tenant-a", "pivot");
    await seedApp(env, "tenant-a", "monitor");
    const reg = new TenantAppRegistry(env);
    await reg.loadTenant("tenant-a");
    expect(reg.listApps("tenant-a").toSorted()).toEqual(["monitor", "pivot"]);
    expect(reg.getPipeline("tenant-a", "pivot", "echo")?.name).toBe("echo");
  });

  it("loadAll scans all tenants under STATE/tenants/", async () => {
    await seedApp(env, "tenant-a", "pivot");
    await seedApp(env, "tenant-b", "pivot");
    const reg = new TenantAppRegistry(env);
    await reg.loadAll();
    expect(reg.listApps("tenant-a")).toEqual(["pivot"]);
    expect(reg.listApps("tenant-b")).toEqual(["pivot"]);
  });

  it("loadOne adds a single APP incrementally", async () => {
    const reg = new TenantAppRegistry(env);
    await reg.loadTenant("tenant-a"); // empty — no apps.json yet
    expect(reg.listApps("tenant-a")).toEqual([]);
    await seedApp(env, "tenant-a", "pivot");
    await reg.loadOne("tenant-a", "pivot");
    expect(reg.getPipeline("tenant-a", "pivot", "echo")).toBeDefined();
  });

  it("remove deletes a single APP from the registry", async () => {
    await seedApp(env, "tenant-a", "pivot");
    const reg = new TenantAppRegistry(env);
    await reg.loadTenant("tenant-a");
    reg.remove("tenant-a", "pivot");
    expect(reg.getPipeline("tenant-a", "pivot", "echo")).toBeUndefined();
  });

  it("getPipeline returns undefined for unknown tenant/app/pipeline", () => {
    const reg = new TenantAppRegistry(env);
    expect(reg.getPipeline("nobody", "nothing", "nope")).toBeUndefined();
  });
});
