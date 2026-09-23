-- The existing $0.25 tariff is per search round. Add a separate, explicit
-- maximum for Costa-Go's share of a newly quoted trip.
UPDATE operational_settings
SET arrival_commercial_configuration=jsonb_set(
      CASE jsonb_typeof(arrival_commercial_configuration)
        WHEN 'object' THEN arrival_commercial_configuration
        WHEN 'string' THEN (arrival_commercial_configuration#>>'{}')::jsonb
        ELSE '{}'::jsonb END,
      '{maxCommissionPerTrip}','"0.25"'::jsonb,true),
    arrival_commercial_version=arrival_commercial_version+1
WHERE id=1 AND arrival_commercial_configuration IS NOT NULL
  AND NOT (CASE jsonb_typeof(arrival_commercial_configuration)
      WHEN 'object' THEN arrival_commercial_configuration
      WHEN 'string' THEN (arrival_commercial_configuration#>>'{}')::jsonb
      ELSE '{}'::jsonb END ? 'maxCommissionPerTrip');

CREATE OR REPLACE FUNCTION trip_offer_economics(p_trip uuid,p_round integer) RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE t trips%ROWTYPE;q jsonb;e jsonb;r integer;fee numeric;commission numeric;cap numeric;
BEGIN
  SELECT * INTO t FROM trips WHERE id=p_trip;
  e:=t.pricing_snapshot->'economic';
  IF e IS NOT NULL THEN RETURN e-'billingMode'-'appliedCommission'-'membershipId'-'planId'-'packageId'
    -'balanceBefore'-'availableBefore'-'reservedCommission'-'periodCap'-'accruedBefore'-'accruedAfter'-'usedTrips'-'includedTrips'-'legacyTerms'
    -'packagePurchaseId'-'economicProfit'-'extraDriver'; END IF;
  q:=t.pricing_snapshot->'economicQuote';
  IF q IS NULL THEN RETURN NULL; END IF;
  r:=greatest(p_round,coalesce((q->>'minimumRound')::int,1));
  fee:=round((q->>'feePerRound')::numeric*r,2);
  commission:=round(fee*(q->>'costaGoPercent')::numeric/100,2);
  cap:=(q->>'maxCommissionPerTrip')::numeric;
  IF cap IS NOT NULL THEN commission:=least(commission,cap); END IF;
  RETURN jsonb_build_object('isScheduledTrip',false,'matchedRound',r,
    'radiusMeters',least((q->'settings'->>'maximumRadiusMeters')::int,
      (q->'settings'->>'initialRadiusMeters')::int+(r-1)*(q->'settings'->>'radiusIncrementMeters')::int),
    'arrivalFee',fee::text,'feePerRound',q->>'feePerRound','journeyFare',q->>'journeyFare',
    'passengerTotal',round((q->>'journeyFare')::numeric+fee,2)::text,
    'costaGoPercent',q->>'costaGoPercent','maxCommissionPerTrip',q->>'maxCommissionPerTrip',
    'theoreticalCommission',commission::text,
    'economicConfigurationVersion',q->>'version','settings',q->'settings');
END $$;
