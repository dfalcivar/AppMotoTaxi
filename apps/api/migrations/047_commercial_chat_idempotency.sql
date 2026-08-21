-- Evita prospectos y órdenes duplicadas cuando el navegador reintenta una
-- solicitud o el usuario pulsa continuar más de una vez.
ALTER TABLE advertising_leads
  ADD COLUMN IF NOT EXISTS submission_key text;

CREATE UNIQUE INDEX IF NOT EXISTS advertising_leads_submission_key_uidx
  ON advertising_leads(submission_key)
  WHERE submission_key IS NOT NULL;

ALTER TABLE advertising_orders
  ADD COLUMN IF NOT EXISTS invitation_id uuid REFERENCES advertising_invitations(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS advertising_orders_invitation_uidx
  ON advertising_orders(invitation_id)
  WHERE invitation_id IS NOT NULL;

