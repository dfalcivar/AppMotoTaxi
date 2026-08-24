ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS driver_search_initial_radius_meters integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS driver_search_radius_increment_meters integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS driver_search_round_wait_seconds integer NOT NULL DEFAULT 15;

UPDATE operational_settings
SET driver_search_initial_radius_meters = LEAST(driver_search_initial_radius_meters, search_radius_meters);

ALTER TABLE operational_settings
  DROP CONSTRAINT IF EXISTS operational_settings_driver_search_initial_radius_check,
  ADD CONSTRAINT operational_settings_driver_search_initial_radius_check
    CHECK (driver_search_initial_radius_meters BETWEEN 100 AND 20000),
  DROP CONSTRAINT IF EXISTS operational_settings_driver_search_increment_check,
  ADD CONSTRAINT operational_settings_driver_search_increment_check
    CHECK (driver_search_radius_increment_meters BETWEEN 100 AND 20000),
  DROP CONSTRAINT IF EXISTS operational_settings_driver_search_round_wait_check,
  ADD CONSTRAINT operational_settings_driver_search_round_wait_check
    CHECK (driver_search_round_wait_seconds BETWEEN 5 AND 300),
  DROP CONSTRAINT IF EXISTS operational_settings_driver_search_bounds_check,
  ADD CONSTRAINT operational_settings_driver_search_bounds_check
    CHECK (driver_search_initial_radius_meters <= search_radius_meters);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS driver_search_round integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_search_lower_meters integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_search_upper_meters integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS driver_search_next_round_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_search_finished_at timestamptz;

ALTER TABLE driver_offers
  ADD COLUMN IF NOT EXISTS search_round integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS distance_meters integer,
  ADD COLUMN IF NOT EXISTS notification_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS trips_progressive_search_due_idx
  ON trips (driver_search_next_round_at, requested_at)
  WHERE status = 'SEARCHING';

CREATE INDEX IF NOT EXISTS driver_offers_unsent_notification_idx
  ON driver_offers (offered_at)
  WHERE notification_sent_at IS NULL AND responded_at IS NULL;
