ALTER TABLE pricing_versions
  ADD COLUMN IF NOT EXISTS platform_commission_cents_per_leg integer NOT NULL DEFAULT 5
    CHECK (platform_commission_cents_per_leg >= 0);

UPDATE pricing_versions
SET platform_commission_cents_per_leg = 5,
    stop_surcharge_cents = CASE WHEN stop_surcharge_cents = 0 THEN 25 ELSE stop_surcharge_cents END
WHERE active_until IS NULL;

CREATE TABLE IF NOT EXISTS fare_sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_area_id uuid NOT NULL REFERENCES operational_service_areas(id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  boundary geography(MultiPolygon,4326) NOT NULL,
  priority integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(service_area_id, code)
);

CREATE INDEX IF NOT EXISTS fare_sectors_boundary_gix ON fare_sectors USING gist(boundary);
CREATE INDEX IF NOT EXISTS fare_sectors_area_enabled_idx ON fare_sectors(service_area_id, enabled, priority DESC);

CREATE TABLE IF NOT EXISTS fare_route_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_area_id uuid NOT NULL REFERENCES operational_service_areas(id),
  origin_sector_id uuid NOT NULL REFERENCES fare_sectors(id),
  destination_sector_id uuid NOT NULL REFERENCES fare_sectors(id),
  minimum_passengers smallint NOT NULL CHECK (minimum_passengers BETWEEN 1 AND 3),
  maximum_passengers smallint NOT NULL CHECK (maximum_passengers BETWEEN minimum_passengers AND 3),
  day_total_cents integer NOT NULL CHECK (day_total_cents >= 0),
  night_total_cents integer NOT NULL CHECK (night_total_cents >= 0),
  bidirectional boolean NOT NULL DEFAULT true,
  enabled boolean NOT NULL DEFAULT false,
  active_from timestamptz NOT NULL DEFAULT now(),
  active_until timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS fare_route_rules_lookup_idx
  ON fare_route_rules(service_area_id, origin_sector_id, destination_sector_id,
    minimum_passengers, maximum_passengers, enabled, active_from);
