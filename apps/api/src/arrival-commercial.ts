import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { TransactionSql } from 'postgres';
import { database } from './database.js';
import type { TerritorialFare } from './fare-engine.js';
import { arrivalSearchBounds, immediateArrival } from './commercial-economics.js';

export const commercialConfigurationSchema=z.object({
  enabled:z.boolean(),searchSessionMinutes:z.number().int().min(1).max(1440),
  sameRouteToleranceMeters:z.number().int().min(1).max(1000),
  preserveCancelledSearchRound:z.boolean().default(true),
  lowBalanceThreshold:z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
  minimumTopUp:z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
  maximumTopUp:z.string().regex(/^\d{1,6}(\.\d{1,2})?$/),
  historicalWindowDays:z.number().int().min(1).max(730),
  minimumSamples:z.number().int().min(1),fullConfidenceSamples:z.number().int().min(1),
  recalculateMinutes:z.number().int().min(1).max(10080),
  referenceDistribution:z.array(z.object({round:z.number().int().positive(),count:z.number().int().nonnegative()})).min(1)
}).refine(v=>v.fullConfidenceSamples>=v.minimumSamples&&v.referenceDistribution.some(r=>r.count>0),{message:'INVALID_SAMPLE_CONFIGURATION'});
export const centsToAmount=(cents:number)=>{
  if(!Number.isSafeInteger(cents)||cents<0)throw new Error('INVALID_MONEY_CENTS');
  return `${BigInt(cents)/100n}.${(BigInt(cents)%100n).toString().padStart(2,'0')}`;
};
export const amountToCents=(amount:string)=>{
  if(!/^\d+\.\d{2}$/.test(amount))throw new Error('INVALID_MONEY_AMOUNT');
  const result=Number(amount.replace('.',''));
  if(!Number.isSafeInteger(result))throw new Error('MONEY_OVERFLOW');return result;
};
export function normalizeCommercialConfiguration(value:unknown):unknown {
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return value;}
}
export async function commercialContext(tx:any=database()) {
  const [row]=await tx`select arrival_commercial_configuration as configuration,arrival_commercial_version as version,
    membership_extra_trip_share_percent::text as percentage,driver_search_initial_radius_meters as initial,
    driver_search_radius_increment_meters as increment,search_radius_meters as maximum,
    driver_search_round_wait_seconds as wait from operational_settings where id=1`;
  const normalized=normalizeCommercialConfiguration(row?.configuration);
  if(!normalized||typeof normalized!=='object'||!('enabled' in normalized)||!(normalized as {enabled?:unknown}).enabled)return null;
  const config=commercialConfigurationSchema.parse(normalized);
  const [price]=await tx`select version,platform_commission_cents_per_leg as fee from pricing_versions
    where active_from<=now() and (active_until is null or active_until>now()) order by active_from desc limit 1`;
  if(!price)throw new Error('PRICING_NOT_CONFIGURED');
  const settings={initialRadiusMeters:Number(row.initial),radiusIncrementMeters:Number(row.increment),maximumRadiusMeters:Number(row.maximum),roundWaitSeconds:Number(row.wait)};
  const bounds=arrivalSearchBounds(settings);
  if(config.referenceDistribution.some(r=>r.round>bounds.length))throw new Error('REFERENCE_EXCEEDS_DISPATCH_ROUNDS');
  const result={config,settings,feePerRound:centsToAmount(Number(price.fee)),costaGoPercent:String(row.percentage),totalRounds:bounds.length};
  return {...result,version:createHash('sha256').update(JSON.stringify({row,price})).digest('hex')};
}
type Point={latitude:number;longitude:number};
export async function matchingSearchSession(tx:any,passengerId:string,points:Point[],tolerance:number) {
  const [session]=await tx`select * from arrival_search_sessions s where passenger_id=${passengerId} and status='OPEN' and expires_at>now()
    and case when jsonb_typeof(route_points)='array' then jsonb_array_length(route_points) else -1 end=${points.length}
    and not exists(select 1 from jsonb_array_elements(
      case when jsonb_typeof(route_points)='array' then route_points else '[]'::jsonb end
    ) with ordinality a(point,n)
      join jsonb_array_elements(${tx.json(points)}) with ordinality b(point,n) using(n)
      where not ST_DWithin(ST_SetSRID(ST_MakePoint((a.point->>'longitude')::float8,(a.point->>'latitude')::float8),4326)::geography,
        ST_SetSRID(ST_MakePoint((b.point->>'longitude')::float8,(b.point->>'latitude')::float8),4326)::geography,${tolerance}))
    order by started_at desc limit 1`;
  return session;
}
export function canReuseArrivalSearchSession(session:any,preserveCancelledSearchRound=true) {
  if(!session||Number(session.cancel_count??0)===0)return Boolean(session);
  return preserveCancelledSearchRound;
}
export async function immediateQuote(fare:TerritorialFare,passengerId:string,points:Point[],requestIdentity:unknown,tx:any=database()) {
  const context=await commercialContext(tx);if(!context)return null;
  const candidate=await matchingSearchSession(tx,passengerId,points,context.config.sameRouteToleranceMeters);
  const session=canReuseArrivalSearchSession(candidate,context.config.preserveCancelledSearchRound)?candidate:undefined;
  const source=session?.configuration??context;
  const minimumRound=Math.min(source.totalRounds,Math.max(1,Number(session?.max_round_reached??1)));
  const journeyFare=centsToAmount(fare.baseCents+fare.stopSurchargeCents);
  const quote={...source,journeyFare,minimumRound};
  const minimum=immediateArrival({settings:source.settings,round:minimumRound,feePerRound:source.feePerRound,journeyFare,costaGoPercent:source.costaGoPercent});
  const confirmation=createHash('sha256').update(JSON.stringify({quote,requestIdentity})).digest('hex');
  return {quote,confirmation,sessionId:session?.id as string|undefined,
    minimumTotalCents:amountToCents(minimum.passengerTotal),maximumTotalCents:amountToCents(minimum.passengerMaximum),
    minimumArrivalCents:amountToCents(minimum.arrivalFee),maximumArrivalCents:amountToCents(minimum.arrivalFeeMaximum)};
}
export async function ensureSearchSession(tx:TransactionSql,passengerId:string,points:Point[],quote:NonNullable<Awaited<ReturnType<typeof immediateQuote>>>) {
  const candidate=await matchingSearchSession(tx,passengerId,points,quote.quote.config.sameRouteToleranceMeters);
  const existing=canReuseArrivalSearchSession(candidate,quote.quote.config.preserveCancelledSearchRound)?candidate:undefined;
  if(existing) {
    const [locked]=await tx`select * from arrival_search_sessions where id=${existing.id} for update`;
    if(!locked||locked.status!=='OPEN'||new Date(locked.expires_at).getTime()<=Date.now()
      ||locked.configuration.version!==quote.quote.version
      ||Math.min(quote.quote.totalRounds,Math.max(1,Number(locked.max_round_reached)))!==quote.quote.minimumRound)
      throw new Error('PRICE_CONFIRMATION_REQUIRED');
    return String(locked.id);
  }
  if(quote.sessionId)throw new Error('PRICE_CONFIRMATION_REQUIRED');
  const [created]=await tx`insert into arrival_search_sessions(passenger_id,expires_at,route_points,configuration)
    values(${passengerId},now()+(${quote.quote.config.searchSessionMinutes}*interval '1 minute'),${tx.json(points)},
      ${tx.json(quote.quote)}) returning id`;
  return String(created!.id);
}

