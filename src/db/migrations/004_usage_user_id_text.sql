-- Change usage_records.user_id from UUID (with FK) to VARCHAR(512).
-- Reason: tenantUserId may be a non-UUID identifier (e.g. EnClaws session key)
-- rather than a users.id UUID, so we store it as a plain varchar reference.
ALTER TABLE usage_records DROP CONSTRAINT IF EXISTS usage_records_user_id_fkey;
ALTER TABLE usage_records ALTER COLUMN user_id TYPE VARCHAR(255);
