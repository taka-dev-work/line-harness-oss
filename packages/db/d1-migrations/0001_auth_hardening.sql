-- Staff API keys are stored hashed; keep the last 4 chars for display.
ALTER TABLE staff_members ADD COLUMN api_key_hint TEXT;

-- Audit log of authenticated changes (no request bodies, query strings or headers).
CREATE TABLE IF NOT EXISTS audit_logs (
  id           TEXT PRIMARY KEY,
  staff_id     TEXT NOT NULL,
  staff_name   TEXT NOT NULL,
  role         TEXT NOT NULL,
  access_email TEXT,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status       INTEGER NOT NULL,
  ip           TEXT,
  created_at   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
