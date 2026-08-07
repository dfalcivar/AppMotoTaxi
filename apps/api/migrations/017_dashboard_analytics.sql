ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz;

CREATE INDEX IF NOT EXISTS trips_dashboard_requested_idx
  ON trips (requested_at DESC, status, service_zone);

CREATE INDEX IF NOT EXISTS trips_dashboard_driver_idx
  ON trips (driver_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS trips_dashboard_scheduled_idx
  ON trips (scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS driver_offers_dashboard_idx
  ON driver_offers (trip_id, driver_id, offered_at, responded_at);

CREATE INDEX IF NOT EXISTS trip_events_dashboard_arrival_idx
  ON trip_events (trip_id, occurred_at)
  WHERE to_status = 'DRIVER_ARRIVED';
