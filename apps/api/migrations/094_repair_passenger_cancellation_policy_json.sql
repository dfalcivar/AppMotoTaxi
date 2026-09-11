-- Historical writes could encode the validated object before passing it to
-- postgres.js, producing a JSON string inside the JSONB column. Preserve the
-- configured policy while restoring its native JSONB object representation.
UPDATE operational_settings
SET passenger_cancellation_policy = (passenger_cancellation_policy #>> '{}')::jsonb
WHERE jsonb_typeof(passenger_cancellation_policy) = 'string';
