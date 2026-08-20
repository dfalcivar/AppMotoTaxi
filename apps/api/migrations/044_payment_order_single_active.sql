-- Una orden presencial pendiente puede regenerarse si caduca, pero no debe
-- duplicarse mientras su QR siga vigente. Las órdenes con comprobante en
-- revisión se conservan; el servicio impide crear otra mediante bloqueo.
WITH pending_ranked AS (
  SELECT id,
         row_number() OVER (PARTITION BY driver_id ORDER BY created_at DESC, id DESC) AS position
  FROM membership_payment_orders
  WHERE status = 'PENDING'
)
UPDATE membership_payment_orders AS payment_order
SET status = 'CANCELLED',
    cancelled_at = COALESCE(cancelled_at, now()),
    metadata = metadata || '{"cancelReason":"LEGACY_DUPLICATE_PENDING_ORDER"}'::jsonb,
    updated_at = now()
FROM pending_ranked
WHERE payment_order.id = pending_ranked.id
  AND pending_ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS membership_payment_orders_one_pending_per_driver
  ON membership_payment_orders(driver_id)
  WHERE status = 'PENDING';
