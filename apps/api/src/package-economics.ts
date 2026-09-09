import { database } from './database.js';
import { commercialContext } from './arrival-commercial.js';
import { packageEconomics } from './commercial-economics.js';

export async function calculatePackageEconomics(planId:string,tx:any=database()) {
  const context=await commercialContext(tx);if(!context)return null;
  const [plan]=await tx`select * from membership_plans where id=${planId} and plan_type='TRIP_PACK'`;
  if(!plan)return null;
  const [rule]=await tx`select * from package_commercial_rules where plan_code=${plan.code}`;
  if(!rule)return null;
  const history=async(zone:string|null)=>{
    const rows=await tx`select least(coalesce((a.snapshot->>'matchedRound')::int,o.search_round),${context.totalRounds}) as round,count(*)::int as count
      from trips t left join trip_commercial_assignments a on a.trip_id=t.id and a.driver_id=t.driver_id
      left join driver_offers o on o.trip_id=t.id and o.driver_id=t.driver_id and o.accepted=true
      where t.status='COMPLETED' and t.scheduled_for is null and t.completed_at>=now()-(${context.config.historicalWindowDays}*interval '1 day')
        and coalesce((a.snapshot->>'matchedRound')::int,o.search_round)>0
        and (${zone}::uuid is null or t.service_area_id=${zone}::uuid) group by 1 order by 1`;
    return rows.map((r:any)=>({round:Number(r.round),count:Number(r.count)}));
  };
  const global=await history(null),zone=rule.service_area_id?await history(String(rule.service_area_id)):undefined;
  const calculation=packageEconomics({quantity:Number(plan.included_trips),feePerRound:context.feePerRound,costaGoPercent:context.costaGoPercent,
    reference:context.config.referenceDistribution,global,zone,minimumSamples:context.config.minimumSamples,fullConfidenceSamples:context.config.fullConfidenceSamples,
    totalRounds:context.totalRounds,commercialFactor:String(rule.commercial_factor),volumeDiscountPercent:String(rule.volume_discount_percent),
    fixedCost:String(rule.fixed_cost),minimumPrice:String(rule.minimum_price)});
  const [comparison]=await tx`select case when ${plan.base_amount}::numeric=0 then null else
    round((${calculation.suggestedPrice}::numeric-${plan.base_amount}::numeric)/${plan.base_amount}::numeric*100,2)::text end as difference,
    (${plan.base_amount}::numeric-${calculation.technicalCost}::numeric)::text as margin,
    round(${plan.base_amount}::numeric/${plan.included_trips}::numeric,6)::text as unit`;
  const snapshot={...calculation,packageId:planId,quantity:Number(plan.included_trips),publishedPrice:String(plan.base_amount),
    percentageDifference:comparison.difference,expectedMargin:comparison.margin,unitPublishedPrice:comparison.unit,costaGoPercent:context.costaGoPercent,
    feePerRound:context.feePerRound,settings:context.settings,configurationVersion:context.version,ruleVersion:Number(rule.version),
    historicalWindowDays:context.config.historicalWindowDays,serviceAreaId:calculation.scope==='ZONE'?String(rule.service_area_id):null,
    configuredServiceAreaId:rule.service_area_id,fixedCost:String(rule.fixed_cost),minimumPrice:String(rule.minimum_price),
    historicalRoundsCappedAt:context.totalRounds,calculatedAt:new Date().toISOString()};
  const [saved]=await tx`insert into package_price_calculations(plan_id,rule_version,configuration_version,snapshot)
    values(${planId},${rule.version},${context.version},${JSON.stringify(snapshot)}::jsonb) returning id`;
  return {...snapshot,calculationId:String(saved.id)};
}
export async function packageEconomicsTick() {
  const context=await commercialContext();if(!context)return;
  // Each scheduler process uses the same transaction lock; a second Render
  // instance cannot simultaneously recalculate the whole catalogue.
  await database().begin(async tx=>{
    const [lock]=await tx`select pg_try_advisory_xact_lock(hashtext('package-economics-worker')) as locked`;
    if(!lock?.locked)return;
    const plans=await tx`select p.id from membership_plans p join package_commercial_rules r on r.plan_code=p.code
      where p.plan_type='TRIP_PACK' and p.enabled and p.effective_until is null and p.effective_from<=now()
      and not exists(select 1 from package_price_calculations c where c.plan_id=p.id and c.rule_version=r.version
        and c.configuration_version=${context.version} and c.calculated_at>now()-(${context.config.recalculateMinutes}*interval '1 minute'))`;
    for(const plan of plans)await calculatePackageEconomics(String(plan.id),tx);
  });
}
