ALTER TABLE service_areas DROP CONSTRAINT IF EXISTS service_areas_audience_check;
ALTER TABLE service_areas
  ADD CONSTRAINT service_areas_audience_check
  CHECK (audience IN ('ALL', 'TESTERS', 'SPECIFIC_USERS', 'ROLES'));

ALTER TABLE service_areas
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES users(id);

CREATE TABLE IF NOT EXISTS service_area_role_access (
  service_area_id uuid NOT NULL REFERENCES service_areas(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('PASSENGER', 'DRIVER')),
  granted_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (service_area_id, role)
);

CREATE INDEX IF NOT EXISTS service_area_role_access_area_idx
  ON service_area_role_access (service_area_id);
