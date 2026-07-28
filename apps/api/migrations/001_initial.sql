CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TYPE user_role AS ENUM ('PASSENGER', 'DRIVER', 'ADMIN', 'SUPPORT');
CREATE TYPE account_status AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED');
CREATE TYPE service_zone_type AS ENUM ('URBAN', 'EXTENDED');
CREATE TYPE trip_status AS ENUM (
  'SEARCHING',
  'ASSIGNED',
  'DRIVER_EN_ROUTE',
  'DRIVER_ARRIVED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'NO_DRIVER',
  'INCIDENT'
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164 text NOT NULL UNIQUE,
  full_name text NOT NULL,
  role user_role NOT NULL,
  status account_status NOT NULL DEFAULT 'PENDING',
  phone_verified_at timestamptz,
  terms_accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  approval_note text,
  approved_at timestamptz,
  approved_by uuid REFERENCES users(id),
  is_available boolean NOT NULL DEFAULT false,
  rating numeric(3, 2),
  last_location geography(Point, 4326),
  last_location_at timestamptz
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  identifier text NOT NULL UNIQUE,
  maximum_passengers smallint NOT NULL CHECK (maximum_passengers > 0),
  status account_status NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  zone_type service_zone_type NOT NULL,
  boundary geography(Polygon, 4326) NOT NULL,
  version integer NOT NULL,
  active_from timestamptz NOT NULL,
  active_until timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, version)
);

CREATE INDEX service_zones_boundary_gix ON service_zones USING gist (boundary);
CREATE INDEX drivers_last_location_gix ON drivers USING gist (last_location);

CREATE TABLE pricing_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  currency char(3) NOT NULL DEFAULT 'USD',
  timezone text NOT NULL DEFAULT 'America/Guayaquil',
  day_starts_at time NOT NULL,
  night_starts_at time NOT NULL,
  urban_day_cents_per_passenger integer NOT NULL CHECK (urban_day_cents_per_passenger >= 0),
  night_cents_per_passenger integer NOT NULL CHECK (night_cents_per_passenger >= 0),
  extended_cents_per_passenger integer NOT NULL CHECK (extended_cents_per_passenger >= 0),
  group_promotion_enabled boolean NOT NULL DEFAULT true,
  group_promotion_passengers smallint NOT NULL,
  group_promotion_total_cents integer NOT NULL,
  maximum_passengers smallint NOT NULL,
  active_from timestamptz NOT NULL,
  active_until timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  passenger_id uuid NOT NULL REFERENCES users(id),
  driver_id uuid REFERENCES drivers(user_id),
  vehicle_id uuid REFERENCES vehicles(id),
  status trip_status NOT NULL DEFAULT 'SEARCHING',
  passengers smallint NOT NULL CHECK (passengers > 0),
  origin geography(Point, 4326) NOT NULL,
  destination geography(Point, 4326) NOT NULL,
  origin_reference text,
  destination_reference text,
  service_zone service_zone_type NOT NULL,
  pricing_version integer NOT NULL,
  pricing_snapshot jsonb NOT NULL,
  quoted_total_cents integer NOT NULL CHECK (quoted_total_cents >= 0),
  final_total_cents integer CHECK (final_total_cents >= 0),
  payment_method text NOT NULL DEFAULT 'CASH' CHECK (payment_method = 'CASH'),
  requested_at timestamptz NOT NULL DEFAULT now(),
  assigned_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);

CREATE INDEX trips_passenger_requested_idx ON trips (passenger_id, requested_at DESC);
CREATE INDEX trips_driver_requested_idx ON trips (driver_id, requested_at DESC);
CREATE INDEX trips_active_status_idx ON trips (status)
  WHERE status IN ('SEARCHING', 'ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS');

CREATE TABLE trip_events (
  id bigserial PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id),
  from_status trip_status,
  to_status trip_status NOT NULL,
  actor_id uuid REFERENCES users(id),
  reason_code text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  accepted boolean,
  UNIQUE (trip_id, driver_id)
);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  previous_value jsonb,
  next_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
