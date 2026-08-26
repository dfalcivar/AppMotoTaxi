-- Keep campaign delivery aligned with the current plan configuration. Older
-- editors could leave category/placement values that no longer represented the
-- plan purchased by the advertiser.
UPDATE affiliate_banners banner
SET category = CASE
      WHEN upper(coalesce(plan.code, '')) = 'PREMIUM'
        OR 'PASSENGER_WAITING_DRIVER' = ANY(coalesce(plan.allowed_placements, ARRAY[]::text[]))
        OR 'PASSENGER_TRIP_IN_PROGRESS' = ANY(coalesce(plan.allowed_placements, ARRAY[]::text[]))
      THEN 'PREMIUM'
      ELSE 'BASIC'
    END,
    placement = 'PASSENGER_SEARCHING_DRIVER',
    updated_at = now()
FROM advertising_plans plan
WHERE plan.id = banner.advertising_plan_id
  AND banner.order_id IS NOT NULL
  AND (
    banner.category IS DISTINCT FROM CASE
      WHEN upper(coalesce(plan.code, '')) = 'PREMIUM'
        OR 'PASSENGER_WAITING_DRIVER' = ANY(coalesce(plan.allowed_placements, ARRAY[]::text[]))
        OR 'PASSENGER_TRIP_IN_PROGRESS' = ANY(coalesce(plan.allowed_placements, ARRAY[]::text[]))
      THEN 'PREMIUM'
      ELSE 'BASIC'
    END
    OR banner.placement IS DISTINCT FROM 'PASSENGER_SEARCHING_DRIVER'
  );

-- A zero/null limit makes every valid campaign disappear and leaves only the
-- mobile fallback. Preserve the configured value whenever it is valid.
UPDATE operational_settings
SET advertising_max_active_per_zone = 10,
    updated_at = now()
WHERE id = 1
  AND coalesce(advertising_max_active_per_zone, 0) < 1;
