ALTER TABLE pricing_versions
  ADD COLUMN IF NOT EXISTS stop_surcharge_cents integer NOT NULL DEFAULT 0
    CHECK (stop_surcharge_cents >= 0);

ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS scheduled_trip_minimum_notice_minutes smallint NOT NULL DEFAULT 30
    CHECK (scheduled_trip_minimum_notice_minutes BETWEEN 5 AND 720);
