import { execFile } from "node:child_process";
import { mkdtemp, writeFile, rm, readdir, mkdir, access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it, expect, beforeEach } from "vitest";
import { resolveTenantSkillsDir } from "../../config/sessions/tenant-paths.js";
import { AppInstaller } from "./installer.js";
import { readAppsManifest } from "./store.js";

const execFileP = promisify(execFile);

async function makeFakeAppRepo(): Promise<string> {
  const bare = await mkdtemp(path.join(os.tmpdir(), "app-test-bare-"));
  await execFileP("git", ["init", "--bare", bare]);
  // Set HEAD to main so clones know which branch to check out
  await execFileP("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

  const seed = await mkdtemp(path.join(os.tmpdir(), "app-test-seed-"));
  // mkdtemp created the dir; git clone needs it empty or non-existent
  await rm(seed, { recursive: true, force: true });
  await execFileP("git", ["clone", bare, seed]);
  await execFileP("git", ["-C", seed, "config", "user.email", "t@test.com"]);
  await execFileP("git", ["-C", seed, "config", "user.name", "t"]);
  await execFileP("git", ["-C", seed, "config", "init.defaultBranch", "main"]);
  await execFileP("git", ["-C", seed, "checkout", "-b", "main"]);

  // Create app.json manifest
  const appJson = {
    id: "test-app",
    name: "Test App",
    version: "1.0.0",
    api_version: "1.0",
  };
  await writeFile(path.join(seed, "app.json"), JSON.stringify(appJson, null, 2));

  // Create SKILL.md
  await writeFile(
    path.join(seed, "SKILL.md"),
    `---
name: test-app
description: Test app with skill
---

# Test App

Use app_invoke with pipeline=echo to test.
`,
  );

  await execFileP("git", ["-C", seed, "add", "-A"]);
  await execFileP("git", ["-C", seed, "commit", "-m", "initial"]);
  await execFileP("git", ["-C", seed, "push", "origin", "HEAD:main"]);

  // Cleanup seed
  await rm(seed, { recursive: true, force: true });

  return bare;
}

describe("AppInstaller", () => {
  let fakeAppRepo: string;
  let mockEnv: Record<string, string>;

  beforeEach(async () => {
    fakeAppRepo = await makeFakeAppRepo();
    const stateDir = await mkdtemp(path.join(os.tmpdir(), "app-test-state-"));
    mockEnv = {
      ENCLAWS_STATE_DIR: stateDir,
    };
  });

  it("happy path: installs app from git repo", async () => {
    const installer = new AppInstaller(mockEnv);
    const result = await installer.install({
      tenantId: "tenant-1",
      gitUrl: fakeAppRepo,
    });

    expect(result.name).toBe("test-app");
    expect(result.version).toBe("1.0.0");
    expect(result.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(result.appDir).toContain("test-app");

    // Verify app.json exists
    const appJson = await import("node:fs/promises").then((fs) =>
      fs.readFile(path.join(result.appDir, "app.json"), "utf8"),
    );
    expect(JSON.parse(appJson).id).toBe("test-app");
  });

  it("rejects duplicate install for same tenant", async () => {
    const installer = new AppInstaller(mockEnv);
    await installer.install({
      tenantId: "tenant-1",
      gitUrl: fakeAppRepo,
    });

    // Try to install again
    await expect(
      installer.install({
        tenantId: "tenant-1",
        gitUrl: fakeAppRepo,
      }),
    ).rejects.toThrow('app "test-app" already installed for tenant "tenant-1"');
  });

  it("allows same app across different tenants", async () => {
    const installer = new AppInstaller(mockEnv);
    const result1 = await installer.install({
      tenantId: "tenant-1",
      gitUrl: fakeAppRepo,
    });
    const result2 = await installer.install({
      tenantId: "tenant-2",
      gitUrl: fakeAppRepo,
    });

    expect(result1.name).toBe(result2.name);
    expect(result1.appDir).not.toBe(result2.appDir);
    expect(result1.appDir).toContain("tenant-1");
    expect(result2.appDir).toContain("tenant-2");
  });

  it("uninstall removes app dir and apps.json record", async () => {
    const installer = new AppInstaller(mockEnv);
    const result = await installer.install({
      tenantId: "tenant-1",
      gitUrl: fakeAppRepo,
    });

    // Verify installed app exists
    let manifest = await readAppsManifest("tenant-1", mockEnv);
    expect(manifest.installed).toHaveLength(1);

    await installer.uninstall({
      tenantId: "tenant-1",
      appName: "test-app",
    });

    // Verify app dir gone
    await expect(readdir(result.appDir)).rejects.toThrow();

    // Verify apps.json record gone
    manifest = await readAppsManifest("tenant-1", mockEnv);
    expect(manifest.installed).toHaveLength(0);
  });

  it("uninstall preserves workspace by default, purges on flag", async () => {
    const installer = new AppInstaller(mockEnv);
    await installer.install({
      tenantId: "tenant-1",
      gitUrl: fakeAppRepo,
    });

    // Create fake workspace
    const { resolveAppWorkspaceDir } = await import("../app-paths.js").then((m) => m);
    const wsDir = resolveAppWorkspaceDir("tenant-1", "test-app", mockEnv);
    await mkdir(wsDir, { recursive: true });
    await writeFile(path.join(wsDir, "workspace.txt"), "test data");

    // Uninstall without purge
    await installer.uninstall({
      tenantId: "tenant-1",
      appName: "test-app",
    });

    // Workspace should still exist
    const wsContents = await readdir(wsDir);
    expect(wsContents).toContain("workspace.txt");

    // Reinstall and then uninstall with purge
    await installer.install({
      tenantId: "tenant-1",
      gitUrl: fakeAppRepo,
    });

    await installer.uninstall({
      tenantId: "tenant-1",
      appName: "test-app",
      purgeWorkspace: true,
    });

    // Workspace should be gone
    await expect(readdir(wsDir)).rejects.toThrow();
  });

  it("cleans up when app.json is invalid (rollback path)", async () => {
    // Create a fake repo with invalid app.json
    const bare = await mkdtemp(path.join(os.tmpdir(), "bad-app-bare-"));
    await execFileP("git", ["init", "--bare", bare]);
    await execFileP("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

    const seed = await mkdtemp(path.join(os.tmpdir(), "bad-app-seed-"));
    await rm(seed, { recursive: true, force: true });
    await execFileP("git", ["clone", bare, seed]);
    await execFileP("git", ["-C", seed, "config", "user.email", "t@t.com"]);
    await execFileP("git", ["-C", seed, "config", "user.name", "t"]);

    // Write app.json with MISSING api_version (will fail zod validation)
    await writeFile(
      path.join(seed, "app.json"),
      JSON.stringify({ id: "bad-app", name: "Bad", version: "0.1.0" }),
    );
    await execFileP("git", ["-C", seed, "add", "-A"]);
    await execFileP("git", ["-C", seed, "commit", "-m", "initial"]);
    await execFileP("git", ["-C", seed, "push", "origin", "HEAD:main"]);

    const installer = new AppInstaller(mockEnv);
    await expect(installer.install({ tenantId: "tenant-a", gitUrl: bare })).rejects.toThrow(
      /api_version|Invalid app.json/,
    );

    // Verify no residue: no app dir, no .install-* leftover
    const { resolveAppDir } = await import("../app-paths.js").then((m) => m);
    const appDir = resolveAppDir("tenant-a", "bad-app", mockEnv);
    await expect(access(appDir)).rejects.toThrow();

    // Verify no tmp install dirs left behind in the apps root
    const stateDir = mockEnv.ENCLAWS_STATE_DIR || "";
    const appsRoot = path.join(stateDir, "tenants", "tenant-a", "apps");
    let leftover: string[] = [];
    try {
      leftover = (await readdir(appsRoot)).filter((n) => n.startsWith(".install-"));
    } catch {
      // apps root may not exist — fine
    }
    expect(leftover).toHaveLength(0);
  });

  it("cleans up when git clone fails (rollback path)", async () => {
    const installer = new AppInstaller(mockEnv);
    await expect(
      installer.install({
        tenantId: "tenant-a",
        gitUrl: "/nonexistent/path/definitely-not-a-repo.git",
      }),
    ).rejects.toThrow();

    // Verify no residue — apps root may or may not exist; if it does, no .install-* dirs
    const stateDir = mockEnv.ENCLAWS_STATE_DIR || "";
    const appsRoot = path.join(stateDir, "tenants", "tenant-a", "apps");
    let leftover: string[] = [];
    try {
      leftover = (await readdir(appsRoot)).filter((n) => n.startsWith(".install-"));
    } catch {
      // dir doesn't exist — that's fine, no leftover
    }
    expect(leftover).toHaveLength(0);
  });

  it("install copies SKILL.md to tenant skills directory", async () => {
    const installer = new AppInstaller(mockEnv);
    await installer.install({ tenantId: "tenant-a", gitUrl: fakeAppRepo });

    const skillPath = path.join(
      resolveTenantSkillsDir("tenant-a", mockEnv),
      "test-app",
      "SKILL.md",
    );
    const content = await readFile(skillPath, "utf8");
    expect(content).toContain("Test App");
    expect(content).toContain("app_invoke");
  });

  it("uninstall removes the skill directory for the app", async () => {
    const installer = new AppInstaller(mockEnv);
    await installer.install({ tenantId: "tenant-a", gitUrl: fakeAppRepo });
    await installer.uninstall({ tenantId: "tenant-a", appName: "test-app" });

    const skillDir = path.join(resolveTenantSkillsDir("tenant-a", mockEnv), "test-app");
    await expect(access(skillDir)).rejects.toThrow();
  });

  it("install silently skips if APP has no SKILL.md", async () => {
    const bare = await mkdtemp(path.join(os.tmpdir(), "app-nosk-bare-"));
    await execFileP("git", ["init", "--bare", bare]);
    await execFileP("git", ["-C", bare, "symbolic-ref", "HEAD", "refs/heads/main"]);

    const seed = await mkdtemp(path.join(os.tmpdir(), "app-nosk-seed-"));
    await rm(seed, { recursive: true, force: true });
    await execFileP("git", ["clone", bare, seed]);
    await execFileP("git", ["-C", seed, "config", "user.email", "t@test.com"]);
    await execFileP("git", ["-C", seed, "config", "user.name", "t"]);
    await execFileP("git", ["-C", seed, "checkout", "-b", "main"]);
    await writeFile(
      path.join(seed, "app.json"),
      JSON.stringify({
        id: "no-skill-app",
        name: "No Skill",
        version: "0.1.0",
        api_version: "v0.3",
      }),
    );
    await mkdir(path.join(seed, "pipelines", "echo"), { recursive: true });
    await writeFile(
      path.join(seed, "pipelines", "echo", "pipeline.yaml"),
      `name: echo
description: echo
input: {}
steps:
  - name: p
    type: code
    command: python3 steps/p.py
output: p
`,
    );
    await execFileP("git", ["-C", seed, "add", "-A"]);
    await execFileP("git", ["-C", seed, "commit", "-m", "initial"]);
    await execFileP("git", ["-C", seed, "push", "origin", "HEAD:main"]);

    const installer = new AppInstaller(mockEnv);
    await expect(installer.install({ tenantId: "tenant-a", gitUrl: bare })).resolves.toBeDefined();

    const skillDir = path.join(resolveTenantSkillsDir("tenant-a", mockEnv), "no-skill-app");
    await expect(access(skillDir)).rejects.toThrow();
  });
});
