CREATE TABLE IF NOT EXISTS operational_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  search_radius_meters integer NOT NULL DEFAULT 3000
    CHECK (search_radius_meters BETWEEN 500 AND 20000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

INSERT INTO operational_settings (id, search_radius_meters)
VALUES (1, 3000)
ON CONFLICT (id) DO NOTHING;
