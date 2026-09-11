import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { database } from './database.js';
import { requirePermission } from './admin.js';
import { scheduledArrivalSnapshot } from './commercial-economics.js';
import type { TerritorialFare } from './fare-engine.js';

const amount = z.string().regex(/^\d{1,6}(?:\.\d{1,2})?$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export function legacyScheduledConfirmation(fare: TerritorialFare, pickup: Date, requestIdentity: unknown) {
  return createHash('sha256').update(JSON.stringify({scheduledFor:pickup.toISOString(),
    pricingVersion:fare.pricingVersion,baseCents:fare.baseCents,stopSurchargeCents:fare.stopSurchargeCents,
    platformCommissionCents:fare.platformCommissionCents,totalCents:fare.totalCents,requestIdentity})).digest('hex');
}
export const scheduledArrivalSchema = z.object({
  enabled: z.boolean(), dayArrivalFee: amount, nightArrivalFee: amount,
  dayStartTime: time, nightStartTime: time,
  timezone: z.string().min(1).max(80).refine(value => {
    try { new Intl.DateTimeFormat('en', {timeZone:value}); return true; } catch { return false; }
  })
}).refine(value => value.dayStartTime !== value.nightStartTime, {message:'SCHEDULED_PERIODS_OVERLAP'});

export function scheduledQuote(fare: TerritorialFare, pickup: Date, config: z.infer<typeof scheduledArrivalSchema>,
  version: number, costaGoPercent: string, requestIdentity: unknown) {
  // Replace the legacy additional-per-leg, never add a second commission.
  const journeyCents = fare.baseCents + fare.stopSurchargeCents;
  if (!Number.isSafeInteger(journeyCents) || journeyCents < 0) throw new Error('INVALID_JOURNEY_FARE');
  const journeyFare = `${Math.floor(journeyCents/100)}.${String(journeyCents%100).padStart(2,'0')}`;
  const economic = scheduledArrivalSnapshot(pickup.toISOString(),journeyFare,
    {...config,version:String(version),costaGoPercent});
  const totalCents = Number(economic.passengerTotal.replace('.',''));
  const arrivalCents = Number(economic.scheduledArrivalFee.replace('.',''));
  if (!Number.isSafeInteger(totalCents)) throw new Error('INVALID_TOTAL');
  // No secret/signature necessary: server always recalculates authoritative values.
  // This fingerprint is an optimistic confirmation of the exact preview shown.
  const confirmation = createHash('sha256').update(JSON.stringify({economic,pricingVersion:fare.pricingVersion,
    requestIdentity})).digest('hex');
  return { economic, confirmation, totalCents, arrivalCents, journeyCents };
}

export async function configuredScheduledQuote(fare: TerritorialFare, pickup: Date | undefined,
  requestIdentity: unknown) {
  if (!pickup) return null; // No changes/extra lookup for immediate requests.
  const [settings] = await database()`select scheduled_arrival_configuration as configuration,
    scheduled_arrival_version as version,membership_extra_trip_share_percent::text as percentage
    from operational_settings where id=1`;
  if (!settings?.configuration?.enabled) return null;
  const config = scheduledArrivalSchema.parse(settings.configuration);
  return scheduledQuote(fare,pickup,config,Number(settings.version),String(settings.percentage),requestIdentity);
}

export async function registerScheduledArrivalRoutes(app: FastifyInstance) {
  app.get('/v1/admin/scheduled-arrival-settings',async (request,reply)=>{
    requirePermission(request,'settings:manage');
    reply.header('Cache-Control','private, no-store');
    const [row] = await database()`select scheduled_arrival_configuration as configuration,
      scheduled_arrival_version as version,membership_extra_trip_share_percent::text as "costaGoPercent"
      from operational_settings where id=1`;
    return row;
  });
  app.put('/v1/admin/scheduled-arrival-settings',async (request,reply)=>{
    reply.header('Cache-Control','private, no-store');
    const actor = requirePermission(request,'settings:manage');
    const parsed = z.object({version:z.number().int().nonnegative(),configuration:scheduledArrivalSchema}).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({error:'INVALID_SCHEDULED_ARRIVAL_SETTINGS',details:parsed.error.issues});
    const result = await database().begin(async tx=>{
      const [previous] = await tx`select scheduled_arrival_version as version,scheduled_arrival_configuration as configuration
        from operational_settings where id=1 for update`;
      if (!previous || previous.version !== parsed.data.version) return null;
      const [next] = await tx`update operational_settings set
        scheduled_arrival_configuration=${JSON.stringify(parsed.data.configuration)}::jsonb,
        scheduled_arrival_version=scheduled_arrival_version+1,updated_at=now(),updated_by=${actor.id!}
        where id=1 returning scheduled_arrival_version as version,scheduled_arrival_configuration as configuration`;
      await tx`insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
        values(${actor.id!},'SCHEDULED_ARRIVAL_SETTINGS_UPDATED','SETTINGS','1',${JSON.stringify(previous)}::jsonb,
          ${JSON.stringify({...next,source:actor.administrativeSource??'WEB_ADMIN'})}::jsonb,'Tarifa programada por hora del servicio; no cambia reservas confirmadas')`;
      return next;
    });
    if (!result) return reply.code(409).send({error:'SETTINGS_VERSION_CONFLICT'});
    return result;
  });
}
