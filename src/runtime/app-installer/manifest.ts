import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export const AppManifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, "id must be a lowercase slug"),
  name: z.string().min(1),
  version: z.string().min(1),
  api_version: z.string().min(1),
  description: z.string().optional(),
  workspace_repo: z.string().optional(),
  workspace_branch: z.string().optional(),
});
export type AppManifest = z.infer<typeof AppManifestSchema>;

export async function readAppManifest(appDir: string): Promise<AppManifest> {
  const manifestPath = path.join(appDir, "app.json");
  const raw = await readFile(manifestPath, "utf8");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${manifestPath}: ${(e as Error).message}`, {
      cause: e,
    });
  }
  try {
    return AppManifestSchema.parse(json);
  } catch (e) {
    throw new Error(`Invalid app.json at ${manifestPath}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}
