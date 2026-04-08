#!/usr/bin/env node

/**
 * postinstall script for enclaws.
 *
 * Runs after `npm install -g enclaws` to generate a working
 * ~/.enclaws/.env with sensible defaults so the gateway starts
 * out of the box. Skips if .env already exists (never overwrites).
 *
 * Zero dependencies — uses only Node built-ins.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Extract node_modules.tar (created by build-installer.ps1 to speed up install)
// ---------------------------------------------------------------------------
const appDir = join(import.meta.dirname, "..");
const tarPath = join(appDir, "node_modules.tar");

if (existsSync(tarPath) && !existsSync(join(appDir, "node_modules"))) {
  console.log("[enclaws] Extracting node_modules...");
  execSync(`tar -xf "${tarPath}"`, { cwd: appDir, stdio: "inherit" });
  unlinkSync(tarPath);
  console.log("[enclaws] node_modules extracted.");
}

const stateDir = join(homedir(), ".enclaws");
const envPath = join(stateDir, ".env");

if (existsSync(envPath)) {
  // Never overwrite user config
  process.exit(0);
}

const dbPath = join(stateDir, "data.db").replace(/\\/g, "/");

// Resolve the bundled skill-pack directory (lives next to scripts/ in the package)
const skillPackDir = join(appDir, "skills-pack").replace(/\\/g, "/");

// Use project's .env.example as template (assumed to exist)
const projectEnvPath = join(appDir, ".env.example");
let content = readFileSync(projectEnvPath, "utf-8");
// Replace template ENCLAWS_DB_URL with absolute path (template may contain a relative placeholder)
const dbUrl = `sqlite://${dbPath}`;
if (/^ENCLAWS_DB_URL=/m.test(content)) {
  content = content.replace(/^ENCLAWS_DB_URL=.*$/m, `ENCLAWS_DB_URL=${dbUrl}`);
} else {
  content += `\nENCLAWS_DB_URL=${dbUrl}`;
}
// Replace empty placeholder (from .env.example) or append if missing entirely
if (/^SKILL_PACK_LOCAL_DIR=/m.test(content)) {
  content = content.replace(/^SKILL_PACK_LOCAL_DIR=.*$/m, `SKILL_PACK_LOCAL_DIR=${skillPackDir}`);
} else {
  content += `\nSKILL_PACK_LOCAL_DIR=${skillPackDir}`;
}

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(envPath, content, "utf-8");
  console.log(`[enclaws] Config created: ${envPath}`);
} catch (err) {
  console.warn(`[enclaws] Could not create ${envPath}:`, err.message);
}
