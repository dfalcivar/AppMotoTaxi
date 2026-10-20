-- Run only by an authorized administrator in a read-only production session.
-- Aggregate counts only: no user, driver, membership or order identifiers leave the query.
-- This script never invokes the scheduler or changes a membership, driver or order.
BEGIN READ ONLY;

SELECT membership_suspension_scheduler_enabled AS scheduler_enabled,
       membership_enforcement_enabled AS enforcement_enabled
FROM operational_settings WHERE id = 1;

WITH settings AS (
  SELECT membership_expiry_notice_days AS notice_days,
         membership_grace_days AS default_grace_days,
         membership_timezone AS timezone
  FROM operational_settings WHERE id = 1
), expired AS (
  SELECT dm.expires_at AS due_at,
         coalesce(policy.grace_days, settings.default_grace_days, 0) AS grace_days
  FROM driver_memberships dm CROSS JOIN settings
  LEFT JOIN LATERAL (
    SELECT gp.grace_days
    FROM membership_grace_policies gp
    WHERE gp.status = 'ACTIVE' AND gp.campaign_kind = 'RENEWAL'
      AND gp.starts_at <= now() AND gp.ends_at > now()
      AND (gp.expiry_window_start IS NULL OR
           (dm.expires_at AT TIME ZONE settings.timezone)::date >= gp.expiry_window_start)
      AND (gp.expiry_window_end IS NULL OR
           (dm.expires_at AT TIME ZONE settings.timezone)::date <= gp.expiry_window_end)
      AND (gp.scope = 'ALL' OR
           (gp.scope = 'COOPERATIVE' AND gp.cooperative_id = dm.cooperative_id) OR
           (gp.scope = 'DRIVER' AND gp.driver_id = dm.driver_id))
    ORDER BY CASE gp.scope WHEN 'DRIVER' THEN 3 WHEN 'COOPERATIVE' THEN 2 ELSE 1 END DESC,
             gp.priority DESC, gp.created_at DESC
    LIMIT 1
  ) policy ON true
  WHERE dm.cycle_closed_at IS NULL
    AND dm.status IN ('ACTIVE', 'EXPIRING') AND dm.expires_at <= now()
), candidates AS (
  -- Age starts when the notice window opens, not at the future expiry date.
  SELECT 'EXPIRING_NOTICE'::text AS transition_type,
         dm.expires_at - (settings.notice_days * interval '1 day') AS due_at
  FROM driver_memberships dm CROSS JOIN settings
  WHERE dm.cycle_closed_at IS NULL AND dm.status = 'ACTIVE'
    AND dm.expires_at > now()
    AND dm.expires_at <= now() + (settings.notice_days * interval '1 day')
  UNION ALL
  SELECT CASE WHEN grace_days > 0 THEN 'EXPIRED_TO_GRACE' ELSE 'EXPIRED_TO_PAYMENT_DUE' END, due_at
  FROM expired
  UNION ALL
  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM trips t WHERE t.driver_id = dm.driver_id
        AND t.status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
    ) THEN 'DUE_TO_PENDING_ACTIVE_TRIP' ELSE 'DUE_TO_SUSPENDED_NON_PAYMENT' END,
    dm.suspension_at
  FROM driver_memberships dm
  WHERE dm.cycle_closed_at IS NULL
    AND dm.status IN ('GRACE_PERIOD', 'PAYMENT_DUE')
    AND dm.suspension_at IS NOT NULL AND dm.suspension_at <= now()
    AND active_courtesy_benefit(dm.driver_id) IS NULL
    AND active_free_trip_benefit(dm.driver_id) IS NULL
  UNION ALL
  SELECT 'PENDING_TRIP_ENDED_TO_SUSPENDED', dm.suspension_at
  FROM driver_memberships dm
  WHERE dm.cycle_closed_at IS NULL AND dm.status = 'SUSPENSION_PENDING_ACTIVE_TRIP'
    AND active_courtesy_benefit(dm.driver_id) IS NULL
    AND active_free_trip_benefit(dm.driver_id) IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM trips t WHERE t.driver_id = dm.driver_id
        AND t.status IN ('ASSIGNED', 'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'IN_PROGRESS')
    )
  UNION ALL
  SELECT 'PAYMENT_ORDER_EXPIRED', expires_at
  FROM membership_payment_orders
  WHERE status IN ('PENDING', 'PENDING_VERIFICATION') AND expires_at <= now()
)
SELECT transition_type,
       CASE WHEN due_at IS NULL THEN 'unknown'
            WHEN due_at > now() - interval '1 day' THEN '0-1d'
            WHEN due_at > now() - interval '7 days' THEN '1-7d'
            WHEN due_at > now() - interval '30 days' THEN '7-30d'
            ELSE '30d+' END AS age_bucket,
       count(*) AS pending_count
FROM candidates
GROUP BY transition_type, age_bucket
ORDER BY transition_type, age_bucket;

-- Informational only: these grace/payment cycles are not yet due for suspension.
SELECT status AS current_status,
       count(*) AS not_yet_due_count
FROM driver_memberships
WHERE cycle_closed_at IS NULL AND status IN ('GRACE_PERIOD', 'PAYMENT_DUE')
  AND (suspension_at IS NULL OR suspension_at > now())
GROUP BY status ORDER BY status;

COMMIT;
