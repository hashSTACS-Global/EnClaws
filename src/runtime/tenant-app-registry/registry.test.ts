import { mkdir, writeFile } from "node:fs/promises";
import { mkdtemp } from "node:fs/promises";
import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TenantAppRegistry } from "./registry.js";

describe("TenantAppRegistry", () => {
  let tmpDir: string;
  let stateDir: string;
  let registry: TenantAppRegistry;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(os.tmpdir(), "tenant-registry-"));
    stateDir = tmpDir;
    registry = new TenantAppRegistry();
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  const setupTestTenant = async (tenantId: string, apps: string[]) => {
    const tenantAppsDir = path.join(stateDir, "tenants", tenantId, "apps");
    await mkdir(tenantAppsDir, { recursive: true });

    // Create apps.json manifest
    const manifest = {
      version: 1,
      installed: apps.map((appName) => ({
        name: appName,
        gitUrl: `https://example.com/${appName}`,
        commit: "abc123",
        version: "1.0.0",
        apiVersion: "v1",
        installedAt: new Date().toISOString(),
      })),
    };
    const manifestPath = path.join(stateDir, "tenants", tenantId, "apps.json");
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));

    // Create app directories with pipelines
    for (const appName of apps) {
      const appDir = path.join(tenantAppsDir, appName);
      await mkdir(path.join(appDir, "pipelines", "test-pipeline"), {
        recursive: true,
      });

      // Create app.json
      await writeFile(
        path.join(appDir, "app.json"),
        JSON.stringify({
          id: appName.toLowerCase().replace(/\s+/g, "-"),
          name: appName,
          version: "1.0.0",
          api_version: "v1",
        }),
      );

      // Create pipeline.yaml
      const pipelineYaml = `name: test-pipeline
description: test pipeline
input: {}
steps:
  - name: step1
    type: code
    command: echo test
output: result
`;
      await writeFile(
        path.join(appDir, "pipelines", "test-pipeline", "pipeline.yaml"),
        pipelineYaml,
      );
    }
  };

  it("loadTenant loads all apps and their pipelines for a tenant", async () => {
    // Mock the env for resolveAppDir and readAppsManifest
    const originalEnv = process.env.ENCLAWS_STATE_DIR;
    process.env.ENCLAWS_STATE_DIR = stateDir;

    try {
      await setupTestTenant("tenant-1", ["app-a", "app-b"]);
      await registry.loadTenant("tenant-1");

      const appA = registry.loadOne("tenant-1", "app-a");
      const appB = registry.loadOne("tenant-1", "app-b");

      expect(appA).toBeDefined();
      expect(appB).toBeDefined();
      expect(appA?.get("test-pipeline")).toBeDefined();
      expect(appB?.get("test-pipeline")).toBeDefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ENCLAWS_STATE_DIR;
      } else {
        process.env.ENCLAWS_STATE_DIR = originalEnv;
      }
    }
  });

  it("loadAll loads multiple tenants", async () => {
    const originalEnv = process.env.ENCLAWS_STATE_DIR;
    process.env.ENCLAWS_STATE_DIR = stateDir;

    try {
      await setupTestTenant("tenant-1", ["app-a"]);
      await setupTestTenant("tenant-2", ["app-b"]);

      await registry.loadAll(["tenant-1", "tenant-2"]);

      const tenant1AppA = registry.loadOne("tenant-1", "app-a");
      const tenant2AppB = registry.loadOne("tenant-2", "app-b");

      expect(tenant1AppA).toBeDefined();
      expect(tenant2AppB).toBeDefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ENCLAWS_STATE_DIR;
      } else {
        process.env.ENCLAWS_STATE_DIR = originalEnv;
      }
    }
  });

  it("loadOne returns a specific app registry", async () => {
    const originalEnv = process.env.ENCLAWS_STATE_DIR;
    process.env.ENCLAWS_STATE_DIR = stateDir;

    try {
      await setupTestTenant("tenant-1", ["app-a", "app-b"]);
      await registry.loadTenant("tenant-1");

      const appA = registry.loadOne("tenant-1", "app-a");
      expect(appA).toBeDefined();
      expect(appA?.get("test-pipeline")).toBeDefined();

      const nonexistent = registry.loadOne("tenant-1", "nonexistent");
      expect(nonexistent).toBeUndefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ENCLAWS_STATE_DIR;
      } else {
        process.env.ENCLAWS_STATE_DIR = originalEnv;
      }
    }
  });

  it("remove deletes a tenant's app registry", async () => {
    const originalEnv = process.env.ENCLAWS_STATE_DIR;
    process.env.ENCLAWS_STATE_DIR = stateDir;

    try {
      await setupTestTenant("tenant-1", ["app-a"]);
      await registry.loadTenant("tenant-1");

      expect(registry.loadOne("tenant-1", "app-a")).toBeDefined();

      registry.remove("tenant-1");
      expect(registry.loadOne("tenant-1", "app-a")).toBeUndefined();
    } finally {
      if (originalEnv === undefined) {
        delete process.env.ENCLAWS_STATE_DIR;
      } else {
        process.env.ENCLAWS_STATE_DIR = originalEnv;
      }
    }
  });

  it("getPipeline returns undefined for unknown pipeline", async () => {
    const result = registry.getPipeline(
      "nonexistent-tenant",
      "nonexistent-app",
      "nonexistent-pipeline",
    );
    expect(result).toBeUndefined();
  });
});
