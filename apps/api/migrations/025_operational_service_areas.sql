CREATE TABLE service_area_catalog (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  version bigint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO service_area_catalog (id, version) VALUES (1, 1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9_]+$'),
  name text NOT NULL,
  description text,
  environment text NOT NULL CHECK (environment IN ('PRODUCTION', 'TEST')),
  audience text NOT NULL CHECK (audience IN ('ALL', 'TESTERS')),
  enabled boolean NOT NULL DEFAULT true,
  allow_inter_zone_trips boolean NOT NULL DEFAULT false,
  priority integer NOT NULL DEFAULT 0,
  current_version_id uuid,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE service_area_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_area_id uuid NOT NULL REFERENCES service_areas(id) ON DELETE RESTRICT,
  version integer NOT NULL CHECK (version > 0),
  geometry geometry(MultiPolygon, 4326) NOT NULL,
  source_name text,
  source_url text,
  change_note text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_area_id, version)
);

ALTER TABLE service_areas
  ADD CONSTRAINT service_areas_current_version_fk
  FOREIGN KEY (current_version_id) REFERENCES service_area_versions(id) ON DELETE RESTRICT;

CREATE INDEX service_area_versions_geometry_gix
  ON service_area_versions USING gist (geometry);

CREATE TABLE user_service_area_access (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_area_id uuid NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  granted_by uuid REFERENCES users(id),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, service_area_id)
);

ALTER TABLE trips ADD COLUMN service_area_id uuid REFERENCES service_areas(id);
ALTER TABLE trips ADD COLUMN service_area_version_id uuid REFERENCES service_area_versions(id);
CREATE INDEX trips_service_area_idx ON trips (service_area_id, requested_at DESC);

-- Geometría de referencia publicada por OSM para Atacames, Súa, Tonchigüe y
-- Tonsupa. La unión se recorta en el límite comercial Piedra Fina A
-- (longitud -79.76629351845928), aprobado para la versión inicial.
WITH admin AS (
  SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') ORDER BY created_at LIMIT 1
), area AS (
  INSERT INTO service_areas (
    code, name, description, environment, audience, enabled,
    allow_inter_zone_trips, priority, created_by, updated_by
  ) SELECT 'ATACAMES_PROD', 'Atacames',
    'Cobertura comercial Atacames, Súa, Same, Tonchigüe y Tonsupa hasta Piedra Fina A.',
    'PRODUCTION', 'ALL', true, false, 100, id, id FROM admin
  RETURNING id, created_by
), source_geometries AS (
  SELECT ST_SetSRID(ST_GeomFromGeoJSON(value::text), 4326) geom
  FROM jsonb_array_elements(
    '[
      {"type":"Polygon","coordinates":[[[-79.869425,0.849704],[-79.855134,0.839875],[-79.857672,0.803804],[-79.840955,0.775271],[-79.821765,0.752196],[-79.790208,0.755463],[-79.760532,0.805577],[-79.779573,0.804876],[-79.799053,0.823083],[-79.801727,0.844958],[-79.800456,0.866841],[-79.804079,0.870811],[-79.81075,0.869788],[-79.816433,0.873862],[-79.822718,0.875942],[-79.836205,0.88074],[-79.845707,0.876653],[-79.852806,0.872385],[-79.860491,0.867813],[-79.868592,0.85411],[-79.869425,0.849704]]]},
      {"type":"Polygon","coordinates":[[[-79.913942,0.756497],[-79.897806,0.715387],[-79.887421,0.67653],[-79.875919,0.666068],[-79.865621,0.678989],[-79.869788,0.693477],[-79.87153,0.710432],[-79.876611,0.727446],[-79.874042,0.741048],[-79.865462,0.745113],[-79.869352,0.762039],[-79.879834,0.76908],[-79.880154,0.802903],[-79.877526,0.822472],[-79.869167,0.85258],[-79.86922,0.864167],[-79.87886,0.869927],[-79.884856,0.868196],[-79.899944,0.856418],[-79.905645,0.84543],[-79.903308,0.819679],[-79.907848,0.779583],[-79.913942,0.756497]]]},
      {"type":"Polygon","coordinates":[[[-80.015039,0.733864],[-80.009685,0.728275],[-80.003327,0.72997],[-79.982602,0.740735],[-79.973638,0.736146],[-79.930754,0.715119],[-79.896667,0.66612],[-79.898149,0.708693],[-79.909135,0.774949],[-79.901625,0.842662],[-79.913753,0.854376],[-79.920636,0.854142],[-79.951772,0.827018],[-79.985834,0.817637],[-79.996792,0.792159],[-80.008113,0.757247],[-80.012534,0.748792],[-80.013247,0.737935],[-80.015039,0.733864]]]},
      {"type":"Polygon","coordinates":[[[-79.824937,0.886288],[-79.819477,0.871985],[-79.805973,0.871508],[-79.799702,0.867697],[-79.801886,0.845589],[-79.799053,0.823083],[-79.778386,0.806098],[-79.747542,0.826645],[-79.753182,0.874195],[-79.735619,0.920348],[-79.745026,0.959914],[-79.755027,0.949898],[-79.763157,0.94003],[-79.76945,0.935223],[-79.780857,0.925427],[-79.788796,0.915073],[-79.797862,0.904415],[-79.824937,0.886288]]]}
    ]'::jsonb
  ) value
), published AS (
  INSERT INTO service_area_versions (
    service_area_id, version, geometry, source_name, source_url, change_note, created_by
  ) SELECT area.id, 1,
    ST_Multi(ST_CollectionExtract(ST_Intersection(
      ST_UnaryUnion(ST_Collect(ST_MakeValid(source_geometries.geom))),
      ST_MakeEnvelope(-180, -90, -79.76629351845928, 90, 4326)
    ), 3)),
    'OpenStreetMap contributors; límite comercial Piedra Fina A',
    'https://www.openstreetmap.org/copyright',
    'Versión inicial aprobada: corte oriental Piedra Fina A.', area.created_by
  FROM area CROSS JOIN source_geometries
  GROUP BY area.id, area.created_by
  RETURNING id, service_area_id
)
UPDATE service_areas SET current_version_id=published.id
FROM published WHERE service_areas.id=published.service_area_id;

