-- Tarifario territorial inicial de tricimotos de Atacames.
--
-- Los puntos de referencia provienen de cartografia publica del GADM de
-- Atacames, GAD Tonsupa, IGM/PDOT y OpenStreetMap. Los buffers son limites
-- operativos iniciales y permanecen editables desde el panel administrativo.
-- No crean nuevas Service Areas: todos son subsectores de ATACAMES_PROD.

ALTER TABLE fare_route_rules
  ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_code text;

CREATE UNIQUE INDEX IF NOT EXISTS fare_route_rules_source_code_uidx
  ON fare_route_rules(source_code)
  WHERE source_code IS NOT NULL;

WITH area AS (
  SELECT id FROM service_areas WHERE code = 'ATACAMES_PROD' LIMIT 1
), seed(code, name, description, longitude, latitude, radius_meters, priority) AS (
  VALUES
    ('ATACAMES_CABECERA','Atacames · cabecera cantonal','Centro urbano de Atacames. Referencia WGS84: GADM/OSM.',-79.84806,0.86903,2000,100),
    ('TONSUPA_CABECERA','Tonsupa · centro parroquial','Centro urbano de Tonsupa. Referencia WGS84: GAD Tonsupa/IGM.',-79.81100,0.89600,1600,100),
    ('TONSUPA_CABAPLAN','Tonsupa · Cabaplan','Ingreso y sector Cabaplan. Referencia WGS84: OpenStreetMap.',-79.81269,0.88791,650,300),
    ('CLUB_DEL_PACIFICO','Club del Pacífico','Sector Club del Pacífico. Referencia WGS84: OpenStreetMap.',-79.80591,0.89322,700,400),
    ('SUA_CABECERA','Súa · centro parroquial','Centro urbano de Súa. Referencia: cartografía GADM de Atacames.',-79.87730,0.85750,1500,100),
    ('TONSUPA_RURAL_ESTE','Salima · Taseche · Estero del Medio','Corredor rural contemplado por el tarifario. Referencia: PDOT Tonsupa/IGM.',-79.79630,0.84248,3000,200),
    ('SUA_GUACHAL_MUCHIN','Guachal · Muchín','Corredor rural contemplado por el tarifario. Referencia: GADM de Atacames.',-79.89515,0.79562,3200,200),
    ('LAS_BRISAS','Las Brisas','Recinto Las Brisas. Referencia WGS84: OSM/GeoNames.',-79.86642,0.83221,1000,200),
    ('LA_UNION','La Unión','Recinto La Unión. Referencia: GADM/PDOT de Atacames.',-79.86622,0.81049,1000,200),
    ('CUMBA','Cumba','Recinto Cumba. Límite operativo inicial editable en el panel.',-79.84750,0.81400,900,200),
    ('LA_LUCHA','La Lucha','Recinto La Lucha. Referencia WGS84: GeoNames.',-79.85910,0.77830,1100,200),
    ('LAS_VEGAS','Las Vegas','Recinto Las Vegas. Referencia WGS84: GeoNames.',-79.84939,0.75813,1100,200)
)
INSERT INTO fare_sectors(service_area_id, code, name, description, boundary, priority, enabled)
SELECT area.id, seed.code, seed.name, seed.description,
       ST_Multi(ST_Buffer(ST_SetSRID(ST_MakePoint(seed.longitude, seed.latitude),4326)::geography,
                         seed.radius_meters)::geometry)::geography,
       seed.priority, true
FROM area CROSS JOIN seed
ON CONFLICT (service_area_id, code) DO NOTHING;

