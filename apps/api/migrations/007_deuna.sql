ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deuna_qr_image_url text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS deuna_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE trips DROP CONSTRAINT IF EXISTS trips_payment_method_check;
ALTER TABLE trips ADD CONSTRAINT trips_payment_method_check CHECK (payment_method IN ('CASH','DEUNA'));
