ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SUPER_ADMIN';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ADMIN_OPERACIONES';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'SOPORTE';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'ANALISTA_COOPERATIVA';

CREATE TABLE IF NOT EXISTS cooperatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  legal_name text,
  registration_number text UNIQUE,
  email text,
  phone_e164 text,
  status text NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE', 'SUSPENDED', 'INACTIVE')),
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS cooperative_id uuid REFERENCES cooperatives(id) ON DELETE SET NULL;

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS cooperative_id uuid REFERENCES cooperatives(id) ON DELETE SET NULL;

UPDATE trips trip
SET cooperative_id = driver.cooperative_id
FROM users driver
WHERE trip.driver_id = driver.id
  AND trip.cooperative_id IS NULL
  AND driver.cooperative_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS admin_permission_overrides (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission text NOT NULL,
  allowed boolean NOT NULL,
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS users_cooperative_role_idx
  ON users (cooperative_id, role);
CREATE INDEX IF NOT EXISTS trips_cooperative_requested_idx
  ON trips (cooperative_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS admin_permission_overrides_user_idx
  ON admin_permission_overrides (user_id);

COMMENT ON COLUMN trips.cooperative_id IS
  'Cooperativa del conductor al asignarse el viaje; se conserva como dato historico.';
