import { firstSearchBounds, nextSearchBounds, type DriverSearchSettings } from './driver-search.js';

// Exact rational arithmetic. Monetary API values are decimal strings; rounding
// is HALF_UP at settlement (two decimals), not at each intermediate operation.
type Decimal = { n: bigint; d: bigint };
function decimal(value: string): Decimal {
  if (!/^\d+(?:\.\d{1,12})?$/.test(value)) throw new Error('INVALID_DECIMAL');
  const [whole, fraction = ''] = value.split('.');
  return { n: BigInt(whole! + fraction), d: 10n ** BigInt(fraction.length) };
}
function add(a: Decimal, b: Decimal): Decimal { return { n: a.n*b.d+b.n*a.d, d: a.d*b.d }; }
function multiply(a: Decimal, b: Decimal): Decimal { return { n: a.n*b.n, d: a.d*b.d }; }
function divide(a: Decimal, b: Decimal): Decimal {
  if (b.n === 0n) throw new Error('DIVISION_BY_ZERO');
  return { n: a.n*b.d, d: a.d*b.n };
}
function compare(a: Decimal, b: Decimal) { return a.n*b.d-b.n*a.d; }
function fixed(a: Decimal, places = 2): string {
  const scale = 10n ** BigInt(places);
  const rounded = (a.n*scale*2n+a.d)/(a.d*2n);
  return `${rounded/scale}.${(rounded%scale).toString().padStart(places,'0')}`;
}
function percentage(value: string): Decimal {
  const result = decimal(value);
  if (compare(result, decimal('100')) > 0n) throw new Error('INVALID_PERCENTAGE');
  return divide(result, decimal('100'));
}
function integer(value: number, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new Error('INVALID_INTEGER');
  return value;
}
export function monetaryAmount(value: string) { return fixed(decimal(value)); }
export function exactTaxBreakdown(net: string, vatPercent: string) {
  const subtotal = decimal(monetaryAmount(net));
  const vat = decimal(fixed(multiply(subtotal, percentage(vatPercent))));
  return { subtotal: fixed(subtotal), vatRatePercent: vatPercent, vatAmount: fixed(vat), total: fixed(add(subtotal, vat)) };
}

export function arrivalSearchBounds(settings: DriverSearchSettings) {
  integer(settings.initialRadiusMeters, 1);
  integer(settings.radiusIncrementMeters, 1);
  integer(settings.maximumRadiusMeters, settings.initialRadiusMeters);
  integer(settings.roundWaitSeconds, 1);
  const bounds = [firstSearchBounds(settings)];
  while (!bounds.at(-1)!.finalRound) bounds.push(nextSearchBounds(bounds.at(-1)!, settings)!);
  return bounds;
}

export function immediateArrival(input: {
  settings: DriverSearchSettings; round: number; feePerRound: string;
  journeyFare: string; costaGoPercent: string;
}) {
  const bounds = arrivalSearchBounds(input.settings);
  const matched = bounds[integer(input.round, 1)-1];
  if (!matched) throw new Error('INVALID_MATCHED_ROUND');
  const fee = decimal(monetaryAmount(input.feePerRound));
  const arrivalFee = fixed(multiply(fee, decimal(String(input.round))));
  const theoreticalCommission = fixed(multiply(decimal(arrivalFee), percentage(input.costaGoPercent)));
  const arrivalFeeMaximum = fixed(multiply(fee, decimal(String(bounds.length))));
  return {
    matchedRound: input.round, radiusMeters: matched.upperMeters, totalRounds: bounds.length,
    arrivalFee, arrivalFeeMinimum: fixed(fee), arrivalFeeMaximum,
    journeyFare: monetaryAmount(input.journeyFare), costaGoPercent: input.costaGoPercent,
    theoreticalCommission,
    passengerTotal: fixed(add(decimal(monetaryAmount(input.journeyFare)), decimal(arrivalFee))),
    passengerMinimum: fixed(add(decimal(monetaryAmount(input.journeyFare)), fee)),
    passengerMaximum: fixed(add(decimal(monetaryAmount(input.journeyFare)), decimal(arrivalFeeMaximum)))
  };
}

