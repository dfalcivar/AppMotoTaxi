-- Make approved drivers that predate memberships visible in the dashboard.
-- The pending cycle does not charge, activate, suspend, or grant free service.
WITH defaults AS (
  SELECT mp.*, os.membership_timezone, os.membership_suspension_local_time,
    os.membership_extra_trip_share_percent,
    COALESCE((SELECT pv.platform_commission_cents_per_leg FROM pricing_versions pv
      WHERE pv.active_from <= now() AND (pv.active_until IS NULL OR pv.active_until > now())
      ORDER BY pv.active_from DESC LIMIT 1), 5)::numeric / 100 AS passenger_service_additional
  FROM membership_plans mp CROSS JOIN operational_settings os
  WHERE mp.code = 'MONTHLY' AND mp.enabled = true AND os.id = 1
  ORDER BY mp.effective_from DESC LIMIT 1
)
INSERT INTO driver_memberships (
  driver_id, plan_id, plan_code, status,
  suspension_timezone_snapshot, suspension_local_time_snapshot,
  plan_snapshot, cycle_duration_snapshot, base_membership_amount_snapshot,
  included_trips_snapshot, extra_trip_fee_snapshot,
  extra_trip_share_percent_snapshot, max_renewal_amount_snapshot,
  passenger_service_additional_snapshot, estimated_next_renewal_amount,
  payer_type, amount, currency, payment_status, source
)
SELECT d.user_id, cfg.id, cfg.code, 'PENDING',
  cfg.membership_timezone, cfg.membership_suspension_local_time,
  jsonb_build_object('code',cfg.code,'name',cfg.name,'periodUnit',cfg.period_unit,'periodCount',cfg.period_count),
  cfg.duration_days, cfg.base_amount, cfg.included_trips,
  round(cfg.passenger_service_additional * cfg.membership_extra_trip_share_percent / 100, 4),
  cfg.membership_extra_trip_share_percent, cfg.max_renewal_amount,
  cfg.passenger_service_additional, cfg.base_amount,
  'INDIVIDUAL', cfg.base_amount, cfg.currency, 'PENDING', 'MIGRATION'
FROM drivers d CROSS JOIN defaults cfg
WHERE d.approval_status = 'APROBADO'
  AND NOT EXISTS (
    SELECT 1 FROM driver_memberships dm
    WHERE dm.driver_id = d.user_id AND dm.cycle_closed_at IS NULL
  );
