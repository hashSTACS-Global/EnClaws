import path from "node:path";
import { describe, it, expect } from "vitest";
import {
  resolveAppDir,
  resolveAppWorkspaceDir,
  resolveTenantAppsManifestPath,
  resolveTenantAppsRootDir,
  resolveTenantAppWorkspacesRootDir,
} from "./app-paths.js";

const ENV: NodeJS.ProcessEnv = {
  ENCLAWS_STATE_DIR: path.resolve("/tmp/state"),
  HOME: "/tmp",
};

describe("app-paths", () => {
  it("resolveTenantAppsRootDir → $STATE/tenants/<tid>/apps", () => {
    expect(resolveTenantAppsRootDir("tenant-a", ENV)).toBe(
      path.join(path.resolve("/tmp/state"), "tenants", "tenant-a", "apps"),
    );
  });

  it("resolveAppDir → $STATE/tenants/<tid>/apps/<app>", () => {
    expect(resolveAppDir("tenant-a", "pivot", ENV)).toBe(
      path.join(path.resolve("/tmp/state"), "tenants", "tenant-a", "apps", "pivot"),
    );
  });

  it("resolveTenantAppWorkspacesRootDir → $STATE/tenants/<tid>/app-workspaces", () => {
    expect(resolveTenantAppWorkspacesRootDir("tenant-a", ENV)).toBe(
      path.join(path.resolve("/tmp/state"), "tenants", "tenant-a", "app-workspaces"),
    );
  });

  it("resolveAppWorkspaceDir → $STATE/tenants/<tid>/app-workspaces/<app>", () => {
    expect(resolveAppWorkspaceDir("tenant-a", "pivot", ENV)).toBe(
      path.join(path.resolve("/tmp/state"), "tenants", "tenant-a", "app-workspaces", "pivot"),
    );
  });

  it("resolveTenantAppsManifestPath → $STATE/tenants/<tid>/apps.json", () => {
    expect(resolveTenantAppsManifestPath("tenant-a", ENV)).toBe(
      path.join(path.resolve("/tmp/state"), "tenants", "tenant-a", "apps.json"),
    );
  });
});
