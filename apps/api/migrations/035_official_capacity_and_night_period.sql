-- Alinea la capacidad y el período nocturno con el tarifario operativo
-- suministrado para tricimotos de Atacames.
UPDATE vehicles
SET maximum_passengers = 3
WHERE maximum_passengers <> 3;

UPDATE pricing_versions
SET maximum_passengers = 3,
    day_starts_at = '06:00',
    night_starts_at = '22:00'
WHERE maximum_passengers <> 3
   OR day_starts_at <> '06:00'
   OR night_starts_at <> '22:00';
