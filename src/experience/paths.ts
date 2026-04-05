import path from "node:path";

const SEPARATOR = "--";

/** sessionKey → 文件名：':' 替换为 '--'，加 .json 扩展名 */
export function sessionKeyToFilename(sessionKey: string): string {
  return sessionKey.replaceAll(":", SEPARATOR) + ".json";
}

/** 文件名 → sessionKey：'--' 还原为 ':'，去掉 .json 扩展名 */
export function filenameToSessionKey(filename: string): string {
  const base = filename.endsWith(".json") ? filename.slice(0, -5) : filename;
  return base.replaceAll(SEPARATOR, ":");
}

/** 解析用户 workspace 下的 candidates 目录路径 */
export function resolveCandidatesDir(workspaceDir: string): string {
  return path.join(workspaceDir, "experience", "candidates");
}

/** 解析指定 sessionKey 的 candidate 文件完整路径 */
export function resolveCandidateFilePath(workspaceDir: string, sessionKey: string): string {
  return path.join(resolveCandidatesDir(workspaceDir), sessionKeyToFilename(sessionKey));
}

/** 租户级 distilled 目录 */
export function resolveDistilledDir(tenantDir: string): string {
  return path.join(tenantDir, "experience", "distilled");
}

/** 按日期归档的 distilled 文件路径 */
export function resolveDistilledFilePath(tenantDir: string, dateStr: string): string {
  return path.join(resolveDistilledDir(tenantDir), `${dateStr}.json`);
}
