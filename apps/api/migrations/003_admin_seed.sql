ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email text UNIQUE,
  ADD COLUMN IF NOT EXISTS password_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_idx
  ON users (lower(email))
  WHERE email IS NOT NULL;

INSERT INTO users (id, phone_e164, full_name, role, status, email, password_hash, phone_verified_at, terms_accepted_at)
VALUES
  ('00000000-0000-0000-0000-000000000001', '+593990000001', 'Administrador principal', 'ADMIN', 'ACTIVE', 'admin@mototaxi.local', crypt('Mototaxi2026!', gen_salt('bf')), now(), now()),
  ('00000000-0000-0000-0000-000000000002', '+593990000002', 'Equipo de soporte', 'SUPPORT', 'ACTIVE', 'soporte@mototaxi.local', crypt('Soporte2026!', gen_salt('bf')), now(), now()),
  ('00000000-0000-0000-0000-000000000101', '+593994102201', 'Carlos Mina', 'DRIVER', 'PENDING', NULL, NULL, now(), now()),
  ('00000000-0000-0000-0000-000000000102', '+593982241803', 'José Quiñónez', 'DRIVER', 'ACTIVE', NULL, NULL, now(), now()),
  ('00000000-0000-0000-0000-000000000103', '+593968857731', 'Luis Valencia', 'DRIVER', 'ACTIVE', NULL, NULL, now(), now()),
  ('00000000-0000-0000-0000-000000000201', '+593992210901', 'María Zambrano', 'PASSENGER', 'ACTIVE', NULL, NULL, now(), now()),
  ('00000000-0000-0000-0000-000000000202', '+593987712034', 'Ana Caicedo', 'PASSENGER', 'ACTIVE', NULL, NULL, now(), now()),
  ('00000000-0000-0000-0000-000000000203', '+593961439082', 'Pedro Angulo', 'PASSENGER', 'SUSPENDED', NULL, NULL, now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO drivers (user_id, approval_note, approved_at, approved_by, is_available, rating)
VALUES
  ('00000000-0000-0000-0000-000000000101', 'Pendiente de revisión documental', NULL, NULL, false, NULL),
  ('00000000-0000-0000-0000-000000000102', 'Documentación aprobada', now(), '00000000-0000-0000-0000-000000000001', true, 4.80),
  ('00000000-0000-0000-0000-000000000103', 'Documentación aprobada', now(), '00000000-0000-0000-0000-000000000001', true, 4.60)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO vehicles (id, driver_id, identifier, maximum_passengers, status)
VALUES
  ('00000000-0000-0000-0000-000000001101', '00000000-0000-0000-0000-000000000101', 'MT-014', 3, 'PENDING'),
  ('00000000-0000-0000-0000-000000001102', '00000000-0000-0000-0000-000000000102', 'MT-008', 3, 'ACTIVE'),
  ('00000000-0000-0000-0000-000000001103', '00000000-0000-0000-0000-000000000103', 'MT-021', 3, 'ACTIVE')
ON CONFLICT (id) DO NOTHING;
