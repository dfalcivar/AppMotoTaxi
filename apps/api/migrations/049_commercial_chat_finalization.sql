ALTER TABLE advertising_leads
  ADD COLUMN IF NOT EXISTS conversation_status text NOT NULL DEFAULT 'IN_PROGRESS';

ALTER TABLE advertising_leads
  DROP CONSTRAINT IF EXISTS advertising_leads_conversation_status_check;
ALTER TABLE advertising_leads
  ADD CONSTRAINT advertising_leads_conversation_status_check
  CHECK (conversation_status IN ('IN_PROGRESS','FINALIZADO'));

CREATE TABLE IF NOT EXISTS advertising_payment_upload_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES advertising_orders(id) ON DELETE CASCADE,
  payment_id uuid NOT NULL UNIQUE REFERENCES advertising_payments(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','OPENED','SUBMITTED','EXPIRED','REVOKED')),
  expires_at timestamptz NOT NULL,
  opened_at timestamptz,
  submitted_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS advertising_payment_upload_tokens_expiry_idx
  ON advertising_payment_upload_tokens(status, expires_at);

UPDATE advertising_payment_methods
SET name='Gestionado por un asesor',
    instructions='Un asesor de Costa-Go se comunicará contigo y te indicará los siguientes pasos.',
    updated_at=now()
WHERE code='COMMERCIAL_MANAGED';
