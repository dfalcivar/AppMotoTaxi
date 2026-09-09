-- Agotar todas las rondas sin aceptación cierra la continuidad económica.
-- Una cancelación del pasajero conserva la sesión abierta para impedir que
-- repita la misma ruta buscando volver artificialmente a una ronda más barata.
CREATE FUNCTION expire_arrival_search_session_after_no_driver()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status::text = 'NO_DRIVER'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.arrival_search_session_id IS NOT NULL THEN
    UPDATE arrival_search_sessions
    SET status = 'EXPIRED',
        expires_at = least(expires_at, now())
    WHERE id = NEW.arrival_search_session_id
      AND status = 'OPEN';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER expire_arrival_search_session_no_driver
AFTER UPDATE OF status ON trips
FOR EACH ROW
EXECUTE FUNCTION expire_arrival_search_session_after_no_driver();

-- También normaliza sesiones abiertas que pudieron quedar de búsquedas
-- agotadas antes de instalar este control.
UPDATE arrival_search_sessions AS session
SET status = 'EXPIRED',
    expires_at = least(session.expires_at, now())
WHERE session.status = 'OPEN'
  AND EXISTS (
    SELECT 1
    FROM trips AS trip
    WHERE trip.arrival_search_session_id = session.id
      AND trip.status::text = 'NO_DRIVER'
  );
