-- Add pivot_token support for CLI/API access (Phase 1.1 §8.4)
ALTER TABLE users ADD COLUMN pivot_token VARCHAR(255);
ALTER TABLE users ADD COLUMN pivot_token_expires_at TIMESTAMPTZ;
CREATE INDEX idx_users_pivot_token ON users (pivot_token) WHERE pivot_token IS NOT NULL;
