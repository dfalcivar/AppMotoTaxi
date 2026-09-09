-- Opt-in only: existing trips, prices, plans and orders are untouched.
ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS scheduled_arrival_configuration jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_arrival_version integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN operational_settings.scheduled_arrival_configuration IS
  'Tarifa de llegada por hora del servicio programado; NULL conserva comportamiento anterior. Importes decimales en texto, horarios y zona configurados explícitamente.';
COMMENT ON COLUMN operational_settings.scheduled_arrival_version IS
  'Versión para concurrencia administrativa y snapshot de la reserva. No revaloriza viajes existentes.';
