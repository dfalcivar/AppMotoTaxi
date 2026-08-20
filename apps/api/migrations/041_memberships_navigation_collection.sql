ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'COLLECTOR';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'FINANCE';

ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS navigation_pickup_provider text NOT NULL DEFAULT 'EXTERNAL_MAPS',
  ADD COLUMN IF NOT EXISTS navigation_destination_provider text NOT NULL DEFAULT 'EXTERNAL_MAPS',
  ADD COLUMN IF NOT EXISTS navigation_pickup_start_mode text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS navigation_destination_start_mode text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS mobile_cloud_map_style_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS text_search_minimum_characters integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS text_search_debounce_milliseconds integer NOT NULL DEFAULT 450,
  ADD COLUMN IF NOT EXISTS text_search_free_cap_reference integer NOT NULL DEFAULT 5000,
  ADD COLUMN IF NOT EXISTS text_search_price_per_thousand_usd numeric(10,2) NOT NULL DEFAULT 32,
  ADD COLUMN IF NOT EXISTS text_search_monthly_budget_usd numeric(10,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS text_search_warning_percent integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS text_search_critical_percent integer NOT NULL DEFAULT 95,
  ADD COLUMN IF NOT EXISTS text_search_hard_limit_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS navigation_free_cap_reference integer NOT NULL DEFAULT 1000,
  ADD COLUMN IF NOT EXISTS navigation_warning_percent integer NOT NULL DEFAULT 80,
  ADD COLUMN IF NOT EXISTS navigation_critical_percent integer NOT NULL DEFAULT 95,
  ADD COLUMN IF NOT EXISTS driver_memberships_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS membership_enforcement_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS membership_usage_billing_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS membership_suspension_scheduler_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collector_portal_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_transfer_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cash_collection_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS deuna_collection_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cooperative_payments_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collection_point_settlements_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collection_point_commissions_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS collection_point_limits_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS finance_role_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS membership_expiry_notice_days integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS membership_grace_days integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS membership_grace_allows_trips boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS membership_suspension_local_time time NOT NULL DEFAULT '07:00',
  ADD COLUMN IF NOT EXISTS membership_timezone text NOT NULL DEFAULT 'America/Guayaquil',
  ADD COLUMN IF NOT EXISTS new_driver_grace_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS new_driver_grace_duration_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS new_driver_grace_allows_trips boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS new_driver_grace_max_grants integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS membership_extra_trip_share_percent numeric(6,2) NOT NULL DEFAULT 40,
  ADD COLUMN IF NOT EXISTS membership_qr_duration_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS advertising_rotation_seconds integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS advertising_max_active_per_zone integer NOT NULL DEFAULT 10;

ALTER TABLE operational_settings DROP CONSTRAINT IF EXISTS operational_navigation_pickup_provider_check;
ALTER TABLE operational_settings ADD CONSTRAINT operational_navigation_pickup_provider_check
  CHECK (navigation_pickup_provider IN ('MAP_ONLY','EXTERNAL_MAPS','NAVIGATION_SDK'));
ALTER TABLE operational_settings DROP CONSTRAINT IF EXISTS operational_navigation_destination_provider_check;
ALTER TABLE operational_settings ADD CONSTRAINT operational_navigation_destination_provider_check
  CHECK (navigation_destination_provider IN ('MAP_ONLY','EXTERNAL_MAPS','NAVIGATION_SDK'));
ALTER TABLE operational_settings DROP CONSTRAINT IF EXISTS operational_navigation_pickup_start_mode_check;
ALTER TABLE operational_settings ADD CONSTRAINT operational_navigation_pickup_start_mode_check
  CHECK (navigation_pickup_start_mode IN ('MANUAL','AUTO'));
ALTER TABLE operational_settings DROP CONSTRAINT IF EXISTS operational_navigation_destination_start_mode_check;
ALTER TABLE operational_settings ADD CONSTRAINT operational_navigation_destination_start_mode_check
  CHECK (navigation_destination_start_mode IN ('MANUAL','AUTO'));

CREATE TABLE IF NOT EXISTS membership_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  period_unit text NOT NULL CHECK (period_unit IN ('DAY','MONTH','QUARTER','YEAR')),
  period_count integer NOT NULL CHECK (period_count > 0),
  duration_days integer NOT NULL CHECK (duration_days > 0),
  base_amount numeric(12,2) NOT NULL CHECK (base_amount >= 0),
  currency char(3) NOT NULL DEFAULT 'USD',
  included_trips integer NOT NULL DEFAULT 120 CHECK (included_trips >= 0),
  max_renewal_amount numeric(12,2) NOT NULL DEFAULT 30 CHECK (max_renewal_amount >= base_amount),
  extra_trip_share_percent numeric(6,2) NOT NULL DEFAULT 40 CHECK (extra_trip_share_percent BETWEEN 0 AND 100),
  enabled boolean NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

INSERT INTO membership_plans
  (code,name,period_unit,period_count,duration_days,base_amount,included_trips,max_renewal_amount,extra_trip_share_percent)
VALUES
  ('MONTHLY','Mensual','MONTH',1,30,12,120,30,40),
  ('QUARTERLY','Trimestral','QUARTER',1,90,36,360,90,40),
  ('ANNUAL','Anual','YEAR',1,365,144,1440,360,40)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS membership_grace_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  reason text NOT NULL,
  scope text NOT NULL CHECK (scope IN ('ALL','COOPERATIVE','DRIVER')),
  cooperative_id uuid REFERENCES cooperatives(id),
  driver_id uuid REFERENCES drivers(user_id),
  grace_days integer NOT NULL CHECK (grace_days >= 0),
  allows_trips boolean NOT NULL DEFAULT true,
  campaign_kind text NOT NULL DEFAULT 'RENEWAL' CHECK (campaign_kind IN ('RENEWAL','NEW_DRIVER_ONBOARDING')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  expiry_window_start date,
  expiry_window_end date,
  priority integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','FINISHED')),
  created_by uuid REFERENCES users(id),
  approved_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK ((scope='ALL' AND cooperative_id IS NULL AND driver_id IS NULL)
    OR (scope='COOPERATIVE' AND cooperative_id IS NOT NULL AND driver_id IS NULL)
    OR (scope='DRIVER' AND driver_id IS NOT NULL AND cooperative_id IS NULL))
);

CREATE TABLE IF NOT EXISTS driver_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  plan_id uuid REFERENCES membership_plans(id),
  plan_code text NOT NULL,
  status text NOT NULL CHECK (status IN ('PENDING','ACTIVE','EXPIRING','GRACE_PERIOD','PAYMENT_DUE','SUSPENSION_PENDING_ACTIVE_TRIP','SUSPENDED_NON_PAYMENT','SUSPENDED','CLOSED')),
  starts_at timestamptz,
  expires_at timestamptz,
  expiration_local_date date,
  grace_ends_at timestamptz,
  last_grace_local_date date,
  suspension_at timestamptz,
  suspension_timezone_snapshot text NOT NULL DEFAULT 'America/Guayaquil',
  suspension_local_time_snapshot time NOT NULL DEFAULT '07:00',
  suspension_pending_active_trip boolean NOT NULL DEFAULT false,
  suspended_non_payment_at timestamptz,
  reactivated_after_payment_at timestamptz,
  grace_policy_id uuid REFERENCES membership_grace_policies(id),
  grace_reason text,
  grace_days_applied integer NOT NULL DEFAULT 0,
  grace_allows_trips_applied boolean NOT NULL DEFAULT false,
  previous_membership_cycle_id uuid REFERENCES driver_memberships(id),
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  cycle_duration_snapshot integer NOT NULL DEFAULT 30,
  base_membership_amount_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  included_trips_snapshot integer NOT NULL DEFAULT 0,
  extra_trip_fee_snapshot numeric(12,4) NOT NULL DEFAULT 0,
  extra_trip_share_percent_snapshot numeric(6,2) NOT NULL DEFAULT 40,
  max_renewal_amount_snapshot numeric(12,2) NOT NULL DEFAULT 0,
  passenger_service_additional_snapshot numeric(12,4) NOT NULL DEFAULT 0,
  completed_trips integer NOT NULL DEFAULT 0,
  extra_trips integer NOT NULL DEFAULT 0,
  raw_extra_amount numeric(12,2) NOT NULL DEFAULT 0,
  billable_extra_amount numeric(12,2) NOT NULL DEFAULT 0,
  adjustment_amount numeric(12,2) NOT NULL DEFAULT 0,
  estimated_next_renewal_amount numeric(12,2) NOT NULL DEFAULT 0,
  final_renewal_amount numeric(12,2),
  cycle_closed_at timestamptz,
  cycle_close_reason text,
  opening_payment_id uuid,
  renewal_order_id uuid,
  payer_type text NOT NULL DEFAULT 'INDIVIDUAL' CHECK (payer_type IN ('INDIVIDUAL','COOPERATIVE')),
  cooperative_id uuid REFERENCES cooperatives(id),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  payment_status text NOT NULL DEFAULT 'PENDING',
  payment_method text,
  payment_reference text,
  paid_at timestamptz,
  renewed_at timestamptz,
  suspended_at timestamptz,
  suspension_reason text,
  source text NOT NULL DEFAULT 'NORMAL' CHECK (source IN ('NORMAL','MIGRATION','NEW_DRIVER_ONBOARDING','COURTESY')),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR starts_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_memberships_one_open_cycle_idx
  ON driver_memberships(driver_id) WHERE cycle_closed_at IS NULL;
CREATE INDEX IF NOT EXISTS driver_memberships_status_expiry_idx
  ON driver_memberships(status, expires_at, suspension_at);

CREATE TABLE IF NOT EXISTS membership_cycle_trip_usages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_cycle_id uuid NOT NULL REFERENCES driver_memberships(id),
  trip_id uuid NOT NULL REFERENCES trips(id),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  completed_at timestamptz NOT NULL,
  sequence_number integer NOT NULL,
  usage_kind text NOT NULL CHECK (usage_kind IN ('INCLUDED','EXTRA')),
  extra_trip_fee_snapshot numeric(12,4) NOT NULL DEFAULT 0,
  amount_before_cap numeric(12,2) NOT NULL DEFAULT 0,
  amount_after_cap numeric(12,2) NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  reversed_at timestamptz,
  reversal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id)
);

