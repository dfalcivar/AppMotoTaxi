import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { database } from './database.js';
import { requirePermission, persistAudit } from './admin.js';
import { reversePassengerCancelledMembershipUsage } from './membership-trip-usage.js';

export const passengerCancellationPolicySchema = z.object({
  enabled: z.boolean(),
  cycleDurationDays: z.number().int().min(1).max(3650).default(30),
  steps: z.array(z.object({
    fromCount: z.number().int().min(1).max(10000),
    suspensionDays: z.number().int().min(0).max(3650).nullable()
  })).min(1).max(30)
}).superRefine((policy, ctx) => {
  if (policy.steps[0]?.fromCount !== 1 || policy.steps.some((step, index) =>
    index > 0 && (step.fromCount <= policy.steps[index - 1]!.fromCount || policy.steps[index - 1]!.suspensionDays === null))) {
    ctx.addIssue({ code: 'custom', message: 'Los rangos deben iniciar en 1, ser crecientes y dejar la suspensión indefinida al final.' });
  }
});
export type PassengerCancellationPolicy = z.infer<typeof passengerCancellationPolicySchema>;

export function cancellationConsequence(policy: Pick<PassengerCancellationPolicy,'enabled'|'steps'>, count: number): number | null {
  if (!policy.enabled) return 0;
  const step = [...policy.steps].reverse().find(step => count >= step.fromCount);
  return step ? step.suspensionDays : 0;
}

export function passengerCanCancel(trip: { status: string; startedAt?: unknown }): boolean {
  return !trip.startedAt && ['SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED'].includes(trip.status);
}

// Cycle expiration never changes account/suspension fields or historical rows.
export async function expirePassengerCancellationCycles(userId?: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await database()`update users u set passenger_cancellation_count=0
    from passenger_cancellation_cycles cy where cy.id=u.passenger_cancellation_cycle_id
      and cy.ends_at<=now() and u.passenger_cancellation_count<>0
      and (${userId ?? null}::uuid is null or u.id=${userId ?? null}::uuid)`;
}

type CancellationSummaryRow = {
  accountStatus:string; historicalTotal:number; cycleCount:number;
  cycleId:string|null; cycleStartsAt:Date|null; cycleEndsAt:Date|null;
  cycleDurationDays:number|null; cycleActive:boolean; cycleSource:string|null;
  cancellationSuspended:boolean; suspendedUntil:Date|null; policy:unknown;
};
export async function passengerCancellationSummary(passengerId: string) {
  const [row] = await database()<CancellationSummaryRow[]>`select u.status as "accountStatus",u.passenger_cancellation_total::int as "historicalTotal",
    case when cy.ends_at>now() then u.passenger_cancellation_count else 0 end as "cycleCount",
    cy.id as "cycleId",cy.starts_at as "cycleStartsAt",cy.ends_at as "cycleEndsAt",cy.duration_days as "cycleDurationDays",
    coalesce(cy.ends_at>now(),false) as "cycleActive",cy.source as "cycleSource",
    u.passenger_cancellation_suspended as "cancellationSuspended",u.passenger_suspended_until as "suspendedUntil",
    os.passenger_cancellation_policy as policy
    from users u left join passenger_cancellation_cycles cy on cy.id=u.passenger_cancellation_cycle_id
    join operational_settings os on os.id=1 where u.id=${passengerId} and u.deleted_at is null`;
  if (!row) return null;
  const policy = passengerCancellationPolicySchema.parse(row.policy);
  const count = Number(row.cycleCount);
  const next = policy.enabled ? policy.steps.find(s=>s.fromCount>count&&(s.suspensionDays===null||s.suspensionDays>0)) : undefined;
  const threshold = policy.enabled ? policy.steps.find(s=>s.suspensionDays===null||s.suspensionDays>0)?.fromCount ?? null : null;
  const suspended = row.accountStatus==='SUSPENDED';
  const {policy: _rawPolicy,...summary}=row;
  return {...summary,threshold,nextThreshold:next?.fromCount??null,configuredDurationDays:policy.cycleDurationDays,
    enforcementEnabled:policy.enabled,
    state:suspended ? (row.cancellationSuspended&&!row.suspendedUntil?'INDEFINITE':'SUSPENDED') : count>0&&policy.enabled?'WARNING':'NORMAL'};
}

export async function passengerCancellationHistory(passengerId: string, page: number) {
  return database()`select c.*,d.full_name as "driverName",t.origin_reference as origin,t.destination_reference as destination,
    cy.starts_at as "cycleStartsAt",cy.ends_at as "cycleEndsAt",cy.duration_days as "cycleDurationDays",cy.source as "cycleSource",
    originator.full_name as "originatorName",count(*) over()::int as "totalCount"
    from passenger_cancellations c join users d on d.id=c.driver_id join trips t on t.id=c.trip_id
    join passenger_cancellation_cycles cy on cy.id=c.cycle_id join users originator on originator.id=c.originated_by
    where c.passenger_id=${passengerId} order by c.occurred_at desc,c.id desc limit 20 offset ${(page-1)*20}`;
}

