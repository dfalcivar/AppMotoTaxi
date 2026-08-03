CREATE TABLE affiliate_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(120) NOT NULL,
  placement varchar(30) NOT NULL CHECK (placement IN ('PASSENGER_HOME', 'DRIVER_HOME')),
  image_mime varchar(30) NOT NULL CHECK (image_mime IN ('image/jpeg', 'image/png', 'image/webp')),
  image_data bytea NOT NULL,
  target_url text,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at),
  CHECK (octet_length(image_data) <= 1048576)
);

CREATE INDEX affiliate_banners_schedule_idx
  ON affiliate_banners (placement, active, starts_at, ends_at, sort_order);
