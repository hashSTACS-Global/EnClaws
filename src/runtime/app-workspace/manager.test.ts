import { mkdtemp, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach } from "vitest";
import { AppWorkspaceManager } from "./manager.js";

describe("AppWorkspaceManager", () => {
  let stateDir: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    stateDir = await mkdtemp(path.join(os.tmpdir(), "app-ws-test-"));
    env = { ...process.env, ENCLAWS_STATE_DIR: stateDir };
  });

  it("ensures a workspace directory at the canonical tenant-scoped path", async () => {
    const wm = new AppWorkspaceManager(env);
    const wsDir = await wm.ensure("tenant-a", "pivot");
    expect(wsDir).toBe(path.join(stateDir, "tenants", "tenant-a", "app-workspaces", "pivot"));
    await access(wsDir);
  });

  it("isolates different tenants into different directories", async () => {
    const wm = new AppWorkspaceManager(env);
    const a = await wm.ensure("tenant-a", "pivot");
    const b = await wm.ensure("tenant-b", "pivot");
    expect(a).not.toBe(b);
  });

  it("isolates different apps under the same tenant", async () => {
    const wm = new AppWorkspaceManager(env);
    const pivotWs = await wm.ensure("tenant-a", "pivot");
    const otherWs = await wm.ensure("tenant-a", "other-app");
    expect(pivotWs).not.toBe(otherWs);
  });

  it("resolve() returns the path without creating the directory", () => {
    const wm = new AppWorkspaceManager(env);
    const ws = wm.resolve("tenant-a", "pivot");
    expect(ws).toContain("app-workspaces");
    expect(ws).toContain("pivot");
  });
});
