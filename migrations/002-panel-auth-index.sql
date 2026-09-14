-- Pit-Stop panel auth migration (idempotent).
-- One-time code and session records use SHA-256 hashes as feature_records.id;
-- plaintext codes and session tokens are never persisted.
CREATE INDEX IF NOT EXISTS feature_records_kind_updated
  ON feature_records(kind, updated_at DESC);
