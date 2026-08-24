ALTER TABLE trips ADD COLUMN IF NOT EXISTS client_request_id text;

CREATE UNIQUE INDEX IF NOT EXISTS trips_passenger_client_request_uidx
  ON trips(passenger_id, client_request_id) WHERE client_request_id IS NOT NULL;

ALTER TABLE driver_offers ADD COLUMN IF NOT EXISTS response_reason text;
ALTER TABLE driver_offers DROP CONSTRAINT IF EXISTS driver_offers_response_reason_check;
ALTER TABLE driver_offers ADD CONSTRAINT driver_offers_response_reason_check CHECK (
  response_reason IS NULL OR response_reason IN (
    'ACCEPTED','DRIVER_REJECTED','OFFER_EXPIRED','TAKEN_BY_ANOTHER_DRIVER',
    'DRIVER_BUSY','PASSENGER_CANCELLED','TRIP_NO_LONGER_AVAILABLE',
    'DRIVER_CANCELLED_AFTER_ACCEPTANCE'
  )
);

UPDATE driver_offers SET response_reason = CASE
  WHEN accepted = true THEN 'ACCEPTED'
  WHEN responded_at IS NOT NULL AND expires_at <= responded_at THEN 'OFFER_EXPIRED'
  WHEN responded_at IS NOT NULL THEN 'TRIP_NO_LONGER_AVAILABLE'
  ELSE response_reason END
WHERE response_reason IS NULL;

CREATE TABLE IF NOT EXISTS trip_driver_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  trip_status trip_status NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN (
    'VEHICLE_PROBLEM','PERSONAL_EMERGENCY','CANNOT_REACH_PICKUP',
    'PASSENGER_CONTACT_ISSUE','OTHER'
  )),
  observation text,
  idempotency_key text NOT NULL UNIQUE,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reason_code <> 'OTHER' OR length(trim(coalesce(observation,''))) >= 3)
);

CREATE INDEX IF NOT EXISTS trip_driver_cancellations_trip_idx
  ON trip_driver_cancellations(trip_id, cancelled_at DESC);
