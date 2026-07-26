ALTER TABLE broadcasts ADD COLUMN queue_locked_at TEXT;
ALTER TABLE broadcasts ADD COLUMN queue_lease_token TEXT;
ALTER TABLE broadcasts ADD COLUMN audience_cursor TEXT;
ALTER TABLE broadcasts ADD COLUMN audience_materialized_at TEXT;
ALTER TABLE messages_log ADD COLUMN broadcast_delivery_id TEXT;

UPDATE broadcasts
SET queue_locked_at =
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours', '-31 minutes') || '+09:00'
WHERE status = 'sending' AND batch_offset = -1;

CREATE TABLE IF NOT EXISTS broadcast_deliveries (
  id                   TEXT PRIMARY KEY,
  broadcast_id         TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  line_account_id      TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'uncertain', 'failed', 'sent', 'manual_review')),
  attempt_count        INTEGER NOT NULL DEFAULT 0,
  retry_key            TEXT NOT NULL,
  retry_key_created_at TEXT NOT NULL,
  first_attempted_at   TEXT,
  last_attempted_at    TEXT,
  sent_at              TEXT,
  last_error           TEXT,
  claim_token          TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL,
  UNIQUE (broadcast_id, friend_id),
  UNIQUE (retry_key)
);

CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_status
  ON broadcast_deliveries (broadcast_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_account_status
  ON broadcast_deliveries (line_account_id, status);
CREATE INDEX IF NOT EXISTS idx_broadcast_deliveries_friend
  ON broadcast_deliveries (friend_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_log_broadcast_delivery
  ON messages_log (broadcast_delivery_id);
