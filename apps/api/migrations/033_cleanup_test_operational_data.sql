-- Limpieza controlada previa a las pruebas con informacion real.
-- Conserva configuracion, zonas, tarifas, publicidad, FAQs y cuentas administrativas.

CREATE TEMP TABLE cleanup_users ON COMMIT DROP AS
SELECT id, role::text AS role, email
FROM users
WHERE role = 'DRIVER'
   OR (
     role = 'PASSENGER'
     AND (
       email IS NULL
       OR btrim(email) = ''
       OR lower(btrim(email)) IN (
         'pasajera@mototaxi.local',
         'david@mail.com',
         'eze@gmail.com',
         'pasajera2@mototaxi.local',
         'pasajera1@mototaxi.local'
       )
     )
   );

CREATE UNIQUE INDEX cleanup_users_id_idx ON cleanup_users(id);

CREATE TEMP TABLE cleanup_trips ON COMMIT DROP AS
SELECT id FROM trips;

CREATE UNIQUE INDEX cleanup_trips_id_idx ON cleanup_trips(id);

CREATE TEMP TABLE cleanup_incidents ON COMMIT DROP AS
SELECT id FROM incidents;

CREATE UNIQUE INDEX cleanup_incidents_id_idx ON cleanup_incidents(id);

CREATE TEMP TABLE cleanup_cooperatives ON COMMIT DROP AS
SELECT id FROM cooperatives
WHERE id = '31d303cd-2d57-4c7e-912a-10f0212c0c81'::uuid
  AND upper(btrim(name)) = '23 DE JULIO';

CREATE UNIQUE INDEX cleanup_cooperatives_id_idx ON cleanup_cooperatives(id);

CREATE TEMP TABLE cleanup_summary ON COMMIT DROP AS
SELECT
  (SELECT count(*)::int FROM cleanup_users WHERE role = 'PASSENGER') AS passengers,
  (SELECT count(*)::int FROM cleanup_users WHERE role = 'DRIVER') AS drivers,
  (SELECT count(*)::int FROM cleanup_trips) AS trips,
  (SELECT count(*)::int FROM cleanup_incidents) AS incidents,
  (SELECT count(*)::int FROM cleanup_cooperatives) AS cooperatives,
  (
    SELECT count(*)::int
    FROM user_service_area_access access
    JOIN service_areas area ON area.id = access.service_area_id
    WHERE area.code = 'CUENCA_TEST'
  ) AS cuenca_user_access,
  (
    SELECT count(*)::int
    FROM service_area_role_access access
    JOIN service_areas area ON area.id = access.service_area_id
    WHERE area.code = 'CUENCA_TEST'
  ) AS cuenca_role_access;

-- Revoca toda autorizacion de pruebas en Cuenca sin eliminar la zona.
DELETE FROM user_service_area_access access
USING service_areas area
WHERE access.service_area_id = area.id
  AND area.code = 'CUENCA_TEST';

DELETE FROM service_area_role_access access
USING service_areas area
WHERE access.service_area_id = area.id
  AND area.code = 'CUENCA_TEST';

-- Limpia bandejas y diagnosticos generados por las pruebas operativas.
DELETE FROM user_notifications;
DELETE FROM admin_notifications;
DELETE FROM push_delivery_events;

-- Los incidentes se eliminan antes de los viajes porque su FK no usa CASCADE.
DELETE FROM support_incident_attachments;
DELETE FROM support_incident_messages;
DELETE FROM incidents;

-- Dependencias historicas de todos los viajes de prueba.
DELETE FROM ratings;
DELETE FROM trip_messages;
DELETE FROM trip_location_history;
DELETE FROM trip_live_locations;
DELETE FROM scheduled_trip_responses;
DELETE FROM trip_stops;
DELETE FROM driver_offers;
DELETE FROM trip_events;
DELETE FROM trips;

-- Dependencias de las cuentas de conductor que no tienen borrado en cascada.
DELETE FROM driver_documents
WHERE driver_id IN (SELECT id FROM cleanup_users WHERE role = 'DRIVER');

DELETE FROM driver_approval_reviews
WHERE driver_id IN (SELECT id FROM cleanup_users WHERE role = 'DRIVER');

DELETE FROM vehicles
WHERE driver_id IN (SELECT id FROM cleanup_users WHERE role = 'DRIVER');

DELETE FROM drivers
WHERE user_id IN (SELECT id FROM cleanup_users WHERE role = 'DRIVER');