/** Called within trip + membership billing locks, after the real acceptance. */
export async function prepareCommercialAcceptance(tx:TransactionSql,tripId:string,driverId:string) {
  const [trip]=await tx`select t.*,coalesce((select economic_snapshot from driver_offers where trip_id=t.id and driver_id=${driverId} and accepted=true order by offered_at desc limit 1),trip_offer_economics(t.id,1)) as economics
    from trips t where t.id=${tripId} and t.driver_id=${driverId}`;
  if(!trip?.economics)return null;
  const [existing]=await tx`select snapshot from trip_commercial_assignments where trip_id=${tripId} and driver_id=${driverId}`;
  if(existing)return {replay:true,wallet:existing.snapshot.billingMode==='PAY_PER_USE',economic:existing.snapshot};
  const [cycle]=await tx`select * from driver_memberships where driver_id=${driverId} and cycle_closed_at is null for update`;
  const valid=cycle&&['ACTIVE','EXPIRING','PAYMENT_DUE','GRACE_PERIOD'].includes(cycle.status)
    &&(cycle.status!=='GRACE_PERIOD'||cycle.grace_allows_trips_applied)
    &&(!cycle.suspension_at||new Date(cycle.suspension_at).getTime()>Date.now())
    &&(cycle.plan_type_snapshot!=='TRIP_PACK'||Number(cycle.completed_trips)<Number(cycle.included_trips_snapshot));
  const economic={...trip.economics};
  if(!valid) {
    if(cycle&&['SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP'].includes(cycle.status))throw new Error('MEMBERSHIP_SUSPENDED');
    const [wallet]=await tx`select *,total-reserved as available from driver_wallets where driver_id=${driverId} and enabled=true for update`;
    if(!wallet)throw new Error('MEMBERSHIP_REQUIRED');
    await tx`select apply_driver_wallet_movement(${driverId},'RESERVE',${economic.theoreticalCommission}::numeric,
      ${`trip-reserve:${tripId}:${driverId}`},${tripId},null,${driverId},'Reserva de comisión de llegada')`;
    Object.assign(economic,{billingMode:'PAY_PER_USE',appliedCommission:economic.theoreticalCommission,
      balanceBefore:String(wallet.total),availableBefore:String(wallet.available),reservedCommission:economic.theoreticalCommission});
    await persistCommercialAssignment(tx,tripId,driverId,null,economic);
    return {replay:false,wallet:true,economic};
  }
  return {replay:false,wallet:false,economic};
}
export async function persistCommercialAssignment(tx:TransactionSql,tripId:string,driverId:string,membershipId:string|null,economic:Record<string,any>) {
  const [totals]=await tx`select (${economic.passengerTotal}::numeric-${economic.appliedCommission}::numeric)::text as profit,
    (${economic.arrivalFee??economic.scheduledArrivalFee}::numeric-${economic.appliedCommission}::numeric)::text as extra`;
  economic={...economic,economicProfit:totals!.profit,extraDriver:totals!.extra};
  await tx`insert into trip_commercial_assignments(trip_id,driver_id,membership_id,snapshot,reserved_amount)
    values(${tripId},${driverId},${membershipId},${tx.json(economic)},${economic.reservedCommission??'0.00'})
    on conflict(trip_id,driver_id) do nothing`;
  await tx`update trips set pricing_snapshot=jsonb_set(pricing_snapshot,'{economic}',${tx.json(economic)}),
    quoted_total_cents=round((${economic.passengerTotal}::numeric)*100)::int where id=${tripId}`;
  await tx`update arrival_search_sessions set matched_round=${economic.matchedRound??null},confirmed_arrival_fee=${economic.arrivalFee??economic.scheduledArrivalFee}
    where id=(select arrival_search_session_id from trips where id=${tripId})`;
}
