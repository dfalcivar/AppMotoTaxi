ALTER TABLE membership_plans
  ADD COLUMN IF NOT EXISTS plan_type text NOT NULL DEFAULT 'PERIODIC',
  ADD COLUMN IF NOT EXISTS pack_validity_days integer;

ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS membership_plans_plan_type_check;
ALTER TABLE membership_plans ADD CONSTRAINT membership_plans_plan_type_check
  CHECK (plan_type IN ('PERIODIC','TRIP_PACK'));

ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS membership_plans_pack_validity_days_check;
ALTER TABLE membership_plans ADD CONSTRAINT membership_plans_pack_validity_days_check
  CHECK (pack_validity_days IS NULL OR pack_validity_days BETWEEN 1 AND 3650);

ALTER TABLE membership_plans DROP CONSTRAINT IF EXISTS membership_plans_trip_pack_credits_check;
ALTER TABLE membership_plans ADD CONSTRAINT membership_plans_trip_pack_credits_check
  CHECK (plan_type <> 'TRIP_PACK' OR included_trips > 0);

ALTER TABLE driver_memberships
  ADD COLUMN IF NOT EXISTS plan_type_snapshot text NOT NULL DEFAULT 'PERIODIC',
  ADD COLUMN IF NOT EXISTS exhausted_at timestamptz;

ALTER TABLE driver_memberships DROP CONSTRAINT IF EXISTS driver_memberships_plan_type_snapshot_check;
ALTER TABLE driver_memberships ADD CONSTRAINT driver_memberships_plan_type_snapshot_check
  CHECK (plan_type_snapshot IN ('PERIODIC','TRIP_PACK'));

ALTER TABLE driver_memberships DROP CONSTRAINT IF EXISTS driver_memberships_status_check;
ALTER TABLE driver_memberships ADD CONSTRAINT driver_memberships_status_check
  CHECK (status IN (
    'PENDING','ACTIVE','EXPIRING','GRACE_PERIOD','PAYMENT_DUE',
    'SUSPENSION_PENDING_ACTIVE_TRIP','SUSPENDED_NON_PAYMENT','SUSPENDED',
    'EXHAUSTED','CLOSED'
  ));

COMMENT ON COLUMN membership_plans.plan_type IS
  'PERIODIC conserva el ciclo por fechas; TRIP_PACK consume créditos hasta agotarlos.';
COMMENT ON COLUMN membership_plans.pack_validity_days IS
  'Vigencia opcional de un paquete desde su activación. NULL significa sin caducidad.';
COMMENT ON COLUMN driver_memberships.plan_type_snapshot IS
  'Modalidad inmutable aplicada al saldo/ciclo del conductor.';
COMMENT ON COLUMN driver_memberships.exhausted_at IS
  'Momento en que un paquete consumió su último viaje; no interrumpe el viaje ya aceptado.';
