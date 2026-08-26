-- Creates an independent tariff sector for Barrio/Playa Castelnuovo.
-- Fare rules are intentionally not seeded: they are managed from administration.

WITH service_area AS (
  SELECT id
  FROM service_areas
  WHERE code = 'ATACAMES_PROD'
  LIMIT 1
), sector_seed AS (
  SELECT
    'CASTELNUOVO_CABECERA'::text AS code,
    'Castelnuovo - cabecera cantonal'::text AS name,
    'Sector tarifario operativo de Castelnuovo, configurable desde administración.'::text AS description,
    -79.83281::double precision AS longitude,
    0.88038::double precision AS latitude,
    900::double precision AS radius_meters,
    250::integer AS priority
)
INSERT INTO fare_sectors (
  service_area_id,
  code,
  name,
  description,
  boundary,
  priority,
  enabled
)
SELECT
  service_area.id,
  sector_seed.code,
  sector_seed.name,
  sector_seed.description,
  ST_Multi(
    ST_Buffer(
      ST_SetSRID(
        ST_MakePoint(sector_seed.longitude, sector_seed.latitude),
        4326
      )::geography,
      sector_seed.radius_meters
    )::geometry
  )::geography,
  sector_seed.priority,
  true
FROM service_area
CROSS JOIN sector_seed
ON CONFLICT (service_area_id, code) DO NOTHING;

DO $$
DECLARE
  target_sector fare_sectors%ROWTYPE;
  center_point geography;
BEGIN
  SELECT fare_sectors.*
  INTO target_sector
  FROM fare_sectors
  JOIN service_areas ON service_areas.id = fare_sectors.service_area_id
  WHERE service_areas.code = 'ATACAMES_PROD'
    AND fare_sectors.code = 'CASTELNUOVO_CABECERA';

  IF target_sector.id IS NULL THEN
    RAISE EXCEPTION 'CASTELNUOVO_CABECERA could not be created because ATACAMES_PROD is missing';
  END IF;

  IF NOT target_sector.enabled THEN
    RAISE EXCEPTION 'CASTELNUOVO_CABECERA must be enabled';
  END IF;

  IF NOT ST_IsValid(target_sector.boundary::geometry) THEN
    RAISE EXCEPTION 'CASTELNUOVO_CABECERA has an invalid boundary';
  END IF;

  center_point := ST_SetSRID(ST_MakePoint(-79.83281, 0.88038), 4326)::geography;

  IF NOT ST_Covers(target_sector.boundary::geometry, center_point::geometry) THEN
    RAISE EXCEPTION 'CASTELNUOVO_CABECERA does not cover its configured center';
  END IF;
END $$;
