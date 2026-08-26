-- A plan category is a commercial promise. Keep its effective placements stable
-- and repair plans/campaigns that were reduced to one placement by the old editor.
UPDATE advertising_plans
SET placement = 'PASSENGER_SEARCHING_DRIVER',
    allowed_placements = ARRAY[
      'PASSENGER_SEARCHING_DRIVER',
      'PASSENGER_WAITING_DRIVER',
      'PASSENGER_TRIP_IN_PROGRESS'
    ],
    updated_at = now()
WHERE upper(code) = 'PREMIUM'
   OR lower(name) = 'premium';

UPDATE advertising_plans
SET placement = 'PASSENGER_SEARCHING_DRIVER',
    allowed_placements = ARRAY['PASSENGER_SEARCHING_DRIVER'],
    updated_at = now()
WHERE upper(code) = 'BASIC'
   OR lower(name) IN ('básico', 'basico');

UPDATE affiliate_banners banner
SET category = CASE
      WHEN 'PASSENGER_WAITING_DRIVER' = ANY(plan.allowed_placements)
        OR 'PASSENGER_TRIP_IN_PROGRESS' = ANY(plan.allowed_placements)
        OR upper(plan.code) = 'PREMIUM'
        OR lower(plan.name) = 'premium'
      THEN 'PREMIUM'
      ELSE 'BASIC'
    END,
    updated_at = now()
FROM advertising_plans plan
WHERE plan.id = banner.advertising_plan_id
  AND banner.order_id IS NOT NULL
  AND coalesce(banner.category, '') NOT IN ('BASIC', 'PREMIUM');

-- Repair commercial Premium campaigns even if the old plan editor already
-- collapsed allowed_placements before this migration ran.
UPDATE affiliate_banners banner
SET category = 'PREMIUM', updated_at = now()
FROM advertising_plans plan
WHERE plan.id = banner.advertising_plan_id
  AND banner.order_id IS NOT NULL
  AND (upper(plan.code) = 'PREMIUM' OR lower(plan.name) = 'premium');
