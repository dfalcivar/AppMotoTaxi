-- Unifica ubicaciones históricas con el modelo comercial actual.
ALTER TABLE affiliate_banners
  DROP CONSTRAINT IF EXISTS affiliate_banners_placement_check;

UPDATE affiliate_banners
SET placement = CASE placement
  WHEN 'PASSENGER_HOME' THEN 'PASSENGER_SEARCHING_DRIVER'
  WHEN 'DRIVER_HOME' THEN 'PASSENGER_SEARCHING_DRIVER'
  ELSE placement
END
WHERE placement IN ('PASSENGER_HOME', 'DRIVER_HOME');

ALTER TABLE affiliate_banners
  ADD CONSTRAINT affiliate_banners_placement_check
  CHECK (placement IN (
    'PASSENGER_SEARCHING_DRIVER',
    'PASSENGER_WAITING_DRIVER',
    'PASSENGER_TRIP_IN_PROGRESS'
  ));
