-- Vehicles are independent assets. driver_id remains a legacy reference only.
ALTER TABLE vehicles ALTER COLUMN driver_id DROP NOT NULL;
ALTER TABLE vehicles
  ADD COLUMN cooperative_id uuid REFERENCES cooperatives(id),
  ADD COLUMN color text,
  ADD COLUMN unit_number text,
  ADD COLUMN declared_owner_name text,
  ADD COLUMN created_by uuid REFERENCES users(id),
  ADD COLUMN fleet_status text NOT NULL DEFAULT 'PENDING' CHECK (fleet_status IN ('PENDING','VERIFIED','SUSPENDED')),
  ADD COLUMN merged_into uuid REFERENCES vehicles(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE FUNCTION fleet_normalize_identifier(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT regexp_replace(upper(trim(value)), '[^A-Z0-9]', '', 'g')
$$;

-- Keep aliases and original foreign keys: never delete duplicate legacy assets.
WITH ranked AS (
  SELECT id, first_value(id) OVER (
    PARTITION BY fleet_normalize_identifier(identifier) ORDER BY created_at, id
  ) canonical FROM vehicles
)
UPDATE vehicles v SET merged_into=r.canonical FROM ranked r
WHERE v.id=r.id AND r.id<>r.canonical;

CREATE UNIQUE INDEX vehicles_canonical_identifier_key
  ON vehicles(fleet_normalize_identifier(identifier)) WHERE merged_into IS NULL;

UPDATE vehicles v SET cooperative_id=u.cooperative_id,
  fleet_status=CASE WHEN v.status='ACTIVE' THEN 'VERIFIED' WHEN v.status='SUSPENDED' THEN 'SUSPENDED' ELSE 'PENDING' END
FROM users u WHERE u.id=v.driver_id;

CREATE TABLE user_vehicle_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  relation_type text NOT NULL CHECK (relation_type IN ('AUTHORIZED_DRIVER','OWNER_MANAGER')),
  status text NOT NULL CHECK (status IN ('PENDING','APPROVED','REJECTED','REVOKED')),
  source text NOT NULL CHECK (source IN ('LEGACY_MIGRATION','USER_REQUEST','ADMIN','MANAGER')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  reason text,
  UNIQUE(user_id,vehicle_id,relation_type)
);
INSERT INTO user_vehicle_relations(user_id,vehicle_id,relation_type,status,source)
SELECT DISTINCT driver_id,coalesce(merged_into,id),'AUTHORIZED_DRIVER','APPROVED','LEGACY_MIGRATION'
FROM vehicles WHERE driver_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE TABLE vehicle_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  kind text NOT NULL CHECK(kind IN ('PHOTO','REGISTRATION','OPERATING_PERMIT','OWNERSHIP_EVIDENCE')),
  mime_type text NOT NULL,
  original_bytes bytea NOT NULL,
  display_bytes bytea,
  sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE vehicles ADD COLUMN photo_id uuid REFERENCES vehicle_files(id);

CREATE TABLE vehicle_ownership_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  claimant_id uuid NOT NULL REFERENCES users(id),
  evidence_id uuid NOT NULL REFERENCES vehicle_files(id),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','APPROVED','REJECTED')),
  reason text NOT NULL,
  review_note text,
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX vehicle_pending_claim_key ON vehicle_ownership_claims(vehicle_id,claimant_id) WHERE status='PENDING';

CREATE TABLE fleet_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  heartbeat_seconds integer NOT NULL DEFAULT 30 CHECK(heartbeat_seconds BETWEEN 10 AND 120),
  offline_seconds integer NOT NULL DEFAULT 180 CHECK(offline_seconds BETWEEN 30 AND 1800),
  auto_release_seconds integer NOT NULL DEFAULT 900 CHECK(auto_release_seconds BETWEEN 60 AND 86400),
  owner_notifications boolean NOT NULL DEFAULT false,
  CHECK(heartbeat_seconds < offline_seconds AND offline_seconds < auto_release_seconds)
);
INSERT INTO fleet_settings DEFAULT VALUES;

CREATE TABLE driver_vehicle_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  last_heartbeat timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','ENDED')),
  start_method text NOT NULL CHECK(start_method IN ('MANUAL_SELECTION','QR_SCAN','RECOVERY','ADMIN_ASSIGNED')),
  end_reason text CHECK(end_reason IN ('MANUAL_RELEASE','LOGOUT','AUTO_RELEASE','TAKEOVER','VEHICLE_CHANGE','ADMIN_RELEASE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((status='ACTIVE' AND ended_at IS NULL AND end_reason IS NULL) OR
         (status='ENDED' AND ended_at IS NOT NULL AND end_reason IS NOT NULL)),
  CHECK(ended_at IS NULL OR ended_at>=started_at)
);
CREATE UNIQUE INDEX fleet_one_active_vehicle ON driver_vehicle_sessions(vehicle_id) WHERE status='ACTIVE';
CREATE UNIQUE INDEX fleet_one_active_driver ON driver_vehicle_sessions(driver_id) WHERE status='ACTIVE';
CREATE INDEX fleet_sessions_history ON driver_vehicle_sessions(vehicle_id,started_at DESC);
CREATE INDEX fleet_driver_sessions_history ON driver_vehicle_sessions(driver_id,started_at DESC);

CREATE TABLE vehicle_qr_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  token text NOT NULL UNIQUE,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES users(id),
  reason text
);
CREATE UNIQUE INDEX fleet_one_live_qr ON vehicle_qr_tokens(vehicle_id) WHERE revoked_at IS NULL;