WITH area AS (
  SELECT id FROM service_areas WHERE code = 'ATACAMES_PROD' LIMIT 1
), matrix(source_code, origin_code, destination_code, min_pax, max_pax, day_cents, night_cents) AS (
  VALUES
    ('OFFICIAL_ATACAMES_LOCAL_1','ATACAMES_CABECERA','ATACAMES_CABECERA',1,1,50,100),
    ('OFFICIAL_ATACAMES_LOCAL_2_3','ATACAMES_CABECERA','ATACAMES_CABECERA',2,3,100,200),
    ('OFFICIAL_TONSUPA_LOCAL_1','TONSUPA_CABECERA','TONSUPA_CABECERA',1,1,50,100),
    ('OFFICIAL_TONSUPA_LOCAL_2_3','TONSUPA_CABECERA','TONSUPA_CABECERA',2,3,100,200),
    ('OFFICIAL_SUA_LOCAL_1','SUA_CABECERA','SUA_CABECERA',1,1,50,100),
    ('OFFICIAL_SUA_LOCAL_2_3','SUA_CABECERA','SUA_CABECERA',2,3,100,200),
    ('OFFICIAL_ATACAMES_CABAPLAN_1','ATACAMES_CABECERA','TONSUPA_CABAPLAN',1,1,100,250),
    ('OFFICIAL_ATACAMES_CABAPLAN_2_3','ATACAMES_CABECERA','TONSUPA_CABAPLAN',2,3,200,250),
    ('OFFICIAL_ATACAMES_CLUB_PACIFICO','ATACAMES_CABECERA','CLUB_DEL_PACIFICO',1,3,200,300),
    ('OFFICIAL_ATACAMES_SUA_1','ATACAMES_CABECERA','SUA_CABECERA',1,1,100,250),
    ('OFFICIAL_ATACAMES_SUA_2_3','ATACAMES_CABECERA','SUA_CABECERA',2,3,200,260),
    ('OFFICIAL_ATACAMES_LA_UNION','ATACAMES_CABECERA','LA_UNION',1,3,200,250),
    ('OFFICIAL_ATACAMES_LAS_VEGAS','ATACAMES_CABECERA','LAS_VEGAS',1,3,500,600),
    ('OFFICIAL_ATACAMES_LA_LUCHA','ATACAMES_CABECERA','LA_LUCHA',1,3,300,400),
    ('OFFICIAL_ATACAMES_CUMBA','ATACAMES_CABECERA','CUMBA',1,3,400,600),
    ('OFFICIAL_ATACAMES_LAS_BRISAS','ATACAMES_CABECERA','LAS_BRISAS',1,3,150,200),
    ('OFFICIAL_TONSUPA_RURAL_ESTE','TONSUPA_CABECERA','TONSUPA_RURAL_ESTE',1,3,300,400),
    ('OFFICIAL_SUA_GUACHAL_MUCHIN','SUA_CABECERA','SUA_GUACHAL_MUCHIN',1,3,300,450)
), resolved AS (
  SELECT matrix.*, area.id AS service_area_id,
         origin.id AS origin_sector_id, destination.id AS destination_sector_id
  FROM matrix CROSS JOIN area
  JOIN fare_sectors origin ON origin.service_area_id=area.id AND origin.code=matrix.origin_code
  JOIN fare_sectors destination ON destination.service_area_id=area.id AND destination.code=matrix.destination_code
)
INSERT INTO fare_route_rules(service_area_id, origin_sector_id, destination_sector_id,
  minimum_passengers, maximum_passengers, day_total_cents, night_total_cents,
  bidirectional, enabled, priority, source_code)
SELECT service_area_id, origin_sector_id, destination_sector_id, min_pax, max_pax,
       day_cents, night_cents, true, true, 100, source_code
FROM resolved
ON CONFLICT (source_code) WHERE source_code IS NOT NULL DO UPDATE SET
  service_area_id=EXCLUDED.service_area_id,
  origin_sector_id=EXCLUDED.origin_sector_id,
  destination_sector_id=EXCLUDED.destination_sector_id,
  minimum_passengers=EXCLUDED.minimum_passengers,
  maximum_passengers=EXCLUDED.maximum_passengers,
  day_total_cents=EXCLUDED.day_total_cents,
  night_total_cents=EXCLUDED.night_total_cents,
  bidirectional=true,
  enabled=true,
  priority=100,
  updated_at=now();
