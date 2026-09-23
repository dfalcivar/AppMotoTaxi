ALTER TABLE collection_points
  ADD COLUMN commission_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN commission_per_payment numeric(12,2) NOT NULL DEFAULT 0 CHECK (commission_per_payment >= 0),
  ADD COLUMN commission_price_basis text NOT NULL DEFAULT 'BASE_PLUS_TAX' CHECK (commission_price_basis IN ('BASE_PLUS_TAX','TOTAL_INCLUDING_TAX'));

ALTER TABLE collection_point_closures
  ADD COLUMN commission_payment_count integer NOT NULL DEFAULT 0,
  ADD COLUMN commission_price_basis_snapshot text NOT NULL DEFAULT 'BASE_PLUS_TAX' CHECK (commission_price_basis_snapshot IN ('BASE_PLUS_TAX','TOTAL_INCLUDING_TAX'));

CREATE TABLE collection_point_commission_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  closure_id uuid NOT NULL UNIQUE REFERENCES collection_point_closures(id),
  collection_point_id uuid NOT NULL REFERENCES collection_points(id),
  supplier_ruc text NOT NULL CHECK (supplier_ruc ~ '^[0-9]{13}$'),
  invoice_number text NOT NULL CHECK (invoice_number ~ '^[0-9]{3}-[0-9]{3}-[0-9]{9}$'),
  access_key text NOT NULL UNIQUE CHECK (access_key ~ '^[0-9]{49}$'),
  subtotal numeric(12,2) NOT NULL CHECK (subtotal >= 0),
  vat_amount numeric(12,2) NOT NULL CHECK (vat_amount >= 0),
  total numeric(12,2) NOT NULL CHECK (total > 0),
  pdf_data bytea NOT NULL,
  status text NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','APPROVED','REJECTED','PAID')),
  review_note text,
  payment_reference_hash text,
  payment_reference_masked text,
  registered_by uuid NOT NULL REFERENCES users(id),
  reviewed_by uuid REFERENCES users(id),
  reviewed_at timestamptz,
  paid_by uuid REFERENCES users(id),
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(supplier_ruc, invoice_number),
  CHECK (total = subtotal + vat_amount)
);

CREATE INDEX collection_point_commission_invoices_status_idx
  ON collection_point_commission_invoices(status, created_at DESC);

CREATE UNIQUE INDEX collection_point_commission_invoices_payment_reference_idx
  ON collection_point_commission_invoices(payment_reference_hash)
  WHERE payment_reference_hash IS NOT NULL;
