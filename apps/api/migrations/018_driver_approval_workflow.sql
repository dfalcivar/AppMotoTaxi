ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS approval_status text NOT NULL DEFAULT 'PENDIENTE_DOCUMENTOS',
  ADD COLUMN IF NOT EXISTS approval_observation text,
  ADD COLUMN IF NOT EXISTS submitted_for_review_at timestamptz,
  ADD COLUMN IF NOT EXISTS approval_updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE drivers DROP CONSTRAINT IF EXISTS drivers_approval_status_check;
ALTER TABLE drivers ADD CONSTRAINT drivers_approval_status_check CHECK (approval_status IN (
  'PENDIENTE_DOCUMENTOS', 'PENDIENTE_REVISION', 'OBSERVADO',
  'APROBADO', 'RECHAZADO', 'SUSPENDIDO'
));

UPDATE drivers d SET approval_status = CASE
  WHEN u.status='ACTIVE' THEN 'APROBADO'
  WHEN u.status='REJECTED' THEN 'RECHAZADO'
  WHEN u.status='SUSPENDED' THEN 'SUSPENDIDO'
  WHEN (SELECT count(DISTINCT dd.document_type) FROM driver_documents dd
    WHERE dd.driver_id=d.user_id AND dd.status<>'SUSPENDED'
      AND dd.document_type IN ('PROFILE_PHOTO','IDENTIFICATION','LICENSE','REGISTRATION','OPERATING_PERMIT'))=5
    THEN 'PENDIENTE_REVISION'
  ELSE 'PENDIENTE_DOCUMENTOS'
END
FROM users u
WHERE u.id=d.user_id;

CREATE TABLE IF NOT EXISTS driver_approval_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  reviewer_id uuid REFERENCES users(id),
  previous_status text NOT NULL,
  next_status text NOT NULL,
  decision text NOT NULL,
  observation text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  entity_type text,
  entity_id text,
  read_by uuid[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS driver_approval_notification_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id=1),
  admin_emails text[] NOT NULL DEFAULT '{}',
  email_enabled boolean NOT NULL DEFAULT false,
  internal_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO driver_approval_notification_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE INDEX IF NOT EXISTS drivers_approval_status_idx ON drivers (approval_status, approval_updated_at DESC);
CREATE INDEX IF NOT EXISTS driver_approval_reviews_driver_idx ON driver_approval_reviews (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_notifications_created_idx ON admin_notifications (created_at DESC);
