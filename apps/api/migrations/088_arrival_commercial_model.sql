ALTER TABLE operational_settings ADD COLUMN IF NOT EXISTS arrival_commercial_configuration jsonb;
ALTER TABLE operational_settings ADD COLUMN IF NOT EXISTS arrival_commercial_version integer NOT NULL DEFAULT 0;
ALTER TABLE driver_memberships ADD COLUMN IF NOT EXISTS arrival_billing_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE driver_memberships ADD COLUMN IF NOT EXISTS prior_cycle_due numeric(12,2) NOT NULL DEFAULT 0;
ALTER TABLE membership_cycle_trip_usages ADD COLUMN IF NOT EXISTS theoretical_commission numeric(12,2);
ALTER TABLE membership_cycle_trip_usages ADD COLUMN IF NOT EXISTS applied_commission numeric(12,2);
ALTER TABLE membership_payment_orders ALTER COLUMN plan_id DROP NOT NULL;
ALTER TABLE membership_payment_orders ADD COLUMN IF NOT EXISTS purpose text NOT NULL DEFAULT 'MEMBERSHIP'
  CHECK(purpose IN ('MEMBERSHIP','WALLET_TOPUP'));
ALTER TABLE membership_payment_orders ADD CONSTRAINT payment_order_purpose_plan_check
  CHECK ((purpose='MEMBERSHIP' AND plan_id IS NOT NULL) OR (purpose='WALLET_TOPUP' AND plan_id IS NULL AND membership_cycle_id IS NULL));

CREATE TABLE driver_wallets (
  driver_id uuid PRIMARY KEY REFERENCES drivers(user_id),
  total numeric(12,2) NOT NULL DEFAULT 0 CHECK(total>=0),
  reserved numeric(12,2) NOT NULL DEFAULT 0 CHECK(reserved>=0 AND reserved<=total),
  enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE driver_wallet_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES driver_wallets(driver_id),
  kind text NOT NULL CHECK(kind IN ('TOPUP','RESERVE','RELEASE','TRIP_COMMISSION','REVERSAL','ADMIN_ADJUSTMENT')),
  amount numeric(12,2) NOT NULL,
  total_before numeric(12,2) NOT NULL, total_after numeric(12,2) NOT NULL,
  reserved_before numeric(12,2) NOT NULL, reserved_after numeric(12,2) NOT NULL,
  trip_id uuid REFERENCES trips(id), payment_id uuid REFERENCES membership_payments(id),
  actor_id uuid REFERENCES users(id), reason text NOT NULL,
  idempotency_key text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX wallet_movements_driver_date ON driver_wallet_movements(driver_id,created_at DESC);
CREATE TABLE trip_commercial_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES trips(id),driver_id uuid NOT NULL REFERENCES drivers(user_id),
  membership_id uuid REFERENCES driver_memberships(id),
  snapshot jsonb NOT NULL,
  reserved_amount numeric(12,2) NOT NULL DEFAULT 0 CHECK(reserved_amount>=0),
  completed_at timestamptz,released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(trip_id,driver_id)
);
CREATE TABLE arrival_search_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),passenger_id uuid NOT NULL REFERENCES users(id),
  started_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,
  route_points jsonb NOT NULL,configuration jsonb NOT NULL,max_round_reached integer NOT NULL DEFAULT 1 CHECK(max_round_reached>=1),
  matched_round integer,confirmed_arrival_fee numeric(12,2),cancel_count integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','COMPLETED','EXPIRED'))
);
CREATE INDEX arrival_sessions_passenger_expiry ON arrival_search_sessions(passenger_id,expires_at DESC);
ALTER TABLE trips ADD COLUMN IF NOT EXISTS arrival_search_session_id uuid REFERENCES arrival_search_sessions(id);
CREATE TABLE arrival_search_exclusions (
  session_id uuid NOT NULL REFERENCES arrival_search_sessions(id),driver_id uuid NOT NULL REFERENCES drivers(user_id),
  created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(session_id,driver_id)
);
ALTER TABLE driver_offers ADD COLUMN IF NOT EXISTS economic_snapshot jsonb;
CREATE TABLE package_commercial_rules (
  plan_code text PRIMARY KEY,
  commercial_factor numeric(12,6) NOT NULL CHECK(commercial_factor>=0),
  volume_discount_percent numeric(8,5) NOT NULL CHECK(volume_discount_percent BETWEEN 0 AND 100),
  fixed_cost numeric(12,2) NOT NULL CHECK(fixed_cost>=0),minimum_price numeric(12,2) NOT NULL CHECK(minimum_price>=0),
  service_area_id uuid REFERENCES service_areas(id),version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now(),updated_by uuid REFERENCES users(id)
);
CREATE TABLE package_price_calculations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid NOT NULL REFERENCES membership_plans(id),
  rule_version integer NOT NULL,configuration_version text NOT NULL,snapshot jsonb NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX package_calculation_latest ON package_price_calculations(plan_id,calculated_at DESC);
