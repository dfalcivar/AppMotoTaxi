-- postgres.js already serializes values passed through sql.json(). The first
-- implementation pre-serialized these values, leaving a JSON string instead
-- of the array/object expected when a later trip reused the search session.
UPDATE arrival_search_sessions
SET route_points = (route_points #>> '{}')::jsonb
WHERE jsonb_typeof(route_points) = 'string'
  AND jsonb_typeof((route_points #>> '{}')::jsonb) = 'array';

UPDATE arrival_search_sessions
SET configuration = (configuration #>> '{}')::jsonb
WHERE jsonb_typeof(configuration) = 'string'
  AND jsonb_typeof((configuration #>> '{}')::jsonb) = 'object';

ALTER TABLE arrival_search_sessions
  ADD CONSTRAINT arrival_search_sessions_route_points_array
  CHECK (jsonb_typeof(route_points) = 'array');

ALTER TABLE arrival_search_sessions
  ADD CONSTRAINT arrival_search_sessions_configuration_object
  CHECK (jsonb_typeof(configuration) = 'object');
