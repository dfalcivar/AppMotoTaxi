-- postgres.js serializa los valores enviados con sql.json(). Las escrituras
-- anteriores pre-serializaban estos snapshots y terminaron almacenándolos
-- como cadenas JSON, impidiendo leer economicQuote para Pago por uso.
UPDATE trips
SET pricing_snapshot = (pricing_snapshot #>> '{}')::jsonb
WHERE jsonb_typeof(pricing_snapshot) = 'string'
  AND jsonb_typeof((pricing_snapshot #>> '{}')::jsonb) = 'object';

UPDATE trips
SET route_snapshot = (route_snapshot #>> '{}')::jsonb
WHERE jsonb_typeof(route_snapshot) = 'string'
  AND jsonb_typeof((route_snapshot #>> '{}')::jsonb) = 'object';

ALTER TABLE trips
  ADD CONSTRAINT trips_pricing_snapshot_object
  CHECK (pricing_snapshot IS NULL OR jsonb_typeof(pricing_snapshot) = 'object');

ALTER TABLE trips
  ADD CONSTRAINT trips_route_snapshot_object
  CHECK (route_snapshot IS NULL OR jsonb_typeof(route_snapshot) = 'object');
