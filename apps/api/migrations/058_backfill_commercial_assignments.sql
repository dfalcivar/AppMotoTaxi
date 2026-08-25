-- A lead managed by a commercial user and every record produced from that lead
-- must have the same owner. This repairs orders created by the public assistant
-- before the assignment was propagated by the claim endpoint.
UPDATE advertising_orders AS orders
SET assigned_commercial_id = leads.assigned_commercial_id,
    updated_at = now()
FROM advertising_leads AS leads
WHERE orders.lead_id = leads.id
  AND orders.assigned_commercial_id IS NULL
  AND leads.assigned_commercial_id IS NOT NULL;

WITH latest_assignment AS (
  SELECT DISTINCT ON (advertiser_id)
    advertiser_id,
    assigned_commercial_id
  FROM advertising_leads
  WHERE advertiser_id IS NOT NULL
    AND assigned_commercial_id IS NOT NULL
  ORDER BY advertiser_id, updated_at DESC, created_at DESC
)
UPDATE advertisers AS advertisers
SET assigned_commercial_id = latest_assignment.assigned_commercial_id,
    updated_at = now()
FROM latest_assignment
WHERE advertisers.id = latest_assignment.advertiser_id
  AND advertisers.assigned_commercial_id IS NULL;
