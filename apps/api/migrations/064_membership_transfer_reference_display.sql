-- Finanzas necesita contrastar la referencia completa con el movimiento bancario.
-- El hash existente se conserva para detectar reutilizaciones y duplicados.
ALTER TABLE membership_transfer_proofs
  ADD COLUMN IF NOT EXISTS reference_display text;

ALTER TABLE membership_payments
  ADD COLUMN IF NOT EXISTS reference_display text;

-- Las referencias históricas se guardaron únicamente enmascaradas y no pueden
-- reconstruirse. Se conserva ese valor como alternativa de visualización.
UPDATE membership_transfer_proofs
SET reference_display = reference_masked
WHERE reference_display IS NULL;

UPDATE membership_payments
SET reference_display = reference_masked
WHERE reference_display IS NULL;