CREATE TABLE vehicle_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  vehicle_id uuid REFERENCES vehicles(id),
  driver_id uuid REFERENCES users(id),
  actor_id uuid REFERENCES users(id),
  action text NOT NULL,
  reason text,
  previous_value jsonb,
  next_value jsonb,
  source_ip text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX vehicle_audit_history ON vehicle_audit(vehicle_id,occurred_at DESC);
CREATE TABLE fleet_entitlements (
  user_id uuid PRIMARY KEY REFERENCES users(id),
  tier text NOT NULL DEFAULT 'BASIC' CHECK(tier IN ('BASIC','PRO')),
  capabilities jsonb NOT NULL DEFAULT '{"history":true,"reports":true,"notifications":true}'::jsonb,
  notification_events text[] NOT NULL DEFAULT ARRAY['session_started','session_ended','session_auto_released','vehicle_takeover'],
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE fleet_notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id bigint NOT NULL REFERENCES vehicle_audit(id),
  user_id uuid NOT NULL REFERENCES users(id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  event text NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(audit_id,user_id)
);
CREATE INDEX fleet_notifications_pending ON fleet_notification_outbox(updated_at)
  WHERE status IN ('PENDING','SENDING');
CREATE INDEX fleet_vehicle_relations ON user_vehicle_relations(vehicle_id,status);
CREATE INDEX fleet_vehicle_files ON vehicle_files(vehicle_id,created_at DESC);
INSERT INTO vehicle_audit(vehicle_id,driver_id,action,reason,next_value)
SELECT coalesce(merged_into,id),driver_id,'vehicle_legacy_migrated',
  'Referencia histórica conservada; no constituye prueba de propiedad',
  jsonb_build_object('legacyVehicleId',id,'identifier',identifier,'mergedInto',merged_into)
FROM vehicles;

ALTER TABLE trips ADD COLUMN vehicle_snapshot jsonb,
  ADD COLUMN vehicle_session_id uuid REFERENCES driver_vehicle_sessions(id);
-- Only known historical IDs can be snapshotted. Never guess from today's driver asset.
UPDATE trips t SET vehicle_snapshot=jsonb_build_object(
  'id',v.id,'identifier',v.identifier,'brand',v.brand,'model',v.model,'color',v.color,
  'unitNumber',v.unit_number,'photoId',v.photo_id,'source','LEGACY_KNOWN_ID')
FROM vehicles v WHERE v.id=t.vehicle_id;

CREATE TABLE vehicle_session_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES driver_vehicle_sessions(id),
  trip_id uuid NOT NULL REFERENCES trips(id),
  driver_id uuid NOT NULL REFERENCES drivers(user_id),
  vehicle_id uuid NOT NULL REFERENCES vehicles(id),
  vehicle_snapshot jsonb NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  outcome text CHECK(outcome IN ('COMPLETED','DRIVER_CANCELLED','PASSENGER_CANCELLED','CANCELLED','REASSIGNED','INCIDENT')),
  distance_meters numeric NOT NULL DEFAULT 0,
  total_cents integer NOT NULL DEFAULT 0,
  UNIQUE(session_id,trip_id)
);
CREATE INDEX fleet_trip_assignments ON vehicle_session_assignments(trip_id,accepted_at DESC);

CREATE FUNCTION fleet_driver_has_active_trip(p_driver uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS(SELECT 1 FROM trips WHERE driver_id=p_driver AND
    status IN ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS','INCIDENT'))
$$;

CREATE FUNCTION fleet_driver_can_receive(p_driver uuid) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM driver_vehicle_sessions s
    JOIN vehicles v ON v.id=s.vehicle_id
    JOIN user_vehicle_relations r ON r.vehicle_id=v.id AND r.user_id=s.driver_id
      AND r.relation_type='AUTHORIZED_DRIVER' AND r.status='APPROVED'
    JOIN drivers d ON d.user_id=s.driver_id JOIN users u ON u.id=d.user_id
    CROSS JOIN fleet_settings p
    WHERE s.driver_id=p_driver AND s.status='ACTIVE' AND v.merged_into IS NULL
      AND v.fleet_status='VERIFIED' AND u.deleted_at IS NULL AND u.status='ACTIVE'
      AND d.approval_status='APROBADO'
      AND s.last_heartbeat > now()-make_interval(secs=>p.offline_seconds)
  )
$$;

-- Immutable business evidence, including historical photos, cannot be rewritten.
CREATE FUNCTION fleet_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FLEET_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER vehicle_files_immutable BEFORE UPDATE OR DELETE ON vehicle_files
  FOR EACH ROW EXECUTE FUNCTION fleet_immutable_record();
CREATE TRIGGER vehicle_audit_immutable BEFORE UPDATE OR DELETE ON vehicle_audit
  FOR EACH ROW EXECUTE FUNCTION fleet_immutable_record();
