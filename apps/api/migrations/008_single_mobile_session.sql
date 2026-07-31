ALTER TABLE users
  ADD COLUMN IF NOT EXISTS active_session_id uuid;

CREATE INDEX IF NOT EXISTS users_active_session_idx
  ON users (id, active_session_id)
  WHERE active_session_id IS NOT NULL;