CREATE TABLE IF NOT EXISTS membership_cycle_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_cycle_id uuid NOT NULL REFERENCES driver_memberships(id),
  adjustment_type text NOT NULL CHECK (adjustment_type IN ('BONUS','DISCOUNT','WAIVER','POSITIVE','NEGATIVE','TRIP_REVERSAL')),
  amount numeric(12,2) NOT NULL,
  reason text NOT NULL,
  reference text,
  created_by uuid NOT NULL REFERENCES users(id),
  reversed_by uuid REFERENCES users(id),
  reversed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership_payment_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_token_hash text NOT NULL UNIQUE,
  short_code text NOT NULL UNIQUE,
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  membership_cycle_id uuid REFERENCES driver_memberships(id),
  plan_id uuid NOT NULL REFERENCES membership_plans(id),
  plan_snapshot jsonb NOT NULL,
  base_amount numeric(12,2) NOT NULL,
  prior_usage_amount numeric(12,2) NOT NULL DEFAULT 0,
  adjustment_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  intended_method text,
  receiver_scope text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (receiver_scope IN ('COLLECTION_POINT','COSTA_GO_CENTRAL','NOT_APPLICABLE')),
  verification_channel text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PENDING_VERIFICATION','PAID','REJECTED','EXPIRED','CANCELLED')),
  expires_at timestamptz NOT NULL,
  paid_at timestamptz,
  rejected_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid REFERENCES users(id),
  idempotency_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(driver_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS collection_points (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address text,
  service_area_id uuid REFERENCES service_areas(id),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED','INACTIVE')),
  cash_enabled boolean NOT NULL DEFAULT false,
  deuna_enabled boolean NOT NULL DEFAULT false,
  bank_transfer_enabled boolean NOT NULL DEFAULT false,
  settlement_deadline_hours integer NOT NULL DEFAULT 48,
  pending_limit numeric(12,2),
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collector_assignments (
  collector_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection_point_id uuid NOT NULL REFERENCES collection_points(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collector_id, collection_point_id, starts_at)
);

CREATE TABLE IF NOT EXISTS collection_point_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_point_id uuid NOT NULL REFERENCES collection_points(id),
  account_type text NOT NULL CHECK (account_type IN ('BANK_ACCOUNT','DEUNA')),
  bank_name text,
  account_type_name text,
  account_identifier_encrypted text,
  account_last_four text,
  holder_name text,
  holder_identification_encrypted text,
  deuna_reference text,
  enabled boolean NOT NULL DEFAULT true,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_until timestamptz,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS costa_go_payment_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_type text NOT NULL CHECK (account_type IN ('BANK_ACCOUNT','DEUNA')),
  bank_name text,
  account_type_name text,
  account_identifier_encrypted text,
  account_last_four text,
  holder_name text,
  holder_identification_encrypted text,
  enabled boolean NOT NULL DEFAULT true,
  remote_payments_enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES membership_payment_orders(id),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  membership_cycle_id uuid REFERENCES driver_memberships(id),
  collection_point_id uuid REFERENCES collection_points(id),
  collector_id uuid REFERENCES users(id),
  method text NOT NULL CHECK (method IN ('CASH','DEUNA','BANK_TRANSFER','COOPERATIVE','COURTESY')),
  receiver_scope text NOT NULL CHECK (receiver_scope IN ('COLLECTION_POINT','COSTA_GO_CENTRAL','NOT_APPLICABLE')),
  verification_channel text NOT NULL,
  amount numeric(12,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'USD',
  reference_normalized_hash text,
  reference_masked text,
  status text NOT NULL DEFAULT 'CONFIRMED' CHECK (status IN ('CONFIRMED','REVERSED')),
  settlement_status text NOT NULL DEFAULT 'NOT_APPLICABLE' CHECK (settlement_status IN ('NOT_APPLICABLE','PENDING_SETTLEMENT','PARTIALLY_SETTLED','SETTLED','DISPUTED','CANCELLED')),
  confirmed_by uuid NOT NULL REFERENCES users(id),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  reversed_by uuid REFERENCES users(id),
  reversed_at timestamptz,
  reversal_reason text,
  idempotency_key text NOT NULL UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS membership_payments_reference_scope_idx
  ON membership_payments(method, receiver_scope, reference_normalized_hash)
  WHERE reference_normalized_hash IS NOT NULL AND status='CONFIRMED';

CREATE TABLE IF NOT EXISTS membership_transfer_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES membership_payment_orders(id),
  bank_name text NOT NULL,
  reference_normalized_hash text NOT NULL,
  reference_masked text NOT NULL,
  transfer_date date NOT NULL,
  declared_amount numeric(12,2) NOT NULL,
  file_mime text NOT NULL CHECK (file_mime IN ('image/jpeg','image/png','image/webp','application/pdf')),
  file_data bytea NOT NULL CHECK (octet_length(file_data) BETWEEN 100 AND 5242880),
  observation text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_point_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_point_id uuid NOT NULL REFERENCES collection_points(id),
  collector_id uuid NOT NULL REFERENCES users(id),
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED','PENDING_SETTLEMENT','SETTLED','DISPUTED')),
  cash_total numeric(12,2) NOT NULL DEFAULT 0,
  deuna_total numeric(12,2) NOT NULL DEFAULT 0,
  transfer_total numeric(12,2) NOT NULL DEFAULT 0,
  gross_amount numeric(12,2) NOT NULL DEFAULT 0,
  commission_enabled_snapshot boolean NOT NULL DEFAULT false,
  commission_type_snapshot text NOT NULL DEFAULT 'NONE' CHECK (commission_type_snapshot IN ('NONE','FIXED_PER_PAYMENT','PERCENTAGE')),
  commission_value_snapshot numeric(12,4) NOT NULL DEFAULT 0,
  commission_amount numeric(12,2) NOT NULL DEFAULT 0,
  net_amount numeric(12,2) NOT NULL DEFAULT 0,
  closed_at timestamptz,
  settled_at timestamptz,
  verified_by uuid REFERENCES users(id),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_point_closure_payments (
  closure_id uuid NOT NULL REFERENCES collection_point_closures(id),
  payment_id uuid NOT NULL UNIQUE REFERENCES membership_payments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (closure_id, payment_id)
);

CREATE TABLE IF NOT EXISTS collection_point_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id uuid NOT NULL REFERENCES collection_point_closures(id),
  collection_point_id uuid NOT NULL REFERENCES collection_points(id),
  gross_amount numeric(12,2) NOT NULL,
  commission_amount numeric(12,2) NOT NULL,
  net_amount numeric(12,2) NOT NULL,
  method text NOT NULL,
  reference_normalized_hash text,
  reference_masked text,
  proof_mime text,
  proof_data bytea,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SUBMITTED','VERIFIED','REJECTED','DISPUTED')),
  submitted_at timestamptz,
  verified_at timestamptz,
  verified_by uuid REFERENCES users(id),
  notes text,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL CHECK (provider IN ('NAVIGATION_SDK','ROUTES','PLACES_AUTOCOMPLETE','PLACE_DETAILS','TEXT_SEARCH_PRO','GEOCODING','MOBILE_MAP','WEB_DYNAMIC_MAP')),
  environment text NOT NULL DEFAULT 'PRODUCTION',
  billing_period date NOT NULL,
  trip_id uuid REFERENCES trips(id),
  user_id uuid REFERENCES users(id),
  service_area_id uuid REFERENCES service_areas(id),
  cooperative_id uuid REFERENCES cooperatives(id),
  phase text,
  session_key_hash text,
  request_key text NOT NULL,
  result text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, request_key)
);
CREATE INDEX IF NOT EXISTS api_usage_period_provider_idx ON api_usage_events(billing_period, provider, environment);

CREATE TABLE IF NOT EXISTS driver_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_filename text NOT NULL,
  total_rows integer NOT NULL,
  valid_rows integer NOT NULL,
  imported_rows integer NOT NULL DEFAULT 0,
  rejected_rows integer NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('VALIDATED','COMPLETED','FAILED')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

ALTER TABLE drivers
  ADD COLUMN IF NOT EXISTS identity_number text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_by uuid REFERENCES users(id);
CREATE UNIQUE INDEX IF NOT EXISTS drivers_identity_number_unique_idx
  ON drivers(lower(identity_number)) WHERE identity_number IS NOT NULL;

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS brand text,
  ADD COLUMN IF NOT EXISTS model text,
  ADD COLUMN IF NOT EXISTS model_year integer,
  ADD COLUMN IF NOT EXISTS notes text;

CREATE TABLE IF NOT EXISTS driver_import_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES driver_import_batches(id) ON DELETE CASCADE,
  row_number integer NOT NULL,
  normalized_data jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('VALID','IMPORTED','REJECTED')),
  errors text[] NOT NULL DEFAULT '{}',
  driver_id uuid REFERENCES drivers(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(batch_id, row_number)
);