export interface ScheduledArrivalConfiguration {
  version: string;
  timezone: string;
  dayStartTime: string;
  nightStartTime: string;
  dayArrivalFee: string;
  nightArrivalFee: string;
  costaGoPercent: string;
}
function minuteOfDay(time: string) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('INVALID_SCHEDULED_TIME');
  return Number(time.slice(0,2))*60+Number(time.slice(3));
}

/** Uses only service time, never creation/acceptance time or driver location. */
export function scheduledArrivalSnapshot(scheduledPickupDateTime: string, journeyFare: string,
  configuration: ScheduledArrivalConfiguration) {
  if (!configuration.version) throw new Error('ECONOMIC_CONFIGURATION_VERSION_REQUIRED');
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledPickupDateTime)) throw new Error('SCHEDULED_TIME_OFFSET_REQUIRED');
  const pickup = new Date(scheduledPickupDateTime);
  if (!Number.isFinite(pickup.getTime())) throw new Error('INVALID_SCHEDULED_DATETIME');
  const day = minuteOfDay(configuration.dayStartTime);
  const night = minuteOfDay(configuration.nightStartTime);
  if (day === night) throw new Error('SCHEDULED_PERIODS_OVERLAP');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: configuration.timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(pickup);
  const minute = Number(parts.find(part=>part.type==='hour')!.value)*60+
    Number(parts.find(part=>part.type==='minute')!.value);
  const isDay = day < night ? minute >= day && minute < night : minute >= day || minute < night;
  // Validate both configured amounts, even if this quote uses only one.
  const dayFee = monetaryAmount(configuration.dayArrivalFee);
  const nightFee = monetaryAmount(configuration.nightArrivalFee);
  const arrivalFee = isDay ? dayFee : nightFee;
  return Object.freeze({
    isScheduledTrip: true as const, scheduledPickupDateTime: pickup.toISOString(),
    scheduledRateType: isDay ? 'DAY' as const : 'NIGHT' as const,
    scheduledArrivalFee: arrivalFee, journeyFare: monetaryAmount(journeyFare),
    passengerTotal: fixed(add(decimal(monetaryAmount(journeyFare)), decimal(arrivalFee))),
    costaGoPercent: configuration.costaGoPercent,
    theoreticalCommission: fixed(multiply(decimal(arrivalFee), percentage(configuration.costaGoPercent))),
    // Passenger confirmation precedes driver assignment. Never guess its policy.
    billingMode: null,
    economicConfigurationVersion: configuration.version,
    timezone: configuration.timezone, dayStartTime: configuration.dayStartTime,
    nightStartTime: configuration.nightStartTime
  });
}

export type CommercialPolicy =
  | { mode: 'PAY_PER_USE'; availableBalance: string }
  | { mode: 'TRIP_PACKAGE'; remainingTrips: number }
  | { mode: 'PERIOD_PLAN'; usedTrips: number; includedTrips: number; additionalCap: string; accrued: string };

/** Resolves one policy only. Does not mutate wallets/cycles or infer activation. */
export function commercialCharge(theoreticalCommission: string, policy: CommercialPolicy) {
  const theoretical = decimal(monetaryAmount(theoreticalCommission));
  if (policy.mode === 'PAY_PER_USE') {
    if (compare(decimal(policy.availableBalance), theoretical) < 0n) throw new Error('INSUFFICIENT_AVAILABLE_BALANCE');
    return { billingMode: 'PAY_PER_USE', appliedCommission: fixed(theoretical), reserve: fixed(theoretical) };
  }
  if (policy.mode === 'TRIP_PACKAGE') {
    if (integer(policy.remainingTrips) === 0) throw new Error('MEMBERSHIP_EXHAUSTED');
    return { billingMode: 'TRIP_PACKAGE', appliedCommission: '0.00', reserve: '0.00' };
  }
  if (integer(policy.usedTrips) < integer(policy.includedTrips)) {
    return { billingMode: 'PERIOD_PLAN_INCLUDED', appliedCommission: '0.00', reserve: '0.00' };
  }
  const cap = decimal(monetaryAmount(policy.additionalCap));
  const accrued = decimal(monetaryAmount(policy.accrued));
  const remainingNumerator = cap.n*accrued.d-accrued.n*cap.d;
  if (remainingNumerator <= 0n) return { billingMode: 'PERIOD_PLAN_CAP_REACHED', appliedCommission: '0.00', reserve: '0.00' };
  const remaining = { n: remainingNumerator, d: cap.d*accrued.d };
  return { billingMode: 'PERIOD_PLAN_OVERAGE', appliedCommission: fixed(compare(theoretical, remaining) > 0n ? remaining : theoretical), reserve: '0.00' };
}

