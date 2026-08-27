ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS trip_tracking_grace_minutes integer NOT NULL DEFAULT 45,
  ADD COLUMN IF NOT EXISTS support_whatsapp_country_code text NOT NULL DEFAULT '593',
  ADD COLUMN IF NOT EXISTS support_whatsapp_number text,
  ADD COLUMN IF NOT EXISTS support_whatsapp_enabled boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operational_settings_trip_tracking_grace_check'
  ) THEN
    ALTER TABLE operational_settings
      ADD CONSTRAINT operational_settings_trip_tracking_grace_check
      CHECK (trip_tracking_grace_minutes BETWEEN 30 AND 60);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS trip_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL UNIQUE REFERENCES trips(id) ON DELETE CASCADE,
  public_reference text NOT NULL UNIQUE,
  access_token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS trip_share_links_token_active_idx
  ON trip_share_links(access_token) WHERE revoked_at IS NULL;
