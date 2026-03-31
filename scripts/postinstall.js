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

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const stateDir = join(homedir(), ".enclaws");
const envPath = join(stateDir, ".env");

if (existsSync(envPath)) {
  // Never overwrite user config
  process.exit(0);
}

const jwtSecret = randomBytes(32).toString("hex");
const dbPath = join(stateDir, "data.db").replace(/\\/g, "/");

const content = `# EnClaws — auto-generated at install time
# Edit freely. This file is never overwritten by reinstall / upgrade.

OPENCLAW_DB_URL=sqlite:///${dbPath}
OPENCLAW_JWT_SECRET=${jwtSecret}
OPENCLAW_GATEWAY_PORT=18888
OPENCLAW_CONTROL_UI_DISABLE_DEVICE_AUTH=true
OPENCLAW_CONTROL_UI_ALLOWED_ORIGINS=http://localhost:18888,http://127.0.0.1:18888
`;

try {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(envPath, content, "utf-8");
  console.log(`[enclaws] Config created: ${envPath}`);
} catch (err) {
  console.warn(`[enclaws] Could not create ${envPath}:`, err.message);
}
