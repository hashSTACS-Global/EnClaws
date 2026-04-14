import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveTenantAppsManifestPath } from "../app-paths.js";

export const InstalledAppRecordSchema = z.object({
  name: z.string(),
  gitUrl: z.string(),
  commit: z.string(),
  version: z.string(),
  apiVersion: z.string(),
  installedAt: z.string(),
  workspaceRepo: z.string().optional(),
});
export type InstalledAppRecord = z.infer<typeof InstalledAppRecordSchema>;

export const AppsManifestSchema = z.object({
  version: z.literal(1),
  installed: z.array(InstalledAppRecordSchema),
});
export type AppsManifest = z.infer<typeof AppsManifestSchema>;

export async function readAppsManifest(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppsManifest> {
  const p = resolveTenantAppsManifestPath(tenantId, env);
  try {
    const raw = await readFile(p, "utf8");
    return AppsManifestSchema.parse(JSON.parse(raw));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, installed: [] };
    }
    throw e;
  }
}

export async function writeAppsManifest(
  tenantId: string,
  manifest: AppsManifest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const p = resolveTenantAppsManifestPath(tenantId, env);
  await mkdir(path.dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify(manifest, null, 2), "utf8");
}

export async function addInstalledApp(
  tenantId: string,
  record: InstalledAppRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const manifest = await readAppsManifest(tenantId, env);
  if (manifest.installed.find((r) => r.name === record.name)) {
    throw new Error(`app "${record.name}" already installed for tenant "${tenantId}"`);
  }
  manifest.installed.push(record);
  await writeAppsManifest(tenantId, manifest, env);
}

export async function updateInstalledApp(
  tenantId: string,
  appName: string,
  updates: Partial<Pick<InstalledAppRecord, "workspaceRepo" | "version" | "commit" | "apiVersion">>,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const manifest = await readAppsManifest(tenantId, env);
  const record = manifest.installed.find((r) => r.name === appName);
  if (!record) {
    throw new Error(`app "${appName}" not installed for tenant "${tenantId}"`);
  }
  if (updates.workspaceRepo !== undefined) record.workspaceRepo = updates.workspaceRepo;
  if (updates.version !== undefined) record.version = updates.version;
  if (updates.commit !== undefined) record.commit = updates.commit;
  if (updates.apiVersion !== undefined) record.apiVersion = updates.apiVersion;
  await writeAppsManifest(tenantId, manifest, env);
}

export async function removeInstalledApp(
  tenantId: string,
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const manifest = await readAppsManifest(tenantId, env);
  const idx = manifest.installed.findIndex((r) => r.name === appName);
  if (idx === -1) {
    throw new Error(`app "${appName}" not installed for tenant "${tenantId}"`);
  }
  manifest.installed.splice(idx, 1);
  await writeAppsManifest(tenantId, manifest, env);
}