-- Elimina solicitudes y auditoria que conservarian referencias a cuentas de prueba.
DELETE FROM account_deletion_requests
WHERE user_id IN (SELECT id FROM cleanup_users)
   OR lower(btrim(requested_email)) IN (
     'pasajera@mototaxi.local',
     'david@mail.com',
     'eze@gmail.com',
     'pasajera2@mototaxi.local',
     'pasajera1@mototaxi.local'
   );

DELETE FROM audit_log audit
WHERE audit.actor_id IN (SELECT id FROM cleanup_users)
   OR audit.entity_id IN (SELECT id::text FROM cleanup_users)
   OR audit.entity_id IN (SELECT id::text FROM cleanup_trips)
   OR audit.entity_id IN (SELECT id::text FROM cleanup_incidents)
   OR audit.entity_id IN (SELECT id::text FROM cleanup_cooperatives);

-- Evita bloquear el borrado si una referencia administrativa historica apunta
-- accidentalmente a una de las cuentas de prueba.
UPDATE operational_settings SET updated_by = NULL
WHERE updated_by IN (SELECT id FROM cleanup_users);

UPDATE affiliate_banners SET created_by = NULL
WHERE created_by IN (SELECT id FROM cleanup_users);

UPDATE support_faqs SET created_by = NULL
WHERE created_by IN (SELECT id FROM cleanup_users);

UPDATE support_faqs SET updated_by = NULL
WHERE updated_by IN (SELECT id FROM cleanup_users);

UPDATE service_areas
SET created_by = CASE WHEN created_by IN (SELECT id FROM cleanup_users) THEN NULL ELSE created_by END,
    updated_by = CASE WHEN updated_by IN (SELECT id FROM cleanup_users) THEN NULL ELSE updated_by END,
    archived_by = CASE WHEN archived_by IN (SELECT id FROM cleanup_users) THEN NULL ELSE archived_by END;

UPDATE service_area_versions SET created_by = NULL
WHERE created_by IN (SELECT id FROM cleanup_users);

UPDATE driver_approval_notification_settings SET updated_by = NULL
WHERE updated_by IN (SELECT id FROM cleanup_users);

UPDATE admin_permission_overrides SET granted_by = NULL
WHERE granted_by IN (SELECT id FROM cleanup_users);

UPDATE user_service_area_access SET granted_by = NULL
WHERE granted_by IN (SELECT id FROM cleanup_users);

UPDATE service_area_role_access SET granted_by = NULL
WHERE granted_by IN (SELECT id FROM cleanup_users);

-- Las tablas antiguas exigen un creador no nulo; se reasigna a un administrador
-- existente solamente si alguna cuenta de prueba llegara a figurar como creadora.
UPDATE service_zones
SET created_by = (
  SELECT id FROM users
  WHERE role IN ('SUPER_ADMIN', 'ADMIN') AND id NOT IN (SELECT id FROM cleanup_users)
  ORDER BY created_at LIMIT 1
)
WHERE created_by IN (SELECT id FROM cleanup_users);

UPDATE pricing_versions
SET created_by = (
  SELECT id FROM users
  WHERE role IN ('SUPER_ADMIN', 'ADMIN') AND id NOT IN (SELECT id FROM cleanup_users)
  ORDER BY created_at LIMIT 1
)
WHERE created_by IN (SELECT id FROM cleanup_users);

-- Las FK con ON DELETE CASCADE limpian tokens, sesiones, favoritos, permisos,
-- codigos de verificacion y recuperacion asociados a estas cuentas.
DELETE FROM users
WHERE id IN (SELECT id FROM cleanup_users);

-- Elimina las cooperativas de prueba despues de liberar usuarios y viajes.
DELETE FROM cooperatives
WHERE id IN (SELECT id FROM cleanup_cooperatives);

-- Conserva una evidencia no personal de la limpieza ejecutada.
INSERT INTO audit_log (
  actor_id, action, entity_type, entity_id, next_value, reason
)
SELECT
  NULL,
  'TEST_DATA_CLEANUP',
  'SYSTEM',
  '033_cleanup_test_operational_data',
  jsonb_build_object(
    'passengersDeleted', passengers,
    'driversDeleted', drivers,
    'tripsDeleted', trips,
    'incidentsDeleted', incidents,
    'cooperativesDeleted', cooperatives,
    'cuencaUserAccessRevoked', cuenca_user_access,
    'cuencaRoleAccessRevoked', cuenca_role_access
  ),
  'Limpieza autorizada previa a pruebas con informacion real.'
FROM cleanup_summary;
