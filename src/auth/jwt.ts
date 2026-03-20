/**
 * JWT token management for multi-tenant auth.
 *
 * Environment variables:
 *   OPENCLAW_JWT_SECRET            - Secret key for signing tokens (required)
 *   OPENCLAW_JWT_ACCESS_EXPIRES    - Access token TTL (default: "15m")
 *   OPENCLAW_JWT_REFRESH_EXPIRES   - Refresh token TTL (default: "7d")
 */

import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import type { JwtPayload, JwtTokenPair } from "../db/types.js";
import { query, getDbType, DB_SQLITE } from "../db/index.js";

function getSecret(): string {
  const secret = process.env.OPENCLAW_JWT_SECRET;
  if (!secret) {
    throw new Error("[auth] OPENCLAW_JWT_SECRET environment variable is required");
  }
  return secret;
}

function getAccessExpires(): string {
  return process.env.OPENCLAW_JWT_ACCESS_EXPIRES ?? "15m";
}

function getRefreshExpires(): string {
  return process.env.OPENCLAW_JWT_REFRESH_EXPIRES ?? "7d";
}

function parseExpiresIn(expr: string): number {
  const match = expr.match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 900; // default 15 minutes
  const num = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return num;
    case "m": return num * 60;
    case "h": return num * 3600;
    case "d": return num * 86400;
    default: return 900;
  }
}

/**
 * Generate an access + refresh token pair.
 */
export async function generateTokenPair(payload: JwtPayload): Promise<JwtTokenPair> {
  const secret = getSecret();
  const accessExpiresExpr = getAccessExpires();
  const refreshExpiresExpr = getRefreshExpires();

  const accessToken = jwt.sign(payload, secret, {
    expiresIn: parseExpiresIn(accessExpiresExpr),
    issuer: "openclaw",
    audience: "openclaw-api",
  });

  // Refresh token is an opaque random string stored in DB
  const refreshToken = crypto.randomBytes(48).toString("base64url");
  const refreshTokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  const refreshExpiresInSeconds = parseExpiresIn(refreshExpiresExpr);
  const expiresAt = new Date(Date.now() + refreshExpiresInSeconds * 1000);

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [payload.sub, refreshTokenHash, expiresAt],
  );

  return {
    accessToken,
    refreshToken,
    expiresIn: parseExpiresIn(accessExpiresExpr),
  };
}

/**
 * Verify and decode an access token.
 */
export function verifyAccessToken(token: string): JwtPayload {
  const secret = getSecret();
  const decoded = jwt.verify(token, secret, {
    issuer: "openclaw",
    audience: "openclaw-api",
  });
  return decoded as JwtPayload;
}

/**
 * Verify a refresh token and return the associated user ID.
 * Consumes the refresh token (one-time use rotation).
 */
export async function verifyRefreshToken(
  refreshToken: string,
): Promise<{ userId: string } | null> {
  const tokenHash = crypto
    .createHash("sha256")
    .update(refreshToken)
    .digest("hex");

  const now = getDbType() === DB_SQLITE ? "datetime('now')" : "NOW()";
  const result = await query(
    `UPDATE refresh_tokens
     SET revoked = true
     WHERE token_hash = $1 AND revoked = false AND expires_at > ${now}
     RETURNING user_id`,
    [tokenHash],
  );

  if (result.rows.length === 0) return null;
  return { userId: result.rows[0].user_id as string };
}

/**
 * Revoke all refresh tokens for a user (e.g., on password change or logout-all).
 */
export async function revokeAllUserTokens(userId: string): Promise<void> {
  await query(
    "UPDATE refresh_tokens SET revoked = true WHERE user_id = $1 AND revoked = false",
    [userId],
  );
}

/**
 * Clean up expired refresh tokens (call periodically).
 */
export async function cleanupExpiredTokens(): Promise<number> {
  const now = getDbType() === DB_SQLITE ? "datetime('now')" : "NOW()";
  const result = await query(
    `DELETE FROM refresh_tokens WHERE expires_at < ${now} OR revoked = true`,
  );
  return result.rowCount ?? 0;
}
