/**
 * Database connection layer — supports PostgreSQL and SQLite.
 *
 * Detection logic:
 *   - OPENCLAW_DB_URL starting with "postgres://" or "postgresql://" → PostgreSQL
 *   - OPENCLAW_DB_URL starting with "sqlite://" → SQLite
 *   - No OPENCLAW_DB_URL but OPENCLAW_DB_HOST present → PostgreSQL
 *   - Neither → not initialized
 *
 * Environment variables (PostgreSQL):
 *   OPENCLAW_DB_URL          - Full connection URL (takes precedence)
 *   OPENCLAW_DB_HOST         - Database host (default: localhost)
 *   OPENCLAW_DB_PORT         - Database port (default: 5432)
 *   OPENCLAW_DB_NAME         - Database name (default: openclaw)
 *   OPENCLAW_DB_USER         - Database user (default: openclaw)
 *   OPENCLAW_DB_PASSWORD     - Database password
 *   OPENCLAW_DB_SSL          - Enable SSL (default: false)
 *   OPENCLAW_DB_POOL_MAX     - Max pool connections (default: 20)
 *
 * Environment variables (SQLite):
 *   OPENCLAW_DB_URL          - sqlite:///path/to/data.db
 */

import pg from "pg";
import { initSqliteDb, closeSqliteDb, sqliteQuery, withSqliteTransaction } from "./sqlite/index.js";
import type { SqliteQueryResult } from "./sqlite/index.js";

const { Pool } = pg;

export type DbType = "postgres" | "sqlite";
export const DB_POSTGRES: DbType = "postgres";
export const DB_SQLITE: DbType = "sqlite";
export type DbPool = pg.Pool;
export type DbClient = pg.PoolClient;

let pool: DbPool | null = null;
let dbType: DbType | null = null;

export interface DbConfig {
  connectionString?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  ssl?: boolean | object;
  max?: number;
}

/**
 * Get the active database type. Throws if not initialized.
 */
export function getDbType(): DbType {
  if (!dbType) throw new Error("[db] Database not initialized. Call initDb() first.");
  return dbType;
}

function resolveDbConfig(): DbConfig {
  const url = process.env.OPENCLAW_DB_URL;
  if (url) {
    return {
      connectionString: url,
      max: parseInt(process.env.OPENCLAW_DB_POOL_MAX || "20", 10),
    };
  }
  return {
    host: process.env.OPENCLAW_DB_HOST || "localhost",
    port: parseInt(process.env.OPENCLAW_DB_PORT || "5432", 10),
    database: process.env.OPENCLAW_DB_NAME || "openclaw",
    user: process.env.OPENCLAW_DB_USER || "openclaw",
    password: process.env.OPENCLAW_DB_PASSWORD || "",
    ssl: process.env.OPENCLAW_DB_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: parseInt(process.env.OPENCLAW_DB_POOL_MAX || "20", 10),
  };
}

/**
 * Initialize the database connection. Safe to call multiple times.
 */
export function initDb(overrides?: DbConfig): DbPool | null {
  if (dbType) return pool;

  const url = process.env.OPENCLAW_DB_URL ?? "";

  if (url.startsWith("sqlite://")) {
    dbType = DB_SQLITE;
    initSqliteDb(url);
    return null;
  }

  // PostgreSQL path
  dbType = DB_POSTGRES;
  const config = { ...resolveDbConfig(), ...overrides };
  pool = new Pool(config);

  pool.on("error", (err) => {
    console.error("[db] unexpected pool error:", err.message);
  });

  return pool;
}

/**
 * Get the active PostgreSQL pool. Throws if not initialized or if using SQLite.
 */
export function getDb(): DbPool {
  if (!pool) {
    if (dbType === DB_SQLITE) {
      throw new Error("[db] getDb() is not available in SQLite mode. Use query() instead.");
    }
    throw new Error("[db] Database pool not initialized. Call initDb() first.");
  }
  return pool;
}

/**
 * Check if the database is initialized.
 */
export function isDbInitialized(): boolean {
  return dbType !== null;
}

/**
 * Close the database connection gracefully.
 */
export async function closeDb(): Promise<void> {
  if (dbType === DB_SQLITE) {
    closeSqliteDb();
    dbType = null;
    return;
  }
  if (pool) {
    await pool.end();
    pool = null;
    dbType = null;
  }
}

/**
 * Run a query with automatic client acquisition and release.
 * Routes to PostgreSQL or SQLite based on the active database type.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<pg.QueryResult<T>> {
  if (dbType === DB_SQLITE) {
    const result = sqliteQuery<T>(text, values);
    // Return a pg.QueryResult-compatible shape
    return result as unknown as pg.QueryResult<T>;
  }
  const db = getDb();
  return db.query<T>(text, values);
}

/**
 * Run a callback within a transaction.
 */
export async function withTransaction<T>(
  fn: (client: DbClient) => Promise<T>,
): Promise<T> {
  if (dbType === DB_SQLITE) {
    // SQLite transactions are synchronous. Wrap the async fn for compatibility.
    // We use a thin adapter that makes sqliteQuery look like a client.
    return withSqliteTransaction((client) => {
      // Create a proxy DbClient-like object
      const fakeClient = {
        query: (text: string, vals?: unknown[]) => {
          const result = client.query(text, vals);
          return Promise.resolve(result);
        },
        release: () => {},
      } as unknown as DbClient;
      // Run the async function synchronously — this works because
      // SQLite operations are synchronous within node:sqlite.
      // The async wrapper is for interface compatibility.
      let resolved: T;
      let rejected: unknown;
      const promise = fn(fakeClient);
      // Since sqliteQuery is synchronous, the promise should resolve immediately
      promise.then(
        (v) => { resolved = v; },
        (e) => { rejected = e; },
      );
      if (rejected !== undefined) throw rejected;
      return resolved!;
    });
  }
  const db = getDb();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
