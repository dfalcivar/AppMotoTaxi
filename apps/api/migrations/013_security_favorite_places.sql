ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS favorite_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(label) BETWEEN 2 AND 50),
  address text NOT NULL CHECK (char_length(address) BETWEEN 3 AND 200),
  location geography(Point, 4326) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);

CREATE INDEX IF NOT EXISTS favorite_places_user_idx
  ON favorite_places (user_id, created_at DESC);
