import type { TransactionSql } from 'postgres';

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function cycleAmounts(cycle: Record<string, unknown>, used: number, adjustment = Number(cycle.adjustment_amount)) {
  if (String(cycle.plan_type_snapshot ?? 'PERIODIC') === 'TRIP_PACK') {
    return { used, extra: 0, raw: 0, billable: 0, estimate: 0, adjustment: 0 };
  }
  const extra = Math.max(0, used - Number(cycle.included_trips_snapshot));
  const raw = money(extra * Number(cycle.extra_trip_fee_snapshot));
  const billable = Math.min(raw, Math.max(0, money(Number(cycle.max_renewal_amount_snapshot) - Number(cycle.base_membership_amount_snapshot))));
  const estimate = Math.max(0, Math.min(Number(cycle.max_renewal_amount_snapshot), money(Number(cycle.base_membership_amount_snapshot) + billable + adjustment)));
  return { used, extra, raw, billable, estimate, adjustment };
}

export async function markMembershipTripCompleted(tx: TransactionSql, tripId: string, driverId: string) {
  // Completion is metadata only: it never creates a usage or resurrects a reversal.
  await tx`update membership_cycle_trip_usages u set completed_at=coalesce(u.completed_at,t.completed_at)
    from trips t where u.trip_id=t.id and t.id=${tripId} and t.driver_id=${driverId}
      and u.driver_id=${driverId} and t.status='COMPLETED' and u.reversed_at is null`;
}

async function saveAmounts(tx: TransactionSql, cycle: Record<string, any>, used: number, adjustment?: number) {
  const amounts = cycleAmounts(cycle, used, adjustment);
  await tx`update driver_memberships set completed_trips=${amounts.used},extra_trips=${amounts.extra},
    raw_extra_amount=${amounts.raw},billable_extra_amount=${amounts.billable},
    estimated_next_renewal_amount=${amounts.estimate},adjustment_amount=${amounts.adjustment},
    status=case
      when plan_type_snapshot='TRIP_PACK' and cycle_closed_at is null and ${amounts.used}>=included_trips_snapshot then 'EXHAUSTED'
      when plan_type_snapshot='TRIP_PACK' and cycle_closed_at is null and status='EXHAUSTED' then 'ACTIVE'
      else status end,
    exhausted_at=case
      when plan_type_snapshot='TRIP_PACK' and cycle_closed_at is null and ${amounts.used}>=included_trips_snapshot then coalesce(exhausted_at,now())
      when plan_type_snapshot='TRIP_PACK' and cycle_closed_at is null and ${amounts.used}<included_trips_snapshot then null
      else exhausted_at end,updated_at=now()
    where id=${cycle.id}`;
  return amounts;
}

// Same lock as QR creation/payment confirmation. Always acquire before cycle/order
// locks; callers already own the trip lock, keeping acceptance/cancellation atomic.
export async function lockMembershipBilling(tx: TransactionSql, driverId: string) {
  await tx`select pg_advisory_xact_lock(hashtext(${`membership-order:${driverId}`}))`;
}

async function refreshPendingOrders(tx: TransactionSql, cycle: Record<string, any>, amounts: ReturnType<typeof cycleAmounts>) {
  // Keep proof and verification state. Finance still checks the actual amount paid.
  // Already paid orders are immutable; closed-cycle corrections become a credit.
  await tx`update membership_payment_orders set prior_usage_amount=${amounts.billable},
    adjustment_amount=${amounts.adjustment},total_amount=greatest(0,base_amount+${amounts.billable}+${amounts.adjustment}),
    metadata=jsonb_set(metadata,'{economicBreakdown}',coalesce(metadata->'economicBreakdown','{}'::jsonb) ||
      jsonb_build_object('completedTrips',${amounts.used}::int,'extraTrips',${amounts.extra}::int,
        'rawExtraAmount',${amounts.raw}::numeric,'billableExtraAmount',${amounts.billable}::numeric,
        'adjustmentAmount',${amounts.adjustment}::numeric,'totalAmount',greatest(0,base_amount+${amounts.billable}+${amounts.adjustment}))),
    updated_at=now() where membership_cycle_id=${cycle.id} and status in ('PENDING','PENDING_VERIFICATION')`;
}

