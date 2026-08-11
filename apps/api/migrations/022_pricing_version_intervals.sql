WITH ordered_versions AS (
  SELECT id, lead(active_from) OVER (ORDER BY active_from, version) AS next_active_from
  FROM pricing_versions
)
UPDATE pricing_versions AS price
SET active_until = ordered.next_active_from
FROM ordered_versions AS ordered
WHERE price.id = ordered.id
  AND ordered.next_active_from IS NOT NULL
  AND (price.active_until IS NULL OR price.active_until > ordered.next_active_from);
