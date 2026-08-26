-- Amplía de forma controlada el sector tarifario TONSUPA_CABECERA hacia el
-- punto operativo aprobado 0.876531, -79.822096 (latitud, longitud).
--
-- GeoJSON/PostGIS utiliza el orden longitud, latitud. La ampliacion conserva
-- cualquier ajuste previo realizado desde el panel: agrega un corredor de
-- 300 m desde el borde actual hasta el punto de control, en lugar de sustituir
-- la geometria completa por un poligono hardcodeado.
--
-- Las cotizaciones históricas conservan su pricing_snapshot; esta geometría
-- se aplica solamente a cotizaciones nuevas posteriores a la migración.

WITH area AS (
  SELECT id
  FROM service_areas
  WHERE code = 'ATACAMES_PROD'
  LIMIT 1
), target AS (
  SELECT ST_SetSRID(ST_MakePoint(-79.822096, 0.876531), 4326) AS geometry
), extension AS (
  SELECT
    sector.id AS sector_id,
    ST_Buffer(
      ST_MakeLine(
        ST_ClosestPoint(sector.boundary::geometry, target.geometry),
        target.geometry
      )::geography,
      300
    )::geometry AS geometry
  FROM fare_sectors sector
  JOIN area ON area.id = sector.service_area_id
  CROSS JOIN target
  WHERE sector.code = 'TONSUPA_CABECERA'
)
UPDATE fare_sectors sector
SET boundary = ST_Multi(
      ST_CollectionExtract(
        ST_UnaryUnion(ST_Collect(sector.boundary::geometry, extension.geometry)),
        3
      )
    )::geography,
    description = concat_ws(
      ' ',
      nullif(trim(sector.description), ''),
      'Extension operativa suroeste aprobada hacia 0.876531, -79.822096 (WGS84), con corredor de 300 m.'
    ),
    updated_at = now()
FROM extension
WHERE sector.id = extension.sector_id;

-- La migración falla de forma segura si falta el sector, la geometría queda
-- inválida o el punto solicitado continúa fuera de Tonsupa centro parroquial.
DO $$
DECLARE
  area_id uuid;
  target geography := ST_SetSRID(
    ST_MakePoint(-79.822096, 0.876531),
    4326
  )::geography;
BEGIN
  SELECT id INTO area_id
  FROM service_areas
  WHERE code = 'ATACAMES_PROD'
  LIMIT 1;

  IF area_id IS NULL THEN
    RAISE EXCEPTION 'ATACAMES_PROD service area was not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM fare_sectors
    WHERE service_area_id = area_id
      AND code = 'TONSUPA_CABECERA'
      AND enabled = true
  ) THEN
    RAISE EXCEPTION 'TONSUPA_CABECERA fare sector was not found or is disabled';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM fare_sectors
    WHERE service_area_id = area_id
      AND code = 'TONSUPA_CABECERA'
      AND NOT ST_IsValid(boundary::geometry)
  ) THEN
    RAISE EXCEPTION 'Expanded TONSUPA_CABECERA geometry is invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM fare_sectors
    WHERE service_area_id = area_id
      AND code = 'TONSUPA_CABECERA'
      AND ST_Covers(boundary, target)
  ) THEN
    RAISE EXCEPTION 'Approved Tonsupa control point is outside TONSUPA_CABECERA';
  END IF;
END $$;
