import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { resolveTenantAppsManifestPath } from "../app-paths.js";
import { readAppsManifest, addInstalledApp, removeInstalledApp } from "./store.js";

describe("apps.json store", () => {
  let stateDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(os.tmpdir(), "apps-store-"));
    env = { ...process.env, ENCLAWS_STATE_DIR: stateDir };
  });

  const sampleRecord = {
    name: "pivot",
    gitUrl: "https://example.com/pivot.git",
    commit: "abc123",
    version: "0.1.0",
    apiVersion: "v0.3",
    installedAt: "2026-04-11T18:00:00+08:00",
  };

  it("readAppsManifest returns empty manifest when file missing", async () => {
    const m = await readAppsManifest("tenant-a", env);
    expect(m.version).toBe(1);
    expect(m.installed).toEqual([]);
  });

  it("addInstalledApp persists a record to apps.json", async () => {
    await addInstalledApp("tenant-a", sampleRecord, env);
    const m = await readAppsManifest("tenant-a", env);
    expect(m.installed).toHaveLength(1);
    expect(m.installed[0].name).toBe("pivot");

    const filePath = resolveTenantAppsManifestPath("tenant-a", env);
    const raw = await readFile(filePath, "utf8");
    expect(JSON.parse(raw).installed[0].commit).toBe("abc123");
  });

  it("addInstalledApp rejects duplicate name", async () => {
    await addInstalledApp("tenant-a", sampleRecord, env);
    await expect(addInstalledApp("tenant-a", sampleRecord, env)).rejects.toThrow(
      /already installed/,
    );
  });

  it("removeInstalledApp deletes by name", async () => {
    await addInstalledApp("tenant-a", sampleRecord, env);
    await removeInstalledApp("tenant-a", "pivot", env);
    const m = await readAppsManifest("tenant-a", env);
    expect(m.installed).toHaveLength(0);
  });

  it("removeInstalledApp throws when name not found", async () => {
    await expect(removeInstalledApp("tenant-a", "ghost", env)).rejects.toThrow(/not installed/);
  });
});
