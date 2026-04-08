import fs from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { normalizeUpdateTrack, type UpdateTrack } from "./update-channels.js";

const UPDATE_SETTINGS_FILENAME = "update-settings.json";

export type UpdateSettings = {
  track?: UpdateTrack;
  checkOnStart?: boolean;
  auto?: {
    enabled?: boolean;
    stableDelayHours?: number;
    stableJitterHours?: number;
    betaCheckIntervalHours?: number;
  };
};

export async function readUpdateSettings(): Promise<UpdateSettings> {
  const settingsPath = path.join(resolveStateDir(), UPDATE_SETTINGS_FILENAME);
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as UpdateSettings;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function writeUpdateSettings(settings: UpdateSettings): Promise<void> {
  const settingsPath = path.join(resolveStateDir(), UPDATE_SETTINGS_FILENAME);
  await fs.mkdir(path.dirname(settingsPath), { recursive: true });
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf-8");
}

export async function patchUpdateSettings(patch: Partial<UpdateSettings>): Promise<void> {
  const current = await readUpdateSettings();
  await writeUpdateSettings({ ...current, ...patch });
}

/** Detect if running from a git checkout. */
async function isGitInstall(): Promise<boolean> {
  try {
    // Check if the project root (two levels up from this file) has a .git directory
    const root = path.resolve(resolveStateDir(), "..");
    await fs.stat(path.join(root, ".git"));
    return true;
  } catch {
    // Also check via process.cwd()
    try {
      await fs.stat(path.join(process.cwd(), ".git"));
      return true;
    } catch {
      return false;
    }
  }
}

/** Ensure update-settings.json exists with defaults. Called on gateway startup. */
export async function ensureUpdateSettings(): Promise<UpdateSettings> {
  const settingsPath = path.join(resolveStateDir(), UPDATE_SETTINGS_FILENAME);
  try {
    const raw = await fs.readFile(settingsPath, "utf-8");
    const parsed = JSON.parse(raw) as UpdateSettings;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
  } catch {
    // File doesn't exist or is invalid — create with defaults
  }
  const isGit = await isGitInstall();
  const defaults: UpdateSettings = isGit
    ? {
        track: "dev",
        checkOnStart: true,
      }
    : {
        track: "stable",
        checkOnStart: true,
        auto: {
          enabled: false,
          stableDelayHours: 6,
          stableJitterHours: 12,
          betaCheckIntervalHours: 1,
        },
      };
  await writeUpdateSettings(defaults);
  return defaults;
}

/** Returns the effective stored track: env var > settings file > null */
export async function getStoredUpdateTrack(): Promise<UpdateTrack | null> {
  const envTrack = normalizeUpdateTrack(process.env.ENCLAWS_UPDATE_TRACK);
  if (envTrack) {
    return envTrack;
  }
  const settings = await readUpdateSettings();
  return normalizeUpdateTrack(settings.track) ?? null;
}
