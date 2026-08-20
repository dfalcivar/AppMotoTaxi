ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

ALTER TABLE membership_plans
  DROP CONSTRAINT IF EXISTS membership_plans_code_key;

CREATE UNIQUE INDEX IF NOT EXISTS membership_plans_code_version_key
  ON membership_plans(code, version);

CREATE UNIQUE INDEX IF NOT EXISTS membership_plans_one_current_code_key
  ON membership_plans(code)
  WHERE enabled = true AND effective_until IS NULL;

COMMENT ON COLUMN membership_plans.version IS
  'Versión inmutable de las condiciones comerciales del código lógico del plan.';
