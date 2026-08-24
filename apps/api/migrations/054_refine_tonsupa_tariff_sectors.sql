-- Corrige la superposicion de los buffers iniciales de Tonsupa, Cabaplan y
-- Club del Pacifico. Las tarifas historicas conservan su pricing_snapshot;
-- estas geometrías se aplican solamente a cotizaciones nuevas.
--
-- Cabaplan: poligono residencial OpenStreetMap way 646844238, consultado el
-- 2026-08-23 (WGS84 / EPSG:4326).
-- Club del Pacifico: envolvente operativa de referencias cartograficas
-- publicas sobre Av. Club del Pacifico (OSM) y el inventario territorial de
-- Tonsupa/PUCE; se agrega un corredor de 150 m para cubrir los predios a ambos
-- lados de la avenida. Sigue siendo editable desde el panel administrativo.

WITH area AS (
  SELECT id FROM service_areas WHERE code = 'ATACAMES_PROD' LIMIT 1
)
UPDATE fare_sectors sector
SET boundary = ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(
  '{"type":"Polygon","coordinates":[[[-79.8126933,0.8890545],[-79.8132978,0.8887775],[-79.8135137,0.8886191],[-79.8137296,0.8884608],[-79.8134741,0.8883349],[-79.8133410,0.8881478],[-79.8133482,0.8879931],[-79.8132870,0.8878635],[-79.8132690,0.8877448],[-79.8132438,0.8876548],[-79.8131791,0.8875721],[-79.8131323,0.8874965],[-79.8130819,0.8874102],[-79.8129883,0.8873562],[-79.8128948,0.8872590],[-79.8128408,0.8871835],[-79.8127796,0.8870576],[-79.8127184,0.8870072],[-79.8125709,0.8869856],[-79.8124593,0.8869424],[-79.8123190,0.8868669],[-79.8122290,0.8867877],[-79.8120887,0.8867733],[-79.8119591,0.8868057],[-79.8118188,0.8868884],[-79.8117648,0.8869244],[-79.8116569,0.8869784],[-79.8122461,0.8881568],[-79.8126933,0.8890545]]]}'
), 4326))::geography,
    description = 'Sector residencial Cabaplan. Geometria OSM way 646844238 (WGS84), refinada para evitar superposicion con Tonsupa centro.',
    priority = 300,
    updated_at = now()
FROM area
WHERE sector.service_area_id = area.id
  AND sector.code = 'TONSUPA_CABAPLAN';

WITH area AS (
  SELECT id FROM service_areas WHERE code = 'ATACAMES_PROD' LIMIT 1
), club_geometry AS (
  SELECT ST_Multi(ST_Buffer(
    ST_ConvexHull(ST_GeomFromText(
      'MULTIPOINT(-79.8059123 0.8932182,-79.8041667 0.8913889,-79.8012970 0.8994260,-79.7994140 0.8994180)',
      4326
    ))::geography,
    150
  )::geometry)::geography AS boundary
)
UPDATE fare_sectors sector
SET boundary = club_geometry.boundary,
    description = 'Corredor comercial Club del Pacifico. Envolvente de referencias OSM/PUCE sobre Av. Club del Pacifico con margen operativo de 150 m.',
    priority = 400,
    updated_at = now()
FROM area CROSS JOIN club_geometry
WHERE sector.service_area_id = area.id
  AND sector.code = 'CLUB_DEL_PACIFICO';

-- La migracion falla de forma segura si una geometria queda invalida o si los
-- tres puntos de control dejan de clasificarse como se espera.
DO $$
DECLARE
  area_id uuid;
  tonsupa_generic geography := ST_SetSRID(ST_MakePoint(-79.81023, 0.89018), 4326)::geography;
  cabaplan_reference geography := ST_SetSRID(ST_MakePoint(-79.81269, 0.88791), 4326)::geography;
  club_reference geography := ST_SetSRID(ST_MakePoint(-79.8059123, 0.8932182), 4326)::geography;
BEGIN
  SELECT id INTO area_id FROM service_areas WHERE code = 'ATACAMES_PROD' LIMIT 1;
  IF area_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1 FROM fare_sectors
    WHERE service_area_id = area_id
      AND code IN ('TONSUPA_CABAPLAN', 'CLUB_DEL_PACIFICO')
      AND NOT ST_IsValid(boundary::geometry)
  ) THEN
    RAISE EXCEPTION 'Invalid refined Tonsupa tariff geometry';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fare_sectors
    WHERE service_area_id = area_id AND code = 'TONSUPA_CABECERA'
      AND ST_Covers(boundary, tonsupa_generic)
  ) OR EXISTS (
    SELECT 1 FROM fare_sectors
    WHERE service_area_id = area_id
      AND code IN ('TONSUPA_CABAPLAN', 'CLUB_DEL_PACIFICO')
      AND ST_Covers(boundary, tonsupa_generic)
  ) THEN
    RAISE EXCEPTION 'Generic Tonsupa point overlaps a specific tariff sector';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fare_sectors
    WHERE service_area_id = area_id AND code = 'TONSUPA_CABAPLAN'
      AND ST_Covers(boundary, cabaplan_reference)
  ) THEN
    RAISE EXCEPTION 'Cabaplan reference is outside its tariff sector';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM fare_sectors
    WHERE service_area_id = area_id AND code = 'CLUB_DEL_PACIFICO'
      AND ST_Covers(boundary, club_reference)
  ) THEN
    RAISE EXCEPTION 'Club del Pacifico reference is outside its tariff sector';
  END IF;
END $$;