export interface RoundSample { round: number; count: number }
export function packageEconomics(input: {
  quantity: number; feePerRound: string; costaGoPercent: string;
  reference: RoundSample[]; global: RoundSample[]; zone?: RoundSample[];
  minimumSamples: number; fullConfidenceSamples: number; totalRounds: number;
  commercialFactor: string; volumeDiscountPercent: string; fixedCost: string; minimumPrice: string;
}) {
  integer(input.quantity,1); integer(input.minimumSamples,1);
  integer(input.fullConfidenceSamples,input.minimumSamples); integer(input.totalRounds,1);
  const average = (samples: RoundSample[]) => {
    let weight=0n, weightedRound=0n;
    for (const sample of samples) {
      integer(sample.round,1); integer(sample.count);
      if (sample.round > input.totalRounds) throw new Error('SAMPLE_OUTSIDE_CONFIGURED_ROUNDS');
      weight+=BigInt(sample.count); weightedRound+=BigInt(sample.count)*BigInt(sample.round);
    }
    return { weight, value: {n:weightedRound,d:weight || 1n} };
  };
  const reference = average(input.reference);
  if (!reference.weight) throw new Error('REFERENCE_DISTRIBUTION_REQUIRED');
  const global = average(input.global);
  const zone = average(input.zone ?? []);
  const minimum = BigInt(input.minimumSamples);
  const scope = zone.weight >= minimum ? 'ZONE' : global.weight >= minimum ? 'GLOBAL' : 'REFERENCE';
  const selected = scope === 'ZONE' ? zone : scope === 'GLOBAL' ? global : reference;
  const confidence = scope === 'REFERENCE' ? 0n : selected.weight < BigInt(input.fullConfidenceSamples) ? selected.weight : BigInt(input.fullConfidenceSamples);
  const denominator = BigInt(input.fullConfidenceSamples);
  const mean = add(multiply(selected.value,{n:confidence,d:denominator}),
    multiply(reference.value,{n:denominator-confidence,d:denominator}));
  const commission = multiply(multiply(mean,decimal(monetaryAmount(input.feePerRound))), percentage(input.costaGoPercent));
  const technical = multiply(commission,decimal(String(input.quantity)));
  const discount = percentage(input.volumeDiscountPercent);
  const commercial = multiply(multiply(add(technical,decimal(input.fixedCost)),decimal(input.commercialFactor)),
    {n:discount.d-discount.n,d:discount.d});
  const minimumPrice = decimal(input.minimumPrice);
  return {
    scope, sampleCount: selected.weight.toString(), meanRound: fixed(mean,6),
    expectedCommissionPerTrip: fixed(commission,6), technicalCost: fixed(technical),
    suggestedPrice: fixed(compare(commercial,minimumPrice)<0n ? minimumPrice : commercial),
    commercialFactor: input.commercialFactor, volumeDiscountPercent: input.volumeDiscountPercent,
    // Keep the actual distribution and confidence in the purchase/calculation snapshot.
    distribution: selected === reference ? input.reference : scope === 'ZONE' ? input.zone! : input.global,
    referenceDistribution: input.reference, confidence: fixed({n:confidence,d:denominator},6)
  };
}
