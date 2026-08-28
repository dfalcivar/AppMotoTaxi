-- Every new assignment gets the unit actually confirmed by the driver.
-- Existing in-flight trips are not relabelled with a guessed vehicle.
CREATE FUNCTION fleet_trip_assignment_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s driver_vehicle_sessions%ROWTYPE; v vehicles%ROWTYPE;
BEGIN
  IF NEW.driver_id IS NOT NULL AND NEW.status IN ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS')
     AND (TG_OP='INSERT' OR OLD.driver_id IS DISTINCT FROM NEW.driver_id OR OLD.status='SEARCHING') THEN
    SELECT * INTO s FROM driver_vehicle_sessions WHERE driver_id=NEW.driver_id AND status='ACTIVE' FOR UPDATE;
    IF s.id IS NULL OR NOT fleet_driver_can_receive(NEW.driver_id) THEN
      RAISE EXCEPTION 'VEHICLE_SESSION_REQUIRED' USING ERRCODE='P0001';
    END IF;
    SELECT * INTO v FROM vehicles WHERE id=s.vehicle_id FOR SHARE;
    IF v.fleet_status<>'VERIFIED' THEN RAISE EXCEPTION 'VEHICLE_NOT_VERIFIED'; END IF;
    NEW.vehicle_id=v.id; NEW.vehicle_session_id=s.id;
    NEW.vehicle_snapshot=jsonb_build_object('id',v.id,'identifier',v.identifier,'brand',v.brand,
      'model',v.model,'color',v.color,'unitNumber',v.unit_number,'photoId',v.photo_id,'source','ASSIGNMENT');
  ELSIF TG_OP='UPDATE' AND NEW.driver_id IS NOT DISTINCT FROM OLD.driver_id THEN
    -- Snapshots are not profile fields. Only a real new assignment may replace one.
    NEW.vehicle_id=OLD.vehicle_id; NEW.vehicle_snapshot=OLD.vehicle_snapshot;
    NEW.vehicle_session_id=OLD.vehicle_session_id;
  ELSIF NEW.driver_id IS NULL AND NEW.status='SEARCHING' THEN
    NEW.vehicle_id=NULL; NEW.vehicle_snapshot=NULL; NEW.vehicle_session_id=NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_trip_assignment_guard BEFORE INSERT OR UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION fleet_trip_assignment_guard();

CREATE FUNCTION fleet_capture_assignment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.vehicle_session_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.vehicle_session_id IS DISTINCT FROM NEW.vehicle_session_id) THEN
    INSERT INTO vehicle_session_assignments(session_id,trip_id,driver_id,vehicle_id,vehicle_snapshot)
    VALUES(NEW.vehicle_session_id,NEW.id,NEW.driver_id,NEW.vehicle_id,NEW.vehicle_snapshot)
    ON CONFLICT(session_id,trip_id) DO NOTHING;
  END IF;
  IF TG_OP='UPDATE' AND OLD.vehicle_session_id IS NOT NULL AND
     (NEW.status IN ('COMPLETED','CANCELLED','INCIDENT') OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    UPDATE vehicle_session_assignments SET ended_at=coalesce(ended_at,now()),
      outcome=CASE WHEN outcome IN ('DRIVER_CANCELLED','PASSENGER_CANCELLED') THEN outcome
        WHEN NEW.status='COMPLETED' THEN 'COMPLETED' WHEN NEW.status='INCIDENT' THEN 'INCIDENT'
        WHEN NEW.status='CANCELLED' THEN 'CANCELLED' ELSE 'REASSIGNED' END,
      total_cents=CASE WHEN NEW.status='COMPLETED' THEN coalesce(NEW.final_total_cents,NEW.quoted_total_cents) ELSE 0 END,
      distance_meters=CASE WHEN NEW.status='COMPLETED'
        THEN coalesce((to_jsonb(NEW)->>'estimated_distance_meters')::numeric,(to_jsonb(NEW)->>'distance_meters')::numeric,0) ELSE 0 END
    WHERE trip_id=NEW.id AND session_id=OLD.vehicle_session_id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_capture_assignment AFTER INSERT OR UPDATE ON trips
FOR EACH ROW EXECUTE FUNCTION fleet_capture_assignment();

CREATE FUNCTION fleet_capture_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE assignment_id uuid; assigned_driver uuid; passenger uuid;
BEGIN
  IF NEW.to_status NOT IN ('CANCELLED','SEARCHING') THEN RETURN NEW; END IF;
  SELECT a.id,a.driver_id INTO assignment_id,assigned_driver FROM vehicle_session_assignments a
    WHERE a.trip_id=NEW.trip_id ORDER BY a.accepted_at DESC,a.id DESC LIMIT 1;
  SELECT passenger_id INTO passenger FROM trips WHERE id=NEW.trip_id;
  IF assignment_id IS NOT NULL THEN
    UPDATE vehicle_session_assignments SET outcome=CASE
      WHEN NEW.actor_id=assigned_driver THEN 'DRIVER_CANCELLED'
      WHEN NEW.actor_id=passenger THEN 'PASSENGER_CANCELLED' ELSE outcome END
    WHERE id=assignment_id AND outcome IN ('CANCELLED','REASSIGNED');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_capture_cancellation AFTER INSERT ON trip_events
FOR EACH ROW EXECUTE FUNCTION fleet_capture_cancellation();

CREATE FUNCTION fleet_guard_session_end() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEET_HISTORY_IMMUTABLE'; END IF;
  IF OLD.status='ENDED' THEN RAISE EXCEPTION 'FLEET_HISTORY_IMMUTABLE'; END IF;
  IF NEW.driver_id<>OLD.driver_id OR NEW.vehicle_id<>OLD.vehicle_id OR NEW.started_at<>OLD.started_at THEN
    RAISE EXCEPTION 'FLEET_HISTORY_IMMUTABLE';
  END IF;
  IF NEW.status='ENDED' AND fleet_driver_has_active_trip(OLD.driver_id) THEN
    RAISE EXCEPTION 'VEHICLE_HAS_ACTIVE_TRIP';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_guard_session_end BEFORE UPDATE OR DELETE ON driver_vehicle_sessions
FOR EACH ROW EXECUTE FUNCTION fleet_guard_session_end();

-- Offers are attributed when created, not inferred from a later driver's unit.
ALTER TABLE driver_offers ADD COLUMN vehicle_session_id uuid REFERENCES driver_vehicle_sessions(id);
CREATE FUNCTION fleet_offer_session() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT id INTO NEW.vehicle_session_id FROM driver_vehicle_sessions
    WHERE driver_id=NEW.driver_id AND status='ACTIVE';
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_offer_session BEFORE INSERT ON driver_offers FOR EACH ROW EXECUTE FUNCTION fleet_offer_session();
CREATE INDEX fleet_session_offers ON driver_offers(vehicle_session_id);
CREATE FUNCTION fleet_guard_assignment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'FLEET_HISTORY_IMMUTABLE'; END IF;
  IF NEW.session_id<>OLD.session_id OR NEW.trip_id<>OLD.trip_id OR NEW.driver_id<>OLD.driver_id
    OR NEW.vehicle_id<>OLD.vehicle_id OR NEW.vehicle_snapshot IS DISTINCT FROM OLD.vehicle_snapshot
    OR NEW.accepted_at<>OLD.accepted_at THEN RAISE EXCEPTION 'FLEET_HISTORY_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fleet_guard_assignment_history BEFORE UPDATE OR DELETE ON vehicle_session_assignments
  FOR EACH ROW EXECUTE FUNCTION fleet_guard_assignment_history();
