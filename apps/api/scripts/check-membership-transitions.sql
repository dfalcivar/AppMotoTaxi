-- Read-only review for an authorized operator after deployment. Never applies transitions.
BEGIN READ ONLY;
SELECT count(*) AS expired_memberships_awaiting_transition
FROM driver_memberships
WHERE cycle_closed_at IS NULL AND status IN ('ACTIVE', 'EXPIRING') AND expires_at <= now();

SELECT count(*) AS grace_or_payment_due_awaiting_suspension
FROM driver_memberships
WHERE cycle_closed_at IS NULL AND status IN ('GRACE_PERIOD', 'PAYMENT_DUE')
  AND suspension_at IS NOT NULL AND suspension_at <= now()
  AND active_courtesy_benefit(driver_id) IS NULL
  AND active_free_trip_benefit(driver_id) IS NULL;

SELECT count(*) AS expired_payment_orders_awaiting_transition
FROM membership_payment_orders
WHERE status IN ('PENDING', 'PENDING_VERIFICATION') AND expires_at <= now();
COMMIT;
