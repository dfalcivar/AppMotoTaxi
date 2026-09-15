import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { database } from './database.js';
import { requireMobileUser } from './memberships.js';

const maximumRangeMilliseconds = 366 * 24 * 60 * 60 * 1000;

export const earningsRangeSchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true })
}).transform(value => ({ from: new Date(value.from), to: new Date(value.to) }))
  .refine(value => value.to.getTime() > value.from.getTime(), { message: 'INVALID_DATE_RANGE' })
  .refine(value => value.to.getTime() - value.from.getTime() <= maximumRangeMilliseconds, { message: 'DATE_RANGE_TOO_LARGE' });

const movementsQuerySchema = z.object({
  from: z.string().datetime({ offset: true }),
  to: z.string().datetime({ offset: true }),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20)
});

function money(value: unknown): string {
  const numeric = Number(value ?? 0);
  return (Number.isFinite(numeric) ? numeric : 0).toFixed(2);
}

export function earningsTotals(completedTrips: number, grossValue: unknown, commissionValue: unknown) {
  const gross = Number(grossValue ?? 0);
  const commission = Number(commissionValue ?? 0);
  return {
    grossTripIncome: money(gross),
    costaGoCommission: money(commission),
    netEarnings: money(gross - commission),
    averagePerTrip: money(completedTrips ? gross / completedTrips : 0)
  };
}

function earningsError(reply: FastifyReply) {
  return reply.code(400).send({ error: 'INVALID_EARNINGS_RANGE' });
}

async function currentBillingMode(driverId: string) {
  const [row] = await database()`
    select case
      when m.plan_type_snapshot='TRIP_PACK' then 'TRIP_PACKAGE'
      when m.id is not null then 'PERIOD_PLAN'
      else 'PAY_PER_USE'
    end as mode
    from (select 1) seed
    left join lateral (
      select id,plan_type_snapshot from driver_memberships
      where driver_id=${driverId} and cycle_closed_at is null
        and status in ('ACTIVE','EXPIRING','GRACE_PERIOD','PAYMENT_DUE')
      order by created_at desc limit 1
    ) m on true
  `;
  return String(row?.mode ?? 'PAY_PER_USE');
}

const movementColumns = (sql: ReturnType<typeof database>, driverId: string, from: Date, to: Date) => sql`
  select t.id::text as "tripId",
    'CG-'||upper(substring(replace(t.id::text,'-','') from 1 for 8)) as "displayCode",
    t.completed_at as "completedAt",
    (coalesce(t.final_total_cents,t.quoted_total_cents)::numeric/100)::text as "grossTripIncome",
    case when coalesce(a.snapshot->>'appliedCommission','') ~ '^\\d+(\\.\\d+)?$'
      then (a.snapshot->>'appliedCommission')::numeric else 0 end::text as "costaGoCommission",
    ((coalesce(t.final_total_cents,t.quoted_total_cents)::numeric/100)-
      case when coalesce(a.snapshot->>'appliedCommission','') ~ '^\\d+(\\.\\d+)?$'
        then (a.snapshot->>'appliedCommission')::numeric else 0 end)::text as "netEarnings",
    coalesce(a.snapshot->>'billingMode','UNKNOWN') as "billingMode"
  from trips t
  left join trip_commercial_assignments a on a.trip_id=t.id and a.driver_id=t.driver_id
  where t.driver_id=${driverId} and t.status='COMPLETED'
    and t.completed_at>=${from} and t.completed_at<${to}
`;

export async function registerDriverEarningsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/v1/driver/earnings/summary', async (request, reply) => {
    const user = await requireMobileUser(request, reply, 'DRIVER'); if (!user) return;
    const parsed = earningsRangeSchema.safeParse(request.query);
    if (!parsed.success) return earningsError(reply);
    const { from, to } = parsed.data;
    reply.header('Cache-Control', 'private, no-store');
    const sql = database();
    const [summaryRows, walletRows, recentMovements, billingMode] = await Promise.all([
      sql`
        select count(*)::int as "completedTrips",
          coalesce(sum(coalesce(t.final_total_cents,t.quoted_total_cents)::numeric/100),0)::text as gross,
          coalesce(sum(case when coalesce(a.snapshot->>'appliedCommission','') ~ '^\\d+(\\.\\d+)?$'
            then (a.snapshot->>'appliedCommission')::numeric else 0 end),0)::text as commission,
          count(*) filter(where case when coalesce(a.snapshot->>'appliedCommission','') ~ '^\\d+(\\.\\d+)?$'
            then (a.snapshot->>'appliedCommission')::numeric else 0 end > 0)::int as "discountsApplied"
        from trips t
        left join trip_commercial_assignments a on a.trip_id=t.id and a.driver_id=t.driver_id
        where t.driver_id=${user.id!} and t.status='COMPLETED'
          and t.completed_at>=${from} and t.completed_at<${to}
      `,
      sql`select coalesce(total-reserved,0)::text as available from driver_wallets where driver_id=${user.id!}`,
      sql`${movementColumns(sql,user.id!,from,to)} order by t.completed_at desc,t.id desc limit 5`,
      currentBillingMode(user.id!)
    ]);
    const summary = summaryRows[0];
    const wallet = walletRows[0];
    const completedTrips = Number(summary?.completedTrips ?? 0);
    const gross = Number(summary?.gross ?? 0);
    const commission = Number(summary?.commission ?? 0);
    const totals = earningsTotals(completedTrips, gross, commission);
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      completedTrips,
      ...totals,
      prepaidBalance: money(wallet?.available),
      billingMode,
      discountsApplied: Number(summary?.discountsApplied ?? 0),
      recentMovements: recentMovements.map(item => ({
        ...item,
        grossTripIncome: money(item.grossTripIncome),
        costaGoCommission: money(item.costaGoCommission),
        netEarnings: money(item.netEarnings)
      }))
    };
  });

  app.get('/v1/driver/earnings/movements', async (request, reply) => {
    const user = await requireMobileUser(request, reply, 'DRIVER'); if (!user) return;
    const query = movementsQuerySchema.safeParse(request.query);
    if (!query.success) return earningsError(reply);
    const range = earningsRangeSchema.safeParse({ from: query.data.from, to: query.data.to });
    if (!range.success) return earningsError(reply);
    const { from, to } = range.data;
    const { page, pageSize } = query.data;
    const sql = database();
    reply.header('Cache-Control', 'private, no-store');
    const [items, count] = await Promise.all([
      sql`${movementColumns(sql,user.id!,from,to)} order by t.completed_at desc,t.id desc limit ${pageSize} offset ${(page-1)*pageSize}`,
      sql`select count(*)::int as total from trips where driver_id=${user.id!} and status='COMPLETED'
        and completed_at>=${from} and completed_at<${to}`
    ]);
    const total = Number(count[0]?.total ?? 0);
    return {
      period: { from: from.toISOString(), to: to.toISOString() }, page, pageSize, total,
      hasMore: page * pageSize < total,
      items: items.map(item => ({
        ...item,
        grossTripIncome: money(item.grossTripIncome),
        costaGoCommission: money(item.costaGoCommission),
        netEarnings: money(item.netEarnings)
      }))
    };
  });
}
