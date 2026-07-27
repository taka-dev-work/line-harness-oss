CREATE TABLE IF NOT EXISTS ai_concierge_settings (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL UNIQUE REFERENCES line_accounts(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  service_name TEXT NOT NULL DEFAULT '',
  service_description TEXT NOT NULL DEFAULT '',
  pricing TEXT NOT NULL DEFAULT '',
  target_audience TEXT NOT NULL DEFAULT '',
  related_urls_json TEXT NOT NULL DEFAULT '[]',
  related_keywords_json TEXT NOT NULL DEFAULT '[]',
  provider_order_json TEXT NOT NULL DEFAULT '["openai","anthropic","gemini"]',
  off_topic_message TEXT NOT NULL DEFAULT 'このサービスに関するご質問のみお答えできます。',
  provider_error_message TEXT NOT NULL DEFAULT 'ただいま回答を生成できません。時間をおいて再度お試しください。',
  context_ttl_minutes INTEGER NOT NULL DEFAULT 30,
  max_history_messages INTEGER NOT NULL DEFAULT 6,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_concierge_faqs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_concierge_sessions (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
  last_relevant_at TEXT NOT NULL,
  recent_messages_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (line_account_id, friend_id)
);

CREATE TABLE IF NOT EXISTS ai_concierge_logs (
  id TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends(id) ON DELETE SET NULL,
  decision TEXT NOT NULL CHECK (decision IN ('relevant', 'off_topic', 'disabled')),
  decision_reasons_json TEXT NOT NULL DEFAULT '[]',
  provider TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  latency_ms INTEGER,
  fallback_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_concierge_faqs_account
  ON ai_concierge_faqs (line_account_id, active, sort_order);
CREATE INDEX IF NOT EXISTS idx_ai_concierge_sessions_expiry
  ON ai_concierge_sessions (line_account_id, status, expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_concierge_logs_account_created
  ON ai_concierge_logs (line_account_id, created_at DESC);