CREATE TABLE IF NOT EXISTS advertising_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  monthly_price numeric(12,2) NOT NULL DEFAULT 0,
  currency char(3) NOT NULL DEFAULT 'USD',
  default_weight integer NOT NULL DEFAULT 1 CHECK (default_weight BETWEEN 1 AND 10),
  allowed_placements text[] NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO advertising_plans(code,name,default_weight,allowed_placements)
VALUES
 ('BASIC','Básico',1,ARRAY['PASSENGER_SEARCHING_DRIVER']),
 ('PREMIUM','Premium',2,ARRAY['PASSENGER_SEARCHING_DRIVER','PASSENGER_WAITING_DRIVER','PASSENGER_TRIP_IN_PROGRESS'])
ON CONFLICT(code) DO NOTHING;

ALTER TABLE affiliate_banners
  ADD COLUMN IF NOT EXISTS advertiser_id uuid,
  ADD COLUMN IF NOT EXISTS advertiser_name text,
  ADD COLUMN IF NOT EXISTS advertising_plan_id uuid REFERENCES advertising_plans(id),
  ADD COLUMN IF NOT EXISTS service_area_id uuid REFERENCES service_areas(id),
  ADD COLUMN IF NOT EXISTS campaign_status text NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN IF NOT EXISTS weight integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS action_value text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES users(id);

