-- Toda renovación comercial necesita un pago pendiente propio. Las órdenes
-- creadas antes de esta corrección no tenían esa fila y no podían cobrarse.

INSERT INTO advertising_payments (
  order_id,
  advertiser_id,
  amount,
  currency,
  payment_method_id,
  status,
  settlement_status
)
SELECT
  orders.id,
  orders.advertiser_id,
  orders.amount,
  orders.currency,
  methods.id,
  'PENDING',
  'NOT_RECEIVED'
FROM advertising_orders orders
JOIN advertising_payment_methods methods
  ON methods.code = 'COMMERCIAL_MANAGED'
WHERE orders.renewal_of_campaign_id IS NOT NULL
  AND orders.status IN ('PENDING_PAYMENT', 'PAYMENT_REVIEW')
  AND NOT EXISTS (
    SELECT 1
    FROM advertising_payments payments
    WHERE payments.order_id = orders.id
  );
