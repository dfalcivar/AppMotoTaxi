CREATE TABLE IF NOT EXISTS user_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  message text NOT NULL,
  notification_type text NOT NULL,
  entity_type text,
  entity_id uuid,
  event_key text,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_notifications_title_length CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT user_notifications_message_length CHECK (char_length(message) BETWEEN 1 AND 500)
);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS route_snapshot jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS user_notifications_event_key_unique
  ON user_notifications (user_id, event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS user_notifications_inbox_idx
  ON user_notifications (user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS user_notifications_unread_idx
  ON user_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS trip_events_passenger_activity_idx
  ON trip_events (trip_id, occurred_at DESC, id DESC);

COMMENT ON COLUMN trips.route_snapshot IS
  'Ruta calculada al crear o reprogramar el viaje, reutilizable en historial sin consumir nuevamente Routes API.';

COMMENT ON TABLE user_notifications IS
  'Avisos persistentes que requieren atención del usuario. No reemplaza trip_events ni audit_log.';
