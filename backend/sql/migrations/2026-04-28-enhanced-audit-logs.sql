ALTER TABLE audit_logs
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'SYSTEM',
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'SUCCESS',
  ADD COLUMN IF NOT EXISTS entity_type TEXT,
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS ip_address TEXT,
  ADD COLUMN IF NOT EXISTS user_agent TEXT,
  ADD COLUMN IF NOT EXISTS http_method TEXT,
  ADD COLUMN IF NOT EXISTS route_path TEXT,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_audit_logs_category_created
  ON audit_logs(category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_status_created
  ON audit_logs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON audit_logs(user_id, created_at DESC);
