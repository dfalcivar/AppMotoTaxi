ALTER TABLE collection_points
  ADD COLUMN IF NOT EXISTS reference text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS latitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS longitude numeric(10,7),
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Guayaquil';

ALTER TABLE costa_go_payment_accounts
  ADD COLUMN IF NOT EXISTS account_identifier_public text,
  ADD COLUMN IF NOT EXISTS holder_identification_public text,
  ADD COLUMN IF NOT EXISTS support_email text;

ALTER TABLE collection_points DROP CONSTRAINT IF EXISTS collection_points_latitude_check;
ALTER TABLE collection_points ADD CONSTRAINT collection_points_latitude_check
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90);
ALTER TABLE collection_points DROP CONSTRAINT IF EXISTS collection_points_longitude_check;
ALTER TABLE collection_points ADD CONSTRAINT collection_points_longitude_check
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE TABLE IF NOT EXISTS collection_point_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_point_id uuid NOT NULL REFERENCES collection_points(id) ON DELETE CASCADE,
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  opens_at time,
  closes_at time,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(collection_point_id, day_of_week),
  CHECK (closed OR (opens_at IS NOT NULL AND closes_at IS NOT NULL AND opens_at <> closes_at))
);

CREATE INDEX IF NOT EXISTS collection_points_mobile_directory_idx
  ON collection_points(status, display_order, name);

CREATE UNIQUE INDEX IF NOT EXISTS membership_transfer_proofs_one_pending_per_order_idx
  ON membership_transfer_proofs(order_id)
  WHERE status IN ('PENDING','APPROVED');

COMMENT ON COLUMN collection_points.reference IS 'Referencia pública para ayudar al conductor a encontrar el punto.';
COMMENT ON COLUMN collection_points.timezone IS 'Zona IANA utilizada para calcular el estado abierto/cerrado.';
COMMENT ON TABLE collection_point_schedules IS 'Horario semanal estructurado; 0=domingo y 6=sábado.';
