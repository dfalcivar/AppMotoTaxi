ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified_at timestamptz;

-- Las cuentas creadas antes de esta funcionalidad conservan su acceso.
UPDATE users
SET email_verified_at = coalesce(email_verified_at, created_at)
WHERE email IS NOT NULL AND email_verified_at IS NULL;

CREATE TABLE IF NOT EXISTS email_verification_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_verification_codes_user_created_idx
  ON email_verification_codes (user_id, created_at DESC);