-- Zona urbana de Cuenca publicada por ETAPA EP. Se mantiene separada y solo
-- accesible a cuentas autorizadas expresamente.
WITH admin AS (
  SELECT id FROM users WHERE role IN ('SUPER_ADMIN', 'ADMIN') ORDER BY created_at LIMIT 1
), area AS (
  INSERT INTO service_areas (
    code, name, description, environment, audience, enabled,
    allow_inter_zone_trips, priority, created_by, updated_by
  ) SELECT 'CUENCA_TEST', 'Cuenca - Pruebas',
    'Área urbana para pruebas controladas de GPS, rutas y asignación.',
    'TEST', 'TESTERS', true, false, 50, id, id FROM admin
  RETURNING id, created_by
), published AS (
  INSERT INTO service_area_versions (
    service_area_id, version, geometry, source_name, source_url, change_note, created_by
  ) SELECT area.id, 1,
    ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(
      '{"type":"Polygon","coordinates":[[[-78.98288,-2.824862],[-78.986592,-2.847087],[-78.994381,-2.850832],[-79.004064,-2.857629],[-78.997207,-2.868277],[-79.005362,-2.880154],[-79.018373,-2.877866],[-79.028709,-2.873522],[-79.038818,-2.861345],[-79.043048,-2.878855],[-79.067623,-2.876432],[-79.065802,-2.88762],[-79.045308,-2.889877],[-79.051621,-2.907283],[-79.049922,-2.933626],[-79.035885,-2.927643],[-78.990758,-2.919697],[-78.971404,-2.913124],[-78.962818,-2.909469],[-78.951732,-2.88776],[-78.913124,-2.862428],[-78.899236,-2.853553],[-78.931626,-2.856064],[-78.952189,-2.877274],[-78.961232,-2.870541],[-78.97738,-2.860861],[-78.982771,-2.824977],[-78.98288,-2.824862]]]}'
    ), 4326)),
    'ETAPA EP - límite urbano de Cuenca',
    'https://geo.etapa.net.ec/arcgis/rest/services/Publico/SRV_SGA_RefrenciasRadar/MapServer/6',
    'Versión inicial para pruebas controladas.', area.created_by
  FROM area
  RETURNING id, service_area_id
)
UPDATE service_areas SET current_version_id=published.id
FROM published WHERE service_areas.id=published.service_area_id;

INSERT INTO user_service_area_access (user_id, service_area_id)
SELECT users.id, service_areas.id
FROM users CROSS JOIN service_areas
WHERE service_areas.code='CUENCA_TEST'
  AND lower(users.email) IN ('pasajera@mototaxi.local', 'conductor@mototaxi.local')
ON CONFLICT DO NOTHING;