CREATE TABLE package_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL UNIQUE REFERENCES membership_payment_orders(id),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),membership_id uuid NOT NULL REFERENCES driver_memberships(id),
  quantity integer NOT NULL CHECK(quantity>0),used integer NOT NULL DEFAULT 0 CHECK(used>=0 AND used<=quantity),
  snapshot jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);

-- One audited operation, one account lock. All callers share the existing
-- membership billing lock, including payment approval and trip acceptance.
CREATE FUNCTION apply_driver_wallet_movement(p_driver uuid,p_kind text,p_amount numeric,p_key text,
  p_trip uuid,p_payment uuid,p_actor uuid,p_reason text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE w driver_wallets%ROWTYPE; previous driver_wallet_movements%ROWTYPE;
  next_total numeric(12,2);next_reserved numeric(12,2);movement_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount::text IN ('NaN','Infinity','-Infinity') OR p_amount<>round(p_amount,2)
    OR p_key IS NULL OR length(trim(p_key))=0 OR p_reason IS NULL OR length(trim(p_reason))=0 THEN
    RAISE EXCEPTION 'INVALID_WALLET_MOVEMENT'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('membership-order:'||p_driver::text));
  SELECT * INTO previous FROM driver_wallet_movements WHERE idempotency_key=p_key;
  IF FOUND THEN
    IF previous.driver_id<>p_driver OR previous.kind<>p_kind OR previous.amount<>p_amount
      OR previous.trip_id IS DISTINCT FROM p_trip OR previous.payment_id IS DISTINCT FROM p_payment THEN
      RAISE EXCEPTION 'WALLET_IDEMPOTENCY_CONFLICT'; END IF;
    RETURN previous.id;
  END IF;
  INSERT INTO driver_wallets(driver_id) VALUES(p_driver) ON CONFLICT DO NOTHING;
  SELECT * INTO w FROM driver_wallets WHERE driver_id=p_driver FOR UPDATE;
  next_total:=w.total;next_reserved:=w.reserved;
  IF p_kind IN ('TOPUP','REVERSAL','ADMIN_ADJUSTMENT') THEN next_total:=next_total+p_amount;
  ELSIF p_kind='RESERVE' THEN next_reserved:=next_reserved+p_amount;
  ELSIF p_kind='RELEASE' THEN next_reserved:=next_reserved-p_amount;
  ELSIF p_kind='TRIP_COMMISSION' THEN next_total:=next_total-p_amount;next_reserved:=next_reserved-p_amount;
  ELSE RAISE EXCEPTION 'INVALID_WALLET_MOVEMENT'; END IF;
  IF p_kind<>'ADMIN_ADJUSTMENT' AND p_amount<0 THEN RAISE EXCEPTION 'INVALID_WALLET_AMOUNT'; END IF;
  IF next_reserved<0 OR next_total<0 OR next_reserved>next_total THEN RAISE EXCEPTION 'INSUFFICIENT_AVAILABLE_BALANCE'; END IF;
  UPDATE driver_wallets SET total=next_total,reserved=next_reserved,updated_at=now() WHERE driver_id=p_driver;
  INSERT INTO driver_wallet_movements(driver_id,kind,amount,total_before,total_after,reserved_before,reserved_after,
    trip_id,payment_id,actor_id,reason,idempotency_key)
  VALUES(p_driver,p_kind,p_amount,w.total,next_total,w.reserved,next_reserved,p_trip,p_payment,p_actor,p_reason,p_key)
  RETURNING id INTO movement_id;
  RETURN movement_id;
END $$;

CREATE FUNCTION settle_trip_commercial_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a trip_commercial_assignments%ROWTYPE; complete boolean;
BEGIN
  IF NEW.arrival_search_session_id IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE arrival_search_sessions SET status=CASE WHEN NEW.status::text='COMPLETED' THEN 'COMPLETED' ELSE status END,
      cancel_count=cancel_count+CASE WHEN NEW.status::text='CANCELLED' THEN 1 ELSE 0 END WHERE id=NEW.arrival_search_session_id;
  END IF;
  IF OLD.driver_id IS NULL THEN RETURN NEW; END IF;
  complete:=NEW.status::text='COMPLETED';
  IF NOT complete AND NEW.status::text<>'CANCELLED' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('membership-order:'||OLD.driver_id::text));
  SELECT * INTO a FROM trip_commercial_assignments WHERE trip_id=OLD.id AND driver_id=OLD.driver_id FOR UPDATE;
  IF NOT FOUND OR a.completed_at IS NOT NULL OR a.released_at IS NOT NULL THEN RETURN NEW; END IF;
  IF a.snapshot->>'billingMode'='PAY_PER_USE' THEN
    PERFORM apply_driver_wallet_movement(a.driver_id,CASE WHEN complete THEN 'TRIP_COMMISSION' ELSE 'RELEASE' END,
      a.reserved_amount,CASE WHEN complete THEN 'trip-debit:' ELSE 'trip-release:' END||a.id::text,
      a.trip_id,NULL,NULL,CASE WHEN complete THEN 'Comisión al completar viaje' ELSE 'Liberación de viaje no completado' END);
  END IF;
  UPDATE trip_commercial_assignments SET completed_at=CASE WHEN complete THEN now() END,
    released_at=CASE WHEN NOT complete THEN now() END WHERE id=a.id;
  RETURN NEW;
