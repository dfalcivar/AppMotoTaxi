-- Renovaciones comerciales encadenadas y publicidad institucional auditable.

ALTER TABLE advertising_orders
  ADD COLUMN IF NOT EXISTS renewal_of_campaign_id uuid REFERENCES affiliate_banners(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS content_reused boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS advertising_orders_one_renewal_per_campaign_uidx
  ON advertising_orders(renewal_of_campaign_id)
  WHERE renewal_of_campaign_id IS NOT NULL
    AND status NOT IN ('CANCELLED', 'REFUNDED');

ALTER TABLE affiliate_banners
  ADD COLUMN IF NOT EXISTS internal_campaign_type text,
  ADD COLUMN IF NOT EXISTS internal_partner_name text,
  ADD COLUMN IF NOT EXISTS internal_reason text,
  ADD COLUMN IF NOT EXISTS internal_reference text,
  ADD COLUMN IF NOT EXISTS internal_authorized_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS internal_authorized_at timestamptz;

UPDATE affiliate_banners
SET internal_campaign_type = 'COSTA_GO',
    internal_reason = COALESCE(NULLIF(internal_reason, ''), 'Contenido institucional existente'),
    internal_authorized_by = COALESCE(internal_authorized_by, created_by),
    internal_authorized_at = COALESCE(internal_authorized_at, created_at)
WHERE order_id IS NULL
  AND internal_campaign_type IS NULL;

ALTER TABLE affiliate_banners
  DROP CONSTRAINT IF EXISTS affiliate_banners_internal_campaign_type_check;

ALTER TABLE affiliate_banners
  ADD CONSTRAINT affiliate_banners_internal_campaign_type_check
  CHECK (
    internal_campaign_type IS NULL OR
    internal_campaign_type IN ('COSTA_GO', 'PAYMENT_POINT', 'STRATEGIC_ALLIANCE', 'COURTESY')
  );

COMMENT ON COLUMN advertising_orders.renewal_of_campaign_id IS
  'Campaña cuya vigencia se renueva. Cada renovación genera una orden y conserva trazabilidad financiera.';
COMMENT ON COLUMN advertising_orders.content_reused IS
  'Indica que la renovación reutiliza sin cambios la pieza ya aprobada y puede programarse al conciliar el pago.';
COMMENT ON COLUMN affiliate_banners.internal_campaign_type IS
  'Clasificación administrativa para piezas sin orden comercial: Costa-Go, punto de pago, alianza o cortesía.';
COMMENT ON COLUMN affiliate_banners.internal_authorized_by IS
  'Administrador que autorizó o actualizó por última vez la publicación institucional.';