export async function recordAcceptedTripMembershipUsage(tx: TransactionSql, tripId: string, driverId: string) {
  const [trip] = await tx`select assigned_at,completed_at,status from trips where id=${tripId} and driver_id=${driverId}
    and assigned_at is not null and started_at is null
    and (status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED') or (status='SEARCHING' and schedule_status='SCHEDULED_ASSIGNED'))
    and (exists(select 1 from driver_offers where trip_id=${tripId} and driver_id=${driverId} and accepted=true)
      or exists(select 1 from scheduled_trip_responses where trip_id=${tripId} and driver_id=${driverId} and accepted=true))`;
  if (!trip) return;
  await lockMembershipBilling(tx, driverId);
  const [cycle] = await tx`select * from driver_memberships where driver_id=${driverId} and cycle_closed_at is null for update`;
  if (!cycle || !['ACTIVE','EXPIRING','GRACE_PERIOD','PAYMENT_DUE'].includes(String(cycle.status))) return;
  const [settings] = await tx`select membership_usage_billing_enabled as enabled from operational_settings where id=1`;
  const isTripPack = String(cycle.plan_type_snapshot ?? 'PERIODIC') === 'TRIP_PACK';
  if (!isTripPack && !settings?.enabled) return;
  if (isTripPack && Number(cycle.completed_trips) >= Number(cycle.included_trips_snapshot)) throw new Error('MEMBERSHIP_EXHAUSTED');
  const used = Number(cycle.completed_trips) + 1;
  const amounts = cycleAmounts(cycle, used);
  const [usage] = await tx`insert into membership_cycle_trip_usages
    (membership_cycle_id,trip_id,driver_id,accepted_at,sequence_number,usage_kind,extra_trip_fee_snapshot,
      amount_before_cap,amount_after_cap,idempotency_key)
    values(${cycle.id},${tripId},${driverId},${trip.assigned_at},
      (select coalesce(max(sequence_number),0)+1 from membership_cycle_trip_usages where membership_cycle_id=${cycle.id}),
      ${isTripPack || used <= Number(cycle.included_trips_snapshot) ? 'INCLUDED' : 'EXTRA'},${cycle.extra_trip_fee_snapshot},
      ${amounts.raw},${amounts.billable},${`trip-accepted:${tripId}:${driverId}`})
    on conflict(trip_id,driver_id) do nothing returning id`;
  if (!usage) return;
  await saveAmounts(tx, cycle, used);
  await refreshPendingOrders(tx, cycle, amounts);
  await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
    values(${driverId},'MEMBERSHIP_TRIP_ACCEPTED','MEMBERSHIP_CYCLE',${cycle.id},
      ${JSON.stringify({tripId,driverId,usageId:usage.id,before:Number(cycle.completed_trips),...amounts})}::jsonb,'Viaje contabilizado al aceptar')`;
}

// Invoked only from the passenger cancellation transaction, after recording the
// real acceptance in passenger_cancellations. Never infer a debit from trip status.
export async function reversePassengerCancelledMembershipUsage(tx: TransactionSql, tripId: string, driverId: string, passengerId: string) {
  const [proof] = await tx`select 1 from passenger_cancellations c join trips t on t.id=c.trip_id
    where c.trip_id=${tripId} and c.driver_id=${driverId} and c.passenger_id=${passengerId}
      and t.driver_id=${driverId} and t.passenger_id=${passengerId} and t.status='CANCELLED' and t.started_at is null`;
  if (!proof) return null;
  await lockMembershipBilling(tx, driverId);
  const [usage] = await tx`select * from membership_cycle_trip_usages where trip_id=${tripId} and driver_id=${driverId} for update`;
  if (!usage || usage.reversed_at || usage.completed_at) return null;
  const [cycle] = await tx`select * from driver_memberships where id=${usage.membership_cycle_id} for update`;
  if (!cycle || Number(cycle.completed_trips) <= 0) throw new Error('MEMBERSHIP_USAGE_INCONSISTENT');
  await tx`update membership_cycle_trip_usages set reversed_at=now(),reversal_reason='PASSENGER_CANCELLED',reversed_by=${passengerId} where id=${usage.id}`;
  const amounts = await saveAmounts(tx, cycle, Number(cycle.completed_trips) - 1);
  let credit = 0;
  if (!cycle.cycle_closed_at) {
    await refreshPendingOrders(tx, cycle, amounts);
  } else {
    // A reservation can span a renewal. Correct its original cycle, never debit
    // the new cycle's trip count or rewrite a settled payment.
    credit = money(Math.max(0, Number(cycle.estimated_next_renewal_amount) - amounts.estimate));
    if (credit > 0) {
      const [current] = await tx`select * from driver_memberships where driver_id=${driverId} and cycle_closed_at is null for update`;
      if (!current) throw new Error('MEMBERSHIP_CREDIT_CYCLE_REQUIRED');
      await tx`insert into membership_cycle_adjustments(membership_cycle_id,adjustment_type,amount,reason,reference,created_by)
        values(${current.id},'TRIP_REVERSAL',${-credit},'Cancelación del pasajero en ciclo anterior',${String(usage.id)},${passengerId})`;
      const adjusted = await saveAmounts(tx, current, Number(current.completed_trips), money(Number(current.adjustment_amount) - credit));
      await refreshPendingOrders(tx, current, adjusted);
    }
  }
  const result = {tripId,driverId,usageId:String(usage.id),cycleId:String(cycle.id),before:Number(cycle.completed_trips),...amounts,credit};
  await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
    values(${passengerId},'MEMBERSHIP_TRIP_REVERSED','MEMBERSHIP_CYCLE',${cycle.id},${JSON.stringify(result)}::jsonb,'Viaje descontado del ciclo por cancelación del pasajero')`;
  return result;
}
