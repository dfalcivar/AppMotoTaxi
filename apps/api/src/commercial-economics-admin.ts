import type { FastifyInstance } from 'fastify';
import type { JSONValue } from 'postgres';
import { z } from 'zod';
import { database } from './database.js';
import {requirePermission} from './admin.js';
import {commercialConfigurationSchema,commercialContext,normalizeCommercialConfiguration} from './arrival-commercial.js';
import {calculatePackageEconomics} from './package-economics.js';

const decimal=z.string().regex(/^\d{1,6}(?:\.\d{1,6})?$/);
const guarded=(fn:(request:any,reply:any)=>Promise<any>)=>async(request:any,reply:any)=>{
  try{return await fn(request,reply);}catch(error){
    if(error instanceof z.ZodError)return reply.code(400).send({error:'INVALID_REQUEST',details:error.issues});
    if(error instanceof Error&&/^(CONFIGURATION_|RULE_|PLAN_|CALCULATION_|WALLET_|INSUFFICIENT_|REFERENCE_|TOPUP_)/.test(error.message))
      return reply.code(409).send({error:error.message});
    throw error;
  }
};
export async function registerCommercialEconomicsRoutes(app:FastifyInstance) {
  app.get('/v1/admin/commercial-economics',guarded(async request=>{
    requirePermission(request,'memberships:view');
    const [settings]=await database()`select arrival_commercial_configuration as configuration,arrival_commercial_version as version,
      membership_extra_trip_share_percent::text as "costaGoPercent",driver_search_initial_radius_meters as "initialRadiusMeters",
      driver_search_radius_increment_meters as "radiusIncrementMeters",search_radius_meters as "maximumRadiusMeters",
      driver_search_round_wait_seconds as "roundWaitSeconds" from operational_settings where id=1`;
    const plans=await database()`select p.id,p.code,p.name,p.included_trips as quantity,p.base_amount::text as price,
      to_jsonb(r) as rule,c.id as "calculationId",c.snapshot as calculation,c.calculated_at as "calculatedAt"
      from membership_plans p left join package_commercial_rules r on r.plan_code=p.code
      left join lateral(select * from package_price_calculations where plan_id=p.id order by calculated_at desc limit 1)c on true
      where p.plan_type='TRIP_PACK' and p.enabled and p.effective_until is null order by p.included_trips`;
    const [range]=await database()`select platform_commission_cents_per_leg::numeric/100 as "legacyFeePerRound",
      (1+ceil(greatest(0,${settings!.maximumRadiusMeters}::numeric-${settings!.initialRadiusMeters}::numeric)/nullif(${settings!.radiusIncrementMeters}::numeric,0)))::int as rounds
      from pricing_versions where active_from<=now() and (active_until is null or active_until>now()) order by active_from desc limit 1`;
    const configuration=normalizeCommercialConfiguration(settings?.configuration) as Record<string,unknown>|null;
    const feePerRound=Number(range?.legacyFeePerRound??0).toFixed(2);
    const rounds=Number(range?.rounds??0);
    return {settings:{...settings,configuration,rounds,feePerRound,
      minimumArrival:Number(feePerRound).toFixed(2),maximumArrival:(Number(feePerRound)*rounds).toFixed(2)},plans};
  }));
  app.put('/v1/admin/commercial-economics/configuration',guarded(async(request,reply)=>{
    const actor=requirePermission(request,'settings:manage');
    const body=z.object({version:z.number().int().nonnegative(),configuration:commercialConfigurationSchema,
      costaGoPercent:decimal.refine(value=>Number(value)>0&&Number(value)<=100).optional()}).parse(request.body);
    const result=await database().begin(async tx=>{
      const [row]=await tx`select * from operational_settings where id=1 for update`;
      if(row?.arrival_commercial_version!==body.version)throw new Error('CONFIGURATION_VERSION_CONFLICT');
      const [valid]=await tx`select ${body.configuration.minimumTopUp}::numeric>0 and ${body.configuration.maximumTopUp}::numeric>=${body.configuration.minimumTopUp}::numeric as valid`;
      if(!valid?.valid)throw new Error('TOPUP_INVALID_LIMITS');
      const costaGoPercent=body.costaGoPercent??String(row.membership_extra_trip_share_percent);
      await tx`update operational_settings set arrival_commercial_configuration=${tx.json(body.configuration)},
        membership_extra_trip_share_percent=${costaGoPercent},
        arrival_commercial_version=arrival_commercial_version+1,updated_at=now(),updated_by=${actor.id!} where id=1`;
      if(body.configuration.enabled)await commercialContext(tx);
      await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
        values(${actor.id!},'ARRIVAL_COMMERCIAL_CONFIGURATION','SETTINGS','1',${tx.json({configuration:normalizeCommercialConfiguration(row.arrival_commercial_configuration),costaGoPercent:String(row.membership_extra_trip_share_percent)} as JSONValue)},
          ${tx.json({configuration:body.configuration,costaGoPercent})},'Configuración explícita; no modifica viajes ni compras históricas')`;
      return {version:body.version+1,configuration:body.configuration,costaGoPercent};
    });return reply.send(result);
  }));
  app.put('/v1/admin/commercial-economics/packages/:planId/rules',guarded(async request=>{
    const actor=requirePermission(request,'membership_plans:manage');
    const {planId}=z.object({planId:z.string().uuid()}).parse(request.params);
    const body=z.object({version:z.number().int().nonnegative(),commercialFactor:decimal,
      volumeDiscountPercent:decimal.refine(v=>Number(v)<=100),
      fixedCost:z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),minimumPrice:z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/),
      serviceAreaId:z.string().uuid().nullable()}).parse(request.body);
    return database().begin(async tx=>{
      const [plan]=await tx`select code from membership_plans where id=${planId} and plan_type='TRIP_PACK' for update`;
      if(!plan)throw new Error('PLAN_NOT_FOUND');
      const [existing]=await tx`select version from package_commercial_rules where plan_code=${plan.code} for update`;
      if(Number(existing?.version??0)!==body.version)throw new Error('RULE_VERSION_CONFLICT');
      await tx`insert into package_commercial_rules(plan_code,commercial_factor,volume_discount_percent,fixed_cost,minimum_price,service_area_id,version,updated_by)
        values(${plan.code},${body.commercialFactor},${body.volumeDiscountPercent},${body.fixedCost},${body.minimumPrice},${body.serviceAreaId},${body.version+1},${actor.id!})
        on conflict(plan_code) do update set commercial_factor=excluded.commercial_factor,volume_discount_percent=excluded.volume_discount_percent,
          fixed_cost=excluded.fixed_cost,minimum_price=excluded.minimum_price,service_area_id=excluded.service_area_id,version=excluded.version,updated_at=now(),updated_by=excluded.updated_by`;
      await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
        values(${actor.id!},'PACKAGE_COMMERCIAL_RULES','MEMBERSHIP_PLAN',${planId},${JSON.stringify(body)}::jsonb,'Reglas comerciales específicas del paquete')`;
      return {version:body.version+1};
    });
  }));
  app.post('/v1/admin/commercial-economics/packages/:planId/recalculate',guarded(async request=>{
    requirePermission(request,'membership_plans:manage');
    const {planId}=z.object({planId:z.string().uuid()}).parse(request.params);
    const result=await calculatePackageEconomics(planId);if(!result)throw new Error('RULE_OR_CONFIGURATION_REQUIRED');return result;
  }));
  app.post('/v1/admin/commercial-economics/packages/:planId/apply-suggested-price',guarded(async request=>{
    const actor=requirePermission(request,'membership_plans:manage');
    const {planId}=z.object({planId:z.string().uuid()}).parse(request.params);
    const body=z.object({calculationId:z.string().uuid(),confirm:z.literal(true)}).parse(request.body);
    return database().begin(async tx=>{
      const [p]=await tx`select * from membership_plans where id=${planId} and plan_type='TRIP_PACK' and enabled and effective_until is null for update`;
      if(!p)throw new Error('PLAN_NOT_CURRENT');
      const [c]=await tx`select * from package_price_calculations where id=${body.calculationId} and plan_id=${planId}`;
      const [r]=await tx`select * from package_commercial_rules where plan_code=${p.code} for update`;
      const context=await commercialContext(tx);
      if(!c||!r||!context||c.rule_version!==r.version||c.configuration_version!==context.version)throw new Error('CALCULATION_STALE');
      const [latest]=await tx`select id from package_price_calculations where plan_id=${planId} order by calculated_at desc limit 1`;
      if(latest?.id!==c.id)throw new Error('CALCULATION_STALE');
      await tx`update membership_plans set enabled=false,effective_until=now(),updated_at=now(),updated_by=${actor.id!} where id=${planId}`;
      const [next]=await tx`insert into membership_plans(code,version,name,plan_type,period_unit,period_count,duration_days,base_amount,currency,included_trips,
        pack_validity_days,max_renewal_amount,extra_trip_share_percent,enabled,effective_from,created_by,updated_by)
        values(${p.code},${Number(p.version)+1},${p.name},'TRIP_PACK',${p.period_unit},${p.period_count},${p.duration_days},${c.snapshot.suggestedPrice},${p.currency},
          ${p.included_trips},${p.pack_validity_days},${c.snapshot.suggestedPrice},0,true,now(),${actor.id!},${actor.id!}) returning id,version`;
      await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
        values(${actor.id!},'PACKAGE_SUGGESTED_PRICE_APPLIED','MEMBERSHIP_PLAN',${String(next!.id)},
          ${JSON.stringify({planId,price:p.base_amount})}::jsonb,${JSON.stringify({price:c.snapshot.suggestedPrice,calculationId:c.id})}::jsonb,'Precio publicado por confirmación administrativa')`;
      return next;
    });
  }));
  app.get('/v1/admin/commercial-economics/wallets',guarded(async request=>{
    requirePermission(request,'memberships:view');
    const {driverId}=z.object({driverId:z.string().uuid().optional()}).parse(request.query);
    const wallets=await database()`select w.driver_id as "driverId",u.full_name as name,w.total::text,w.reserved::text,(w.total-w.reserved)::text as available,w.enabled
      from driver_wallets w join users u on u.id=w.driver_id where (${driverId??null}::uuid is null or w.driver_id=${driverId??null}) order by u.full_name limit 200`;
    const movements=driverId?await database()`select * from driver_wallet_movements where driver_id=${driverId} order by created_at desc limit 200`:[];
    return {wallets,movements};
  }));
  app.post('/v1/admin/commercial-economics/wallets/:driverId/adjust',guarded(async request=>{
    const actor=requirePermission(request,'memberships:manage');
    const {driverId}=z.object({driverId:z.string().uuid()}).parse(request.params);
    const body=z.object({amount:z.string().regex(/^-?\d{1,6}(\.\d{1,2})?$/),reason:z.string().trim().min(5).max(500),idempotencyKey:z.string().min(8).max(120)}).parse(request.body);
    const [result]=await database()`select apply_driver_wallet_movement(${driverId},'ADMIN_ADJUSTMENT',${body.amount}::numeric,
      ${`admin-wallet:${actor.id}:${body.idempotencyKey}`},null,null,${actor.id!},${body.reason}) as id`;
    return result;
  }));
  app.get('/v1/admin/commercial-economics/dashboard',guarded(async request=>{
    requirePermission(request,'memberships:view');
    const q=z.object({from:z.string().datetime({offset:true}).optional(),to:z.string().datetime({offset:true}).optional(),serviceAreaId:z.string().uuid().optional(),
      planId:z.string().uuid().optional(),billingMode:z.enum(['PAY_PER_USE','TRIP_PACKAGE','PERIOD_PLAN_INCLUDED','PERIOD_PLAN_OVERAGE','PERIOD_PLAN_CAP_REACHED']).optional()}).parse(request.query);
    const rows=await database()`select a.snapshot->>'billingMode' as mode,count(*)::int as trips,
      sum(coalesce(a.snapshot->>'arrivalFee',a.snapshot->>'scheduledArrivalFee')::numeric)::text as "arrivalTotal",
      sum((a.snapshot->>'theoreticalCommission')::numeric)::text as theoretical,
      sum((a.snapshot->>'appliedCommission')::numeric)::text as applied,
      sum((a.snapshot->>'theoreticalCommission')::numeric-(a.snapshot->>'appliedCommission')::numeric)::text as covered,
      avg((a.snapshot->>'theoreticalCommission')::numeric)::text as "averageCommission",
      avg(coalesce(a.snapshot->>'arrivalFee',a.snapshot->>'scheduledArrivalFee')::numeric)::text as "averageArrival",
      avg((a.snapshot->>'matchedRound')::numeric)::text as "averageRound"
      from trip_commercial_assignments a join trips t on t.id=a.trip_id where a.completed_at is not null
      and (${q.from??null}::timestamptz is null or a.completed_at>=${q.from??null}) and (${q.to??null}::timestamptz is null or a.completed_at<${q.to??null})
      and (${q.serviceAreaId??null}::uuid is null or t.service_area_id=${q.serviceAreaId??null})
      and (${q.planId??null}::text is null or a.snapshot->>'planId'=${q.planId??null})
      and (${q.billingMode??null}::text is null or a.snapshot->>'billingMode'=${q.billingMode??null}) group by 1 order by 1`;
    const rounds=await database()`select coalesce(a.snapshot->>'matchedRound','PROGRAMADO') as round,count(*)::int as trips
      from trip_commercial_assignments a join trips t on t.id=a.trip_id where a.completed_at is not null
      and (${q.from??null}::timestamptz is null or a.completed_at>=${q.from??null}) and (${q.to??null}::timestamptz is null or a.completed_at<${q.to??null})
      and (${q.serviceAreaId??null}::uuid is null or t.service_area_id=${q.serviceAreaId??null})
      and (${q.planId??null}::text is null or a.snapshot->>'planId'=${q.planId??null})
      and (${q.billingMode??null}::text is null or a.snapshot->>'billingMode'=${q.billingMode??null}) group by 1 order by 1`;
    const packages=await database()`select p.id,p.snapshot,p.quantity,p.used,
      (p.snapshot->>'publishedPrice')::numeric-coalesce(sum((a.snapshot->>'theoreticalCommission')::numeric) filter(where a.completed_at is not null),0) as "realMargin",
      coalesce(sum((a.snapshot->>'theoreticalCommission')::numeric) filter(where a.completed_at is not null),0)::text as "realTheoreticalCommission"
      from package_purchases p left join trip_commercial_assignments a on a.snapshot->>'packagePurchaseId'=p.id::text
      where (${q.from??null}::timestamptz is null or p.created_at>=${q.from??null}) and (${q.to??null}::timestamptz is null or p.created_at<${q.to??null})
      and (${q.planId??null}::text is null or p.snapshot->>'packageId'=${q.planId??null})
      and (${q.billingMode??null}::text is null or ${q.billingMode??null}='TRIP_PACKAGE')
      and (${q.serviceAreaId??null}::uuid is null or exists(select 1 from trip_commercial_assignments pa join trips pt on pt.id=pa.trip_id
        where pa.snapshot->>'packagePurchaseId'=p.id::text and pt.service_area_id=${q.serviceAreaId??null}))
      group by p.id order by p.created_at desc limit 200`;
    // Cash receipts have no trip zone. Report them explicitly as global fiscal
    // flows in the selected date window, never assign them to an arbitrary trip.
    const receipts=await database()`select case when o.purpose='WALLET_TOPUP' then 'WALLET_TOPUP'
        else o.plan_snapshot->>'planType' end as mode,count(*)::int as payments,
      sum(o.base_amount)::text as base,sum(o.prior_usage_amount)::text as overages,
      sum(o.taxable_subtotal)::text as net,sum(o.vat_amount)::text as vat
      from membership_payments p join membership_payment_orders o on o.id=p.order_id where p.status='CONFIRMED'
      and (${q.from??null}::timestamptz is null or p.confirmed_at>=${q.from??null}) and (${q.to??null}::timestamptz is null or p.confirmed_at<${q.to??null})
      group by 1 order by 1`;
    const [wallets]=await database()`select coalesce(sum(total),0)::text as total,coalesce(sum(reserved),0)::text as reserved from driver_wallets`;
    return {modalities:rows,rounds,packages,wallets,receipts,receiptsScope:'GLOBAL_DATE_WINDOW',packageMetricsScope:'PURCHASE_COHORT_LIFETIME_USAGE'};
  }));
}