ALTER TABLE affiliate_banners DROP CONSTRAINT IF EXISTS affiliate_banners_campaign_status_check;
ALTER TABLE affiliate_banners ADD CONSTRAINT affiliate_banners_campaign_status_check
  CHECK (campaign_status IN ('SCHEDULED','ACTIVE','PAUSED','FINISHED'));
ALTER TABLE affiliate_banners DROP CONSTRAINT IF EXISTS affiliate_banners_action_type_check;
ALTER TABLE affiliate_banners ADD CONSTRAINT affiliate_banners_action_type_check
  CHECK (action_type IN ('NONE','WEB','WHATSAPP','PHONE','MAPS','IN_APP'));

CREATE TABLE IF NOT EXISTS advertising_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES affiliate_banners(id),
  event_type text NOT NULL CHECK (event_type IN ('IMPRESSION','CLICK','ACTION')),
  exhibition_id text NOT NULL,
  session_key_hash text NOT NULL,
  placement text NOT NULL,
  service_area_id uuid REFERENCES service_areas(id),
  trip_status text,
  action_type text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(campaign_id,event_type,exhibition_id)
);
CREATE INDEX IF NOT EXISTS advertising_events_campaign_date_idx ON advertising_events(campaign_id, occurred_at DESC);

COMMENT ON COLUMN operational_settings.membership_enforcement_enabled IS
  'Debe permanecer false hasta validar membresías y pagos en pruebas controladas.';
