-- Version 0.18.3 initially encoded the validated object before passing it to
-- postgres.js, producing a JSONB string. Convert those values to native JSONB.
UPDATE operational_settings
SET scheduled_arrival_configuration = (scheduled_arrival_configuration #>> '{}')::jsonb
WHERE jsonb_typeof(scheduled_arrival_configuration) = 'string';

