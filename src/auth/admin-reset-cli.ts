/**
 * CLI rescue: regenerate the password for a platform-admin or owner account.
 *
 * Usage:
 *   node --import tsx src/auth/admin-reset-cli.ts --email admin@example.com
 *   node --import tsx src/auth/admin-reset-cli.ts --email owner@x.com --tenant my-tenant
 *
 * Reads ENCLAWS_DB_URL (or ENCLAWS_DB_HOST etc.) from the environment.
 *
 * The generated password is printed to stdout exactly once and never
 * persisted in plain text.  The target user is marked
 * `force_change_password = 1`, so the next login forces an immediate change.
 */

import { loadDotEnv } from "../infra/dotenv.js";
import { initDb, closeDb, isDbInitialized, query, getDbType, DB_SQLITE } from "../db/index.js";
import { generateTempPassword } from "./password-policy.js";
import { hashPassword } from "./password.js";
import { revokeAllUserTokens } from "./jwt.js";
import { createAuditLog } from "../db/models/audit-log.js";

loadDotEnv({ quiet: true });

interface CliArgs {
  email?: string;
  tenant?: string;
  help?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--email" || a === "-e") out.email = argv[++i];
    else if (a === "--tenant" || a === "-t") out.tenant = argv[++i];
  }
  return out;
}

function printUsage(): void {
  process.stderr.write(
    "Usage: enclaws admin-reset-password --email <email> [--tenant <slug>]\n" +
    "\n" +
    "  Generates a new temporary password for a platform-admin or owner account\n" +
    "  and prints it to stdout. The user must change it on next login.\n" +
    "\n" +
    "Options:\n" +
    "  --email, -e   Account email address (required)\n" +
    "  --tenant, -t  Tenant slug (required when the same email exists in multiple tenants)\n" +
    "  --help, -h    Show this help message\n",
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.email) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  initDb();
  if (!isDbInitialized()) {
    console.error("admin-reset: ENCLAWS_DB_URL is not configured; nothing to do.");
    process.exit(1);
  }

  const isSqlite = getDbType() === DB_SQLITE;
  const nowExpr = isSqlite ? "datetime('now')" : "NOW()";
  const email = args.email.toLowerCase().trim();

  let userRow: Record<string, unknown> | undefined;
  if (args.tenant) {
    const result = await query(
      `SELECT u.id, u.tenant_id, u.email, u.role
         FROM users u JOIN tenants t ON u.tenant_id = t.id
        WHERE u.email = $1 AND t.slug = $2 AND u.status = 'active'
        LIMIT 1`,
      [email, args.tenant],
    );
    userRow = result.rows[0];
  } else {
    const result = await query(
      `SELECT id, tenant_id, email, role FROM users
        WHERE email = $1 AND status = 'active'
          AND role IN ('platform-admin','owner')
        LIMIT 2`,
      [email],
    );
    if (result.rows.length > 1) {
      console.error(
        `admin-reset: email "${email}" is registered in multiple tenants; pass --tenant <slug> to disambiguate.`,
      );
      await closeDb();
      process.exit(1);
    }
    userRow = result.rows[0];
  }

  if (!userRow) {
    console.error(`admin-reset: no active platform-admin / owner found for email "${email}".`);
    await closeDb();
    process.exit(1);
  }

  const role = String(userRow.role);
  if (role !== "platform-admin" && role !== "owner") {
    console.error(`admin-reset: refusing to reset role="${role}" — only platform-admin / owner are supported.`);
    await closeDb();
    process.exit(1);
  }

  const userId = String(userRow.id);
  const tenantId = String(userRow.tenant_id);

  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  await query(
    `UPDATE users SET password_hash = $1, password_changed_at = ${nowExpr}, force_change_password = 1, updated_at = ${nowExpr} WHERE id = $2`,
    [hash, userId],
  );
  await revokeAllUserTokens(userId);
  await createAuditLog({
    tenantId,
    userId,
    action: "user.password.cli_reset",
    detail: { trigger: "admin-reset-cli" },
  }).catch(() => undefined);

  process.stdout.write(
    `\n` +
    `===========================================================\n` +
    ` ENCLAWS admin-reset — temporary password generated\n` +
    `===========================================================\n` +
    `   email:    ${email}\n` +
    `   role:     ${role}\n` +
    `   password: ${tempPassword}\n` +
    `   note:     user must change this password on first login.\n` +
    `===========================================================\n\n`,
  );

  await closeDb();
}

main().catch((err) => {
  console.error("admin-reset: failed:", err instanceof Error ? err.message : String(err));
  void closeDb();
  process.exit(1);
});
