ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS passenger_notes text;

ALTER TABLE trips
  DROP CONSTRAINT IF EXISTS trips_passenger_notes_length;

ALTER TABLE trips
  ADD CONSTRAINT trips_passenger_notes_length
  CHECK (passenger_notes IS NULL OR char_length(passenger_notes) <= 300);

UPDATE pricing_versions
SET maximum_passengers = 4
WHERE maximum_passengers < 4;

UPDATE vehicles
SET maximum_passengers = 4
WHERE maximum_passengers < 4;