END $$;
CREATE TRIGGER trip_commercial_settlement AFTER UPDATE OF status,driver_id ON trips
  FOR EACH ROW EXECUTE FUNCTION settle_trip_commercial_assignment();

CREATE FUNCTION trip_offer_economics(p_trip uuid,p_round integer) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE t trips%ROWTYPE;q jsonb;e jsonb;r integer;fee numeric;commission numeric;
BEGIN
  SELECT * INTO t FROM trips WHERE id=p_trip;
  e:=t.pricing_snapshot->'economic';
  IF e IS NOT NULL THEN RETURN e-'billingMode'-'appliedCommission'-'membershipId'-'planId'-'packageId'
    -'balanceBefore'-'availableBefore'-'reservedCommission'-'periodCap'-'accruedBefore'-'accruedAfter'-'usedTrips'-'includedTrips'-'legacyTerms'
    -'packagePurchaseId'-'economicProfit'-'extraDriver'; END IF;
  q:=t.pricing_snapshot->'economicQuote';
  IF q IS NULL THEN RETURN NULL; END IF;
  r:=greatest(p_round,coalesce((q->>'minimumRound')::int,1));
  fee:=round((q->>'feePerRound')::numeric*r,2);
  commission:=round(fee*(q->>'costaGoPercent')::numeric/100,2);
  RETURN jsonb_build_object('isScheduledTrip',false,'matchedRound',r,
    'radiusMeters',least((q->'settings'->>'maximumRadiusMeters')::int,
      (q->'settings'->>'initialRadiusMeters')::int+(r-1)*(q->'settings'->>'radiusIncrementMeters')::int),
    'arrivalFee',fee::text,'feePerRound',q->>'feePerRound','journeyFare',q->>'journeyFare',
    'passengerTotal',round((q->>'journeyFare')::numeric+fee,2)::text,
    'costaGoPercent',q->>'costaGoPercent','theoreticalCommission',commission::text,
    'economicConfigurationVersion',q->>'version','settings',q->'settings');
END $$;

CREATE FUNCTION commercial_driver_can_accept(p_driver uuid,p_trip uuid,p_round integer) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE e jsonb;m driver_memberships%ROWTYPE;w driver_wallets%ROWTYPE;
BEGIN
  e:=trip_offer_economics(p_trip,p_round);
  IF e IS NULL THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM arrival_search_exclusions x JOIN trips t ON t.arrival_search_session_id=x.session_id
    WHERE t.id=p_trip AND x.driver_id=p_driver) THEN RETURN false; END IF;
  SELECT * INTO m FROM driver_memberships WHERE driver_id=p_driver AND cycle_closed_at IS NULL;
  IF FOUND THEN
    IF m.status IN ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP') THEN RETURN false; END IF;
    IF m.status IN ('ACTIVE','EXPIRING','PAYMENT_DUE') OR (m.status='GRACE_PERIOD' AND m.grace_allows_trips_applied) THEN
      IF (m.suspension_at IS NULL OR m.suspension_at>now()) AND (m.plan_type_snapshot<>'TRIP_PACK' OR m.completed_trips<m.included_trips_snapshot) THEN RETURN true; END IF;
    END IF;
  END IF;
  SELECT * INTO w FROM driver_wallets WHERE driver_id=p_driver AND enabled=true;
  RETURN FOUND AND w.total-w.reserved>=(e->>'theoreticalCommission')::numeric;
END $$;

CREATE FUNCTION stamp_arrival_offer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT commercial_driver_can_accept(NEW.driver_id,NEW.trip_id,NEW.search_round) THEN RETURN NULL; END IF;
  NEW.economic_snapshot:=trip_offer_economics(NEW.trip_id,NEW.search_round);
  RETURN NEW;
END $$;
CREATE TRIGGER arrival_offer_snapshot BEFORE INSERT ON driver_offers FOR EACH ROW EXECUTE FUNCTION stamp_arrival_offer();

CREATE FUNCTION record_arrival_search_progress() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.arrival_search_session_id IS NOT NULL THEN
    UPDATE arrival_search_sessions SET max_round_reached=greatest(max_round_reached,NEW.driver_search_round)
      WHERE id=NEW.arrival_search_session_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER arrival_search_progress AFTER UPDATE OF driver_search_round ON trips
  FOR EACH ROW EXECUTE FUNCTION record_arrival_search_progress();

CREATE FUNCTION visible_trip_economics(snapshot jsonb,driver_view boolean) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN snapshot IS NULL THEN NULL WHEN driver_view THEN snapshot ELSE
    jsonb_build_object('isScheduledTrip',snapshot->'isScheduledTrip','journeyFare',snapshot->'journeyFare',
      'arrivalFee',coalesce(snapshot->'arrivalFee',snapshot->'scheduledArrivalFee'),'passengerTotal',snapshot->'passengerTotal') END
$$;
