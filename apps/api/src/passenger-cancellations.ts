import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import { database } from './database.js';
import { requirePermission, persistAudit } from './admin.js';

export const passengerCancellationPolicySchema = z.object({
  enabled: z.boolean(),
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

export function cancellationConsequence(policy: PassengerCancellationPolicy, count: number): number | null {
  if (!policy.enabled) return 0;
  const step = [...policy.steps].reverse().find(step => count >= step.fromCount);
  return step ? step.suspensionDays : 0;
}

export function passengerCanCancel(trip: { status: string; startedAt?: unknown }): boolean {
  return !trip.startedAt && ['SEARCHING','ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED'].includes(trip.status);
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
    }, 60_000);
    expirationTimer.unref();
    app.addHook('onClose',async()=>clearInterval(expirationTimer));
  }
  // Operations remain in the existing administrative authorization system.
  app.get('/v1/admin/settings/passenger-cancellations', async (request, reply) => {
    try { requirePermission(request, 'settings:view'); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN' }); }
    const [row] = await database()`select passenger_cancellation_policy as policy from operational_settings where id=1`;
    return row?.policy;
  });
  app.patch('/v1/admin/settings/passenger-cancellations', async (request, reply) => {
    let actor;
    try { actor = requirePermission(request, 'settings:manage'); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN' }); }
    const parsed = passengerCancellationPolicySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_CANCELLATION_POLICY' });
    await database()`update operational_settings set passenger_cancellation_policy=${JSON.stringify(parsed.data)}::jsonb,
      updated_at=now(), updated_by=${actor.id!} where id=1`;
    await persistAudit(actor, 'PASSENGER_CANCELLATION_POLICY_UPDATED','SETTINGS','1',JSON.stringify(parsed.data));
    return parsed.data;
  });
  app.get('/v1/admin/passengers/:id/cancellations', async (request, reply) => {
    try { requirePermission(request, 'passengers:view'); }
    catch { return reply.code(403).send({ error: 'FORBIDDEN' }); }
    const id = z.string().uuid().safeParse((request.params as {id:string}).id);
    const query = z.object({ page: z.coerce.number().int().min(1).default(1) }).safeParse(request.query);
    if (!id.success || !query.success) return reply.code(400).send({ error: 'INVALID_DATA' });
    return database()`select c.*, d.full_name as "driverName", t.origin_reference as origin, t.destination_reference as destination,
      count(*) over()::int as "totalCount"
      from passenger_cancellations c join users d on d.id=c.driver_id join trips t on t.id=c.trip_id
      where c.passenger_id=${id.data} order by c.consecutive_number desc limit 20 offset ${(query.data.page-1)*20}`;
  });
}

export async function cancelPassengerTrip(passengerId: string, tripId: string) {
  return database().begin(async tx => {
      // Serialize concurrent cancellations for this passenger, preserving the lifetime counter.
      const [passenger] = await tx`select status, passenger_cancellation_count as count from users where id=${passengerId} for update`;
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
      if (existing.driverId && existing.assignedAt) {
        const [proof] = await tx`select 1 where exists(select 1 from driver_offers where trip_id=${tripId} and driver_id=${existing.driverId} and accepted=true)
          or exists(select 1 from scheduled_trip_responses where trip_id=${tripId} and driver_id=${existing.driverId} and accepted=true)`;
        if (proof) {
          const [settings] = await tx`select passenger_cancellation_policy as policy from operational_settings where id=1`;
          const policy = passengerCancellationPolicySchema.parse(settings!.policy);
          const count = Number(passenger!.count) + 1;
          const days = cancellationConsequence(policy, count);
          const suspended = days === null || days > 0;
          const [account] = await tx`update users set passenger_cancellation_count=${count},
            passenger_cancellation_suspended=${suspended},
            passenger_suspended_until=case when ${days}::int>0 then now()+${days}::int*interval '1 day' else null end,
            status=case when ${suspended} then 'SUSPENDED'::account_status else status end, updated_at=now()
            where id=${passengerId} returning passenger_suspended_until as "suspendedUntil"`;
          await tx`insert into passenger_cancellations(passenger_id,trip_id,driver_id,consecutive_number,trip_status,
            suspension_days,suspension_started_at,suspension_until,status,policy_snapshot)
            values(${passengerId},${tripId},${existing.driverId},${count},${existing.status},${days},
              case when ${suspended} then now() else null end,${account!.suspendedUntil},${suspended?'SUSPENDED':'RECORDED'},${JSON.stringify(policy)}::jsonb)`;
          consequence = {count, suspensionDays:days, suspendedUntil:account!.suspendedUntil};
        }
        // A future reservation must not release a driver occupied by a different trip.
        await tx`update drivers set is_available=true where user_id=${existing.driverId} and approval_status='APROBADO'
          and exists(select 1 from users where id=${existing.driverId} and status='ACTIVE' and deleted_at is null)
          and not exists(select 1 from trips where driver_id=${existing.driverId} and status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS'))`;
      }
      await tx`insert into trip_events (trip_id, from_status, to_status, actor_id, reason_code,metadata) values (${tripId}, ${existing.status}, 'CANCELLED', ${passengerId}, 'PASSENGER_CANCELLED',${JSON.stringify({consequence})}::jsonb)`;
      return {
        driverIds: [...new Set([
          ...drivers.map(driver => String(driver.driver_id)),
          ...(existing.driverId ? [String(existing.driverId)] : [])
        ])],
        scheduled: Boolean(existing.scheduleStatus), replay:false, consequence
      };
    });
}
