-- Repara campañas comerciales que pudieron saltarse el flujo financiero por
-- rutas administrativas antiguas. Las piezas internas (sin order_id) no se tocan.
WITH invalid_campaigns AS (
  SELECT banner.id, banner.campaign_status AS previous_status,
    CASE
      WHEN EXISTS (
        SELECT 1 FROM advertising_payments payment
        WHERE payment.order_id = banner.order_id
          AND payment.status IN ('RECEIVED','UNDER_REVIEW')
      ) THEN 'PAYMENT_REVIEW'
      ELSE 'PENDING_PAYMENT'
    END AS corrected_status
  FROM affiliate_banners banner
  JOIN advertising_orders orders ON orders.id = banner.order_id
  WHERE (banner.active OR banner.campaign_status IN ('PENDING_REVIEW','APPROVED','SCHEDULED','ACTIVE','PAUSED'))
    AND NOT (
      orders.status = 'PAID'
      AND EXISTS (
        SELECT 1 FROM advertising_payments payment
        WHERE payment.order_id = orders.id
          AND payment.status = 'APPROVED'
          AND payment.settlement_status = 'RECONCILED'
      )
    )
), repaired AS (
  UPDATE affiliate_banners banner
  SET active = false,
      campaign_status = invalid.corrected_status,
      updated_at = now()
  FROM invalid_campaigns invalid
  WHERE banner.id = invalid.id
  RETURNING banner.id, invalid.previous_status, invalid.corrected_status
)
INSERT INTO campaign_status_history(campaign_id, from_status, to_status, note)
SELECT id, previous_status, corrected_status,
  'Corrección automática: la campaña requería pago conciliado antes de revisión o publicación.'
FROM repaired;

CREATE OR REPLACE FUNCTION enforce_commercial_campaign_payment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.order_id IS NOT NULL
    AND (NEW.active OR NEW.campaign_status IN ('PENDING_REVIEW','APPROVED','SCHEDULED','ACTIVE','PAUSED'))
    AND NOT EXISTS (
      SELECT 1
      FROM advertising_orders orders
      WHERE orders.id = NEW.order_id
        AND orders.status = 'PAID'
        AND EXISTS (
          SELECT 1
          FROM advertising_payments payment
          WHERE payment.order_id = orders.id
            AND payment.status = 'APPROVED'
            AND payment.settlement_status = 'RECONCILED'
        )
    )
  THEN
    RAISE EXCEPTION 'PAYMENT_NOT_RECONCILED' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS affiliate_banners_payment_guard ON affiliate_banners;
CREATE TRIGGER affiliate_banners_payment_guard
  BEFORE INSERT OR UPDATE OF order_id, campaign_status, active
  ON affiliate_banners
  FOR EACH ROW
  EXECUTE FUNCTION enforce_commercial_campaign_payment();