// Only expirations created by this policy can restore ACTIVE. Administrative
// suspensions and indefinite restrictions never expire through this function.
export async function releaseExpiredPassengerSuspensions(userId?: string): Promise<void> {
  if (!process.env.DATABASE_URL) return;
  await database()`with released as (
      update users set status='ACTIVE', passenger_cancellation_suspended=false,
      passenger_suspended_until=null, updated_at=now()
      where passenger_cancellation_suspended=true and passenger_suspended_until<=now()
        and (${userId ?? null}::uuid is null or id=${userId ?? null}::uuid)
        and status='SUSPENDED' and deleted_at is null returning id
    ) update passenger_cancellations set status='EXPIRED'
      where passenger_id in (select id from released) and status='SUSPENDED' and suspension_until<=now()`;
}

export async function registerPassengerCancellationRoutes(app: FastifyInstance): Promise<void> {
  if (process.env.DATABASE_URL) {
    const expirationTimer = setInterval(() => {
      void releaseExpiredPassengerSuspensions().catch(error => app.log.error({err:error},'passenger_suspension_expiration_failed'));
      void expirePassengerCancellationCycles().catch(error => app.log.error({err:error},'passenger_cycle_expiration_failed'));
    }, 60_000);
    expirationTimer.unref();
    app.addHook('onClose',async()=>clearInterval(expirationTimer));
  }
  // Operations remain in the existing administrative authorization system.
  app.get('/v1/admin/settings/passenger-cancellations', async (request, reply) => {
    try { requirePermission(request, 'settings:view'); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN' }); }
    const [row] = await database()`select passenger_cancellation_policy as policy from operational_settings where id=1`;
    return passengerCancellationPolicySchema.parse(row?.policy);
  });
  app.patch('/v1/admin/settings/passenger-cancellations', async (request, reply) => {
    let actor;
    try { actor = requirePermission(request, 'settings:manage'); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN' }); }
    const parsed = passengerCancellationPolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CANCELLATION_POLICY' });
    // Older admin clients may omit duration: preserve the current configured value.
    if (!(request.body as Record<string,unknown>).cycleDurationDays) {
      const [current]=await database()`select passenger_cancellation_policy as policy from operational_settings where id=1`;
      parsed.data.cycleDurationDays=passengerCancellationPolicySchema.parse(current?.policy).cycleDurationDays;
    }
    await database()`update operational_settings set passenger_cancellation_policy=${JSON.stringify(parsed.data)}::jsonb,
      updated_at=now(), updated_by=${actor.id!} where id=1`;
    await persistAudit(actor, 'PASSENGER_CANCELLATION_POLICY_UPDATED','SETTINGS','1',JSON.stringify(parsed.data));
    return parsed.data;
  });
  app.get('/v1/admin/passengers/:id/cancellation-summary', async (request,reply)=>{
    try {requirePermission(request,'passengers:view');} catch {return reply.code(403).send({error:'FORBIDDEN'});}
    const id=z.string().uuid().safeParse((request.params as {id:string}).id);
    if(!id.success)return reply.code(400).send({error:'INVALID_DATA'});
    const summary=await passengerCancellationSummary(id.data);
    return summary ?? reply.code(404).send({error:'NOT_FOUND'});
  });
  app.get('/v1/admin/passengers/:id/cancellations', async (request, reply) => {
    try { requirePermission(request, 'passengers:view'); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN' }); }
    const id = z.string().uuid().safeParse((request.params as {id:string}).id);
    const query = z.object({ page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query);
    if (!id.success || !query.success) return reply.code(400).send({ error: 'INVALID_DATA' });
    return passengerCancellationHistory(id.data,query.data.page);
  });
}

export async function cancelPassengerTrip(passengerId: string, tripId: string) {
  return database().begin(async tx => {
      // Serialize cycle creation, penalties and retries with the passenger row lock.
      const [passenger] = await tx`select status, passenger_cancellation_count as count,
        passenger_cancellation_cycle_id as "cycleId" from users where id=${passengerId} for update`;
      const [existing] = await tx`
        select driver_id::text as "driverId", schedule_status as "scheduleStatus", status, started_at as "startedAt",
          assigned_at as "assignedAt"
        from trips where id=${tripId} and passenger_id=${passengerId}
        for update
      `;
      if (!existing) return null;
      if (existing.status === 'CANCELLED') {
        const [record] = await tx`select consecutive_number as count, suspension_days as "suspensionDays",
          suspension_until as "suspendedUntil" from passenger_cancellations where trip_id=${tripId} and passenger_id=${passengerId}`;
        return { driverIds: [] as string[], scheduled: Boolean(existing.scheduleStatus), replay: true,
          consequence: record ? {count:Number(record.count),suspensionDays:record.suspensionDays as number|null,suspendedUntil:record.suspendedUntil} : null };
      }
      if (passenger?.status !== 'ACTIVE') return null;
      if (!passengerCanCancel(existing as {status:string;startedAt?:unknown})) return null;
      const [trip] = await tx`
        update trips set status='CANCELLED', cancelled_at=now(), schedule_status=null, driver_search_next_round_at=null
        where id=${tripId} and passenger_id=${passengerId}
        returning id::text
      `;
      if (!trip) return null;
      const drivers = await tx`select driver_id from driver_offers where trip_id=${tripId} and responded_at is null`;
      await tx`update driver_offers set responded_at=coalesce(responded_at, now()),
        accepted=coalesce(accepted, false), response_reason=coalesce(response_reason,'PASSENGER_CANCELLED')
        where trip_id=${tripId}`;
      let consequence: { count: number; suspensionDays: number | null; suspendedUntil: unknown } | null = null;
      let membershipReversal = null;
      if (existing.driverId && existing.assignedAt) {
        const [proof] = await tx`select 1 where exists(select 1 from driver_offers where trip_id=${tripId} and driver_id=${existing.driverId} and accepted=true)
          or exists(select 1 from scheduled_trip_responses where trip_id=${tripId} and driver_id=${existing.driverId} and accepted=true)`;
        if (proof) {
          const [settings] = await tx`select passenger_cancellation_policy as policy from operational_settings where id=1`;
          const policy = passengerCancellationPolicySchema.parse(settings!.policy);
          const [instant]=await tx`select clock_timestamp() as at`;
          let [cycle]=await tx`select * from passenger_cancellation_cycles where id=${passenger!.cycleId}
            and passenger_id=${passengerId} and ends_at>${instant!.at}`;
          const previousCount=cycle ? Number(passenger!.count) : 0;
          if(!cycle) {
            [cycle]=await tx`insert into passenger_cancellation_cycles(passenger_id,starts_at,ends_at,duration_days)
              values(${passengerId},${instant!.at},${instant!.at}::timestamptz+${policy.cycleDurationDays}*interval '24 hours',${policy.cycleDurationDays}) returning *`;
          }
          const count = previousCount + 1;
          const days = cancellationConsequence(policy, count);
          const suspended = days === null || days > 0;
          const [account] = await tx`update users set passenger_cancellation_count=${count},
            passenger_cancellation_total=passenger_cancellation_total+1,passenger_cancellation_cycle_id=${cycle!.id},
            passenger_cancellation_suspended=${suspended},
            passenger_suspended_until=case when ${days}::int>0 then now()+${days}::int*interval '1 day' else null end,
            status=case when ${suspended} then 'SUSPENDED'::account_status else status end, updated_at=now()
            where id=${passengerId} returning passenger_suspended_until as "suspendedUntil"`;
          await tx`insert into passenger_cancellations(passenger_id,trip_id,driver_id,consecutive_number,trip_status,cycle_id,originated_by,occurred_at,
            suspension_days,suspension_started_at,suspension_until,status,policy_snapshot)
            values(${passengerId},${tripId},${existing.driverId},${count},${existing.status},${cycle!.id},${passengerId},${instant!.at},${days},
              case when ${suspended} then now() else null end,${account!.suspendedUntil},${suspended?'SUSPENDED':'RECORDED'},${JSON.stringify(policy)}::jsonb)`;
          consequence = {count, suspensionDays:days, suspendedUntil:account!.suspendedUntil};
          membershipReversal = await reversePassengerCancelledMembershipUsage(tx, tripId, String(existing.driverId), passengerId);
        }
        // A future reservation must not release a driver occupied by a different trip.
        await tx`update drivers set is_available=true where user_id=${existing.driverId} and approval_status='APROBADO'
          and exists(select 1 from users where id=${existing.driverId} and status='ACTIVE' and deleted_at is null)
          and not exists(select 1 from trips where driver_id=${existing.driverId} and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))`;
      }
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code,metadata) values (${tripId}, ${existing.status}, 'CANCELLED', ${passengerId}, 'PASSENGER_CANCELLED',${JSON.stringify({consequence,membershipReversal})}::jsonb)`;
      return {
        driverIds: [...new Set([
          ...drivers.map(driver => String(driver.driver_id)),
          ...(existing.driverId ? [String(existing.driverId)] : [])
        ])],
        scheduled: Boolean(existing.scheduleStatus), replay:false, consequence
      };
    });
}
