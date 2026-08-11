ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS schedule_status text,
  ADD COLUMN IF NOT EXISTS schedule_activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS passenger_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS driver_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS estimated_distance_meters integer,
  ADD COLUMN IF NOT EXISTS estimated_duration_seconds integer;

ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_schedule_status_check;
ALTER TABLE trips ADD CONSTRAINT trips_schedule_status_check CHECK (
  schedule_status IS NULL OR schedule_status IN (
    'SCHEDULED', 'SCHEDULED_ASSIGNED', 'SCHEDULED_READY', 'ACTIVATED'
  )
);

CREATE TABLE IF NOT EXISTS trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_order smallint NOT NULL CHECK (stop_order BETWEEN 1 AND 3),
  location geography(Point, 4326) NOT NULL,
  reference text NOT NULL,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, stop_order)
);

CREATE TABLE IF NOT EXISTS scheduled_trip_responses (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  accepted boolean NOT NULL,
  responded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, driver_id)
);

ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS scheduled_trip_lead_minutes smallint NOT NULL DEFAULT 10
    CHECK (scheduled_trip_lead_minutes BETWEEN 5 AND 60);

CREATE INDEX IF NOT EXISTS trips_scheduled_dispatch_idx
  ON trips (scheduled_for, schedule_status)
  WHERE scheduled_for IS NOT NULL AND status NOT IN ('COMPLETED', 'CANCELLED');

CREATE INDEX IF NOT EXISTS trip_stops_trip_order_idx
  ON trip_stops (trip_id, stop_order);

