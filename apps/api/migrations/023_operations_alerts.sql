ALTER TABLE operational_settings
  ADD COLUMN IF NOT EXISTS document_expiry_alert_days smallint NOT NULL DEFAULT 30
    CHECK (document_expiry_alert_days BETWEEN 1 AND 180);

CREATE INDEX IF NOT EXISTS driver_documents_expiry_alert_idx
  ON driver_documents (expires_at, status)
  WHERE expires_at IS NOT NULL AND status <> 'SUSPENDED';

CREATE INDEX IF NOT EXISTS drivers_operations_location_idx
  ON drivers (last_location_at DESC)
  WHERE last_location_at IS NOT NULL;
