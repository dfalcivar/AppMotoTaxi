CREATE TABLE trip_live_locations (
  trip_id uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  position geography(Point, 4326) NOT NULL,
  bearing numeric(6, 2),
  speed_mps numeric(8, 2),
  accuracy_meters numeric(8, 2),
  sequence bigint NOT NULL DEFAULT 0,
  recorded_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX trip_live_locations_position_gix
  ON trip_live_locations USING gist (position);

CREATE TABLE trip_location_history (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  position geography(Point, 4326) NOT NULL,
  bearing numeric(6, 2),
  speed_mps numeric(8, 2),
  accuracy_meters numeric(8, 2),
  sequence bigint NOT NULL,
  recorded_at timestamptz NOT NULL
);

CREATE INDEX trip_location_history_trip_recorded_idx
  ON trip_location_history (trip_id, recorded_at DESC);

CREATE TABLE trip_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id),
  client_message_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (trip_id, sender_id, client_message_id)
);

CREATE INDEX trip_messages_trip_created_idx
  ON trip_messages (trip_id, created_at);
