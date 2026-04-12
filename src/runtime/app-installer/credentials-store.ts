import { readFile, writeFile, mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { resolveStateDir } from "../../config/paths.js";

const AppCredentialRecordSchema = z.object({
  gitToken: z.string(),
  gitUser: z.string(),
  gitEmail: z.string(),
});
export type AppCredentialRecord = z.infer<typeof AppCredentialRecordSchema>;

const CredentialsFileSchema = z.object({
  version: z.literal(1),
  apps: z.record(z.string(), AppCredentialRecordSchema),
});
type CredentialsFile = z.infer<typeof CredentialsFileSchema>;

function resolveCredentialsPath(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveStateDir(env), "tenants", tenantId, "app-credentials.json");
}

async function readCredentialsFile(
  tenantId: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<CredentialsFile> {
  const filePath = resolveCredentialsPath(tenantId, env);
  try {
    const raw = await readFile(filePath, "utf-8");
    return CredentialsFileSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, apps: {} };
  }
}

async function writeCredentialsFile(
  tenantId: string,
  data: CredentialsFile,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const filePath = resolveCredentialsPath(tenantId, env);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2), "utf-8");
  // Best-effort restrictive permissions (no-op on Windows)
  await chmod(filePath, 0o600).catch(() => {});
}

export async function getAppCredential(
  tenantId: string,
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AppCredentialRecord | null> {
  const data = await readCredentialsFile(tenantId, env);
  return data.apps[appName] ?? null;
}

export async function setAppCredential(
  tenantId: string,
  appName: string,
  record: AppCredentialRecord,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const data = await readCredentialsFile(tenantId, env);
  data.apps[appName] = record;
  await writeCredentialsFile(tenantId, data, env);
}

export async function clearAppCredential(
  tenantId: string,
  appName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const data = await readCredentialsFile(tenantId, env);
  delete data.apps[appName];
  await writeCredentialsFile(tenantId, data, env);
}

/**
 * Build env vars that inject Git HTTPS auth + committer identity into any
 * child process that runs `git`. Works cross-platform (Windows/Linux/macOS)
 * via Git's GIT_CONFIG_COUNT mechanism (Git >= 2.31).
 */
export function buildGitAuthEnv(cred: AppCredentialRecord): Record<string, string> {
  const basicAuth = Buffer.from(`${cred.gitUser}:${cred.gitToken}`).toString("base64");
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basicAuth}`,
    GIT_AUTHOR_NAME: cred.gitUser,
    GIT_COMMITTER_NAME: cred.gitUser,
    GIT_AUTHOR_EMAIL: cred.gitEmail,
    GIT_COMMITTER_EMAIL: cred.gitEmail,
    GIT_TERMINAL_PROMPT: "0",
  };
}
