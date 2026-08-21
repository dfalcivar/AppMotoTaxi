-- Cobros comerciales auditables: recibir no equivale a conciliar.
INSERT INTO advertising_payment_methods(code,name,instructions,active,requires_proof,sort_order)
VALUES ('CASH','Efectivo','El asesor registra el cobro y lo incluye en su cierre diario.',true,false,30)
ON CONFLICT(code) DO UPDATE SET name=excluded.name,instructions=excluded.instructions;

ALTER TABLE advertising_payments
  DROP CONSTRAINT IF EXISTS advertising_payments_status_check;
ALTER TABLE advertising_payments
  ADD CONSTRAINT advertising_payments_status_check
  CHECK (status IN ('PENDING','RECEIVED','UNDER_REVIEW','APPROVED','REJECTED','REFUNDED'));

ALTER TABLE advertising_payments
  ADD COLUMN IF NOT EXISTS received_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS receiver_role text,
  ADD COLUMN IF NOT EXISTS settlement_status text NOT NULL DEFAULT 'NOT_RECEIVED',
  ADD COLUMN IF NOT EXISTS idempotency_key uuid;

ALTER TABLE advertising_payments
  DROP CONSTRAINT IF EXISTS advertising_payments_settlement_status_check;
ALTER TABLE advertising_payments
  ADD CONSTRAINT advertising_payments_settlement_status_check
  CHECK (settlement_status IN ('NOT_RECEIVED','PENDING_CLOSURE','PENDING_RECONCILIATION','RECONCILED','REJECTED'));

CREATE UNIQUE INDEX IF NOT EXISTS advertising_payments_idempotency_uidx
  ON advertising_payments(idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS advertising_cash_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commercial_id uuid NOT NULL REFERENCES users(id),
  business_date date NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_RECONCILIATION'
    CHECK (status IN ('PENDING_RECONCILIATION','RECONCILED','REJECTED')),
  payment_count integer NOT NULL CHECK (payment_count>0),
  cash_total numeric(12,2) NOT NULL CHECK (cash_total>0),
  currency char(3) NOT NULL DEFAULT 'USD',
  notes text,
  closed_at timestamptz NOT NULL DEFAULT now(),
  reconciled_by uuid REFERENCES users(id) ON DELETE SET NULL,
  reconciled_at timestamptz,
  reconciliation_reference text,
  rejection_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(commercial_id,business_date)
);

ALTER TABLE advertising_payments
  ADD COLUMN IF NOT EXISTS cash_closure_id uuid REFERENCES advertising_cash_closures(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS advertising_payments_cash_closure_idx
  ON advertising_payments(cash_closure_id,status);
CREATE INDEX IF NOT EXISTS advertising_cash_closures_status_date_idx
  ON advertising_cash_closures(status,business_date DESC);
