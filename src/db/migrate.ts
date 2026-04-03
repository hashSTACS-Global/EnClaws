/**
 * Database migration runner.
 *
 * Usage:
 *   node --import tsx src/db/migrate.ts          # run pending migrations
 *   node --import tsx src/db/migrate.ts --status  # show migration status
 *
 * Supports both PostgreSQL and SQLite based on ENCLAWS_DB_URL.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { initDb, closeDb, withTransaction, query, getDbType, DB_SQLITE } from "./index.js";
import { getSqliteDb, sqliteQuery } from "./sqlite/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

interface MigrationRecord {
  name: string;
  applied_at: Date;
}

async function ensureMigrationsTable(): Promise<void> {
  if (getDbType() === DB_SQLITE) {
    // But ensure it exists in case of fresh db without schema init
    sqliteQuery(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    return;
  }
  await query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id         SERIAL PRIMARY KEY,
      name       VARCHAR(255) NOT NULL UNIQUE,
      applied_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await query<MigrationRecord>("SELECT name FROM _migrations ORDER BY id");
  return new Set(result.rows.map((r) => r.name));
}

function getPendingMigrations(applied: Set<string>): string[] {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  return files.filter((f) => !applied.has(f));
}

async function runMigrations(): Promise<void> {
  initDb();

  // Migrations here are incremental changes applied after the initial schema.
  // Skip 001_init.sql for SQLite since it's PG-specific (schema.sql is the SQLite equivalent).

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();
  let pending = getPendingMigrations(applied);

  if (getDbType() === DB_SQLITE) {
    // Filter out PG-specific migrations
    if (!applied.has("001_init.sql") && pending.includes("001_init.sql")) {
      sqliteQuery("INSERT OR IGNORE INTO _migrations (name) VALUES (?)", ["001_init.sql"]);
      pending = pending.filter((f) => f !== "001_init.sql");
    }

    // Filter out PG-specific migrations (those with PG syntax that won't run on SQLite)
    // 006_user_open_ids_array.sql uses PG array types — skip, already in schema.sql
    // 002_user_channel_id.sql uses PG ALTER TABLE syntax — handled inline below
    const pgOnlyMigrations = new Set(["006_user_open_ids_array.sql", "002_user_channel_id.sql", "004_usage_user_id_text.sql", "006_tenant_agents_tools_skills.sql"]);
    for (const migration of pgOnlyMigrations) {
      if (!applied.has(migration) && pending.includes(migration)) {
        sqliteQuery("INSERT OR IGNORE INTO _migrations (name) VALUES (?)", [migration]);
        pending = pending.filter((f) => f !== migration);
      }
    }

    // Inline SQLite migration: add channel_id to users if missing (for existing DBs)
    const db = getSqliteDb();
    const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!cols.some((c) => c.name === "channel_id")) {
      db.exec("ALTER TABLE users ADD COLUMN channel_id TEXT REFERENCES tenant_channels(id) ON DELETE SET NULL");
      db.exec("CREATE INDEX IF NOT EXISTS idx_users_channel ON users (channel_id)");
      console.log("[migrate]   ✓ SQLite: added channel_id column to users");
    }

    // Inline SQLite migration: add agent_id to tenant_channel_apps if missing
    const appCols = db.prepare("PRAGMA table_info(tenant_channel_apps)").all() as { name: string }[];
    if (!appCols.some((c) => c.name === "agent_id")) {
      db.exec("ALTER TABLE tenant_channel_apps ADD COLUMN agent_id TEXT");
      db.exec("CREATE INDEX IF NOT EXISTS idx_channel_apps_agent ON tenant_channel_apps (agent_id)");
      console.log("[migrate]   ✓ SQLite: added agent_id column to tenant_channel_apps");
    }

    // Inline SQLite migration: add tools and skills columns to tenant_agents if missing
    const agentCols = db.prepare("PRAGMA table_info(tenant_agents)").all() as { name: string }[];
    if (!agentCols.some((c) => c.name === "tools")) {
      db.exec(`ALTER TABLE tenant_agents ADD COLUMN tools TEXT NOT NULL DEFAULT '{"deny":[]}'`);
      console.log("[migrate]   ✓ SQLite: added tools column to tenant_agents");
    }
    if (!agentCols.some((c) => c.name === "skills")) {
      db.exec(`ALTER TABLE tenant_agents ADD COLUMN skills TEXT NOT NULL DEFAULT '{"deny":[]}'`);
      console.log("[migrate]   ✓ SQLite: added skills column to tenant_agents");
    }
  }

  if (pending.length === 0) {
    console.log("[migrate] All migrations already applied.");
    await closeDb();
    return;
  }

  console.log(`[migrate] ${pending.length} pending migration(s):`);

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    console.log(`[migrate]   applying ${file}...`);

    if (getDbType() === DB_SQLITE) {
      const db = getSqliteDb();
      db.exec("BEGIN");
      try {
        db.exec(sql);
        sqliteQuery("INSERT INTO _migrations (name) VALUES (?)", [file]);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    } else {
      await withTransaction(async (client) => {
        await client.query(sql);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [file]);
      });
    }

    console.log(`[migrate]   ✓ ${file}`);
  }

  console.log("[migrate] Done.");
  await closeDb();
}

async function showStatus(): Promise<void> {
  initDb();
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const pending = getPendingMigrations(applied);

  console.log(`[migrate] Applied: ${applied.size}, Pending: ${pending.length}`);
  if (applied.size > 0) {
    console.log("[migrate] Applied migrations:");
    for (const name of applied) {
      console.log(`  ✓ ${name}`);
    }
  }
  if (pending.length > 0) {
    console.log("[migrate] Pending migrations:");
    for (const name of pending) {
      console.log(`  ○ ${name}`);
    }
  }

  await closeDb();
}

// CLI entry
const args = process.argv.slice(2);
if (args.includes("--status")) {
  showStatus().catch((err) => {
    console.error("[migrate] Error:", err);
    process.exit(1);
  });
} else {
  runMigrations().catch((err) => {
    console.error("[migrate] Error:", err);
    process.exit(1);
  });
}
