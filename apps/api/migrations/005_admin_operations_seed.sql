ALTER TABLE service_zones
  ADD COLUMN IF NOT EXISTS editor_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

INSERT INTO pricing_versions (
  version, day_starts_at, night_starts_at, urban_day_cents_per_passenger,
  night_cents_per_passenger, extended_cents_per_passenger,
  group_promotion_enabled, group_promotion_passengers, group_promotion_total_cents,
  maximum_passengers, active_from, created_by
)
VALUES (1, '06:00', '20:00', 50, 100, 100, true, 3, 100, 3, now(), '00000000-0000-0000-0000-000000000001')
ON CONFLICT (version) DO NOTHING;

INSERT INTO service_zones (name, zone_type, boundary, version, active_from, created_by, editor_points)
VALUES
  ('Casco urbano Atacames', 'URBAN', ST_GeogFromText('POLYGON((-79.850 0.860,-79.838 0.860,-79.838 0.870,-79.850 0.870,-79.850 0.860))'), 1, now(), '00000000-0000-0000-0000-000000000001', '[{"x":18,"y":22},{"x":76,"y":16},{"x":88,"y":63},{"x":48,"y":84},{"x":14,"y":62}]'::jsonb),
  ('Cobertura extendida', 'EXTENDED', ST_GeogFromText('POLYGON((-79.858 0.854,-79.830 0.854,-79.830 0.878,-79.858 0.878,-79.858 0.854))'), 1, now(), '00000000-0000-0000-0000-000000000001', '[{"x":8,"y":10},{"x":92,"y":8},{"x":96,"y":90},{"x":10,"y":92}]'::jsonb)
ON CONFLICT (name, version) DO NOTHING;

INSERT INTO incidents (id, reported_by, category, description, status, assigned_to)
VALUES
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000000201', 'Objeto olvidado', 'Pasajera reporta una mochila azul.', 'OPEN', '00000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000000202', 'Tarifa', 'Consulta por regla nocturna.', 'IN_REVIEW', '00000000-0000-0000-0000-000000000001')
ON CONFLICT (id) DO NOTHING;
