-- Estrategia secundaria para trayectos sin una regla territorial exacta.
-- El tarifario territorial conserva la máxima prioridad. La distancia se
-- obtiene del proveedor de rutas y nunca se calcula en línea recta.

ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS distance_fare_cents_per_km integer NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS local_fare_max_distance_meters integer NOT NULL DEFAULT 2000,
  ADD COLUMN IF NOT EXISTS distance_fare_minimum_cents integer NOT NULL DEFAULT 0;

ALTER TABLE operational_settings
  DROP CONSTRAINT IF EXISTS operational_settings_distance_fare_rate_check,
  ADD CONSTRAINT operational_settings_distance_fare_rate_check
    CHECK (distance_fare_cents_per_km BETWEEN 1 AND 10000),
  DROP CONSTRAINT IF EXISTS operational_settings_local_fare_distance_check,
  ADD CONSTRAINT operational_settings_local_fare_distance_check
    CHECK (local_fare_max_distance_meters BETWEEN 100 AND 50000),
  DROP CONSTRAINT IF EXISTS operational_settings_distance_fare_minimum_check,
  ADD CONSTRAINT operational_settings_distance_fare_minimum_check
    CHECK (distance_fare_minimum_cents BETWEEN 0 AND 100000);

COMMENT ON COLUMN operational_settings.distance_fare_cents_per_km IS
  'Centavos por kilómetro de ruta cuando no existe una regla territorial exacta y el trayecto supera el límite local.';
COMMENT ON COLUMN operational_settings.local_fare_max_distance_meters IS
  'Distancia máxima de ruta que conserva el valor sugerido local cuando no existe una regla territorial exacta.';
COMMENT ON COLUMN operational_settings.distance_fare_minimum_cents IS
  'Tarifa base mínima aplicable al cálculo por distancia, sin incluir la comisión operativa.';
