import type {TransactionSql} from 'postgres';

export async function recordCourtesyTripAcceptance(tx:TransactionSql,tripId:string,driverId:string,redemptionId:string) {
  await tx`insert into benefit_courtesy_trip_usages(redemption_id,trip_id,driver_id)
    values(${redemptionId},${tripId},${driverId}) on conflict(trip_id,driver_id) do nothing`;
}

export async function completeCourtesyBenefit(tx:TransactionSql,tripId:string,driverId:string) {
  const [usage]=await tx`update benefit_courtesy_trip_usages u
    set completed_at=coalesce(u.completed_at,t.completed_at)
    from trips t where u.trip_id=t.id and t.id=${tripId} and t.driver_id=${driverId}
      and u.driver_id=${driverId} and t.status='COMPLETED'
    returning u.redemption_id,u.completed_at`;
  if(!usage)return;
  const [grant]=await tx`select benefit_value,activation_pending from benefit_redemptions
    where id=${usage.redemption_id} for update`;
  if(!grant?.activation_pending)return;
  const days=Number(grant.benefit_value);
  await tx`update benefit_redemptions set status='ACTIVE',activation_pending=false,
    effective_from=${usage.completed_at},effective_until=${usage.completed_at}::timestamptz+${days}*interval '1 day',
    expires_at=${usage.completed_at}::timestamptz+${days}*interval '1 day',updated_at=now()
    where id=${usage.redemption_id} and status='PENDING' and activation_pending`;
}
