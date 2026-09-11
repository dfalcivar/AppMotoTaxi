ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS mobile_visible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS mobile_sort_order integer NOT NULL DEFAULT 0;

-- Give the existing catalogue a deterministic initial order without changing
-- whether a plan is commercially active.
WITH ranked AS (
  SELECT id,row_number() OVER (
    PARTITION BY plan_type,(enabled AND effective_until IS NULL)
    ORDER BY duration_days,included_trips,name,version DESC,id
  )-1 AS position
  FROM membership_plans
)
UPDATE membership_plans p
SET mobile_sort_order=ranked.position
FROM ranked
WHERE ranked.id=p.id;

CREATE INDEX IF NOT EXISTS membership_plans_mobile_catalog_idx
  ON membership_plans(plan_type,mobile_sort_order,name)
  WHERE enabled AND mobile_visible AND effective_until IS NULL;

COMMENT ON COLUMN membership_plans.mobile_visible IS
  'Controls catalogue visibility in the driver mobile app without deactivating the commercial plan.';
COMMENT ON COLUMN membership_plans.mobile_sort_order IS
  'Stable display order inside each mobile membership modality.';
