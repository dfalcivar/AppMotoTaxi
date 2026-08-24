ALTER TABLE membership_payment_orders
  ADD COLUMN IF NOT EXISTS cancellation_reason_code text,
  ADD COLUMN IF NOT EXISTS cancellation_observation text,
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancellation_channel text,
  ADD COLUMN IF NOT EXISTS cancellation_idempotency_key text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'membership_payment_orders_cancellation_reason_check'
  ) THEN
    ALTER TABLE membership_payment_orders
      ADD CONSTRAINT membership_payment_orders_cancellation_reason_check
      CHECK (
        cancellation_reason_code IS NULL OR cancellation_reason_code IN (
          'ORDER_GENERATION_ERROR',
          'WRONG_MEMBERSHIP',
          'CHANGED_MIND',
          'DUPLICATE_ORDER',
          'OTHER'
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'membership_payment_orders_other_reason_observation_check'
  ) THEN
    ALTER TABLE membership_payment_orders
      ADD CONSTRAINT membership_payment_orders_other_reason_observation_check
      CHECK (
        cancellation_reason_code <> 'OTHER'
        OR length(trim(coalesce(cancellation_observation, ''))) >= 3
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS membership_payment_orders_cancel_idempotency_idx
  ON membership_payment_orders(cancellation_idempotency_key)
  WHERE cancellation_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS membership_payment_orders_driver_history_idx
  ON membership_payment_orders(driver_id, created_at DESC);
