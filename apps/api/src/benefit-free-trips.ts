import type {TransactionSql} from 'postgres';

// Callers hold the membership-order advisory lock. The credit row lock makes
// concurrent acceptances spend at most the trips that were actually granted.
export async function consumeFreeTripBenefit(tx:TransactionSql,tripId:string,driverId:string) {
 const [existing]=await tx`select u.id,c.redemption_id from benefit_free_trip_usages u
   join benefit_free_trip_credits c on c.id=u.credit_id where u.trip_id=${tripId} and u.driver_id=${driverId}`;
 if(existing)return {redemptionId:String(existing.redemption_id),usageId:String(existing.id)};
 const [credit]=await tx`select c.id,c.redemption_id,c.remaining_trips from benefit_free_trip_credits c
   join benefit_redemptions r on r.id=c.redemption_id
   where c.user_id=${driverId} and r.id=active_free_trip_benefit(${driverId})
     and c.remaining_trips>0 and c.expires_at>now()
   order by c.expires_at,c.id limit 1 for update of c`;
 if(!credit)return null;
 const [usage]=await tx`insert into benefit_free_trip_usages(credit_id,trip_id,driver_id)
   values(${credit.id},${tripId},${driverId}) on conflict(trip_id,driver_id) do nothing returning id`;
 if(!usage)return null;
 await tx`update benefit_free_trip_credits set remaining_trips=remaining_trips-1 where id=${credit.id}`;
 await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
   values(${driverId},'BENEFIT_FREE_TRIP_CONSUMED','BENEFIT_REDEMPTION',${credit.redemption_id},
     ${tx.json({tripId,driverId,usageId:usage.id,remainingTrips:Number(credit.remaining_trips)-1})},
     'Viaje de beneficio aplicado al aceptar')`;
 return {redemptionId:String(credit.redemption_id),usageId:String(usage.id)};
}

export async function completeFreeTripBenefit(tx:TransactionSql,tripId:string,driverId:string) {
 await tx`update benefit_free_trip_usages u set completed_at=coalesce(u.completed_at,t.completed_at)
   from trips t where u.trip_id=t.id and t.id=${tripId} and t.driver_id=${driverId}
     and u.driver_id=${driverId} and t.status='COMPLETED' and u.reversed_at is null`;
}

// Only a proven passenger cancellation before departure restores the credit.
// Driver cancellation keeps the accepted trip consumed, as with a trip package.
export async function reversePassengerCancelledFreeTrip(tx:TransactionSql,tripId:string,driverId:string,passengerId:string) {
 const [proof]=await tx`select 1 from passenger_cancellations c join trips t on t.id=c.trip_id
   where c.trip_id=${tripId} and c.driver_id=${driverId} and c.passenger_id=${passengerId}
     and t.driver_id=${driverId} and t.passenger_id=${passengerId} and t.status='CANCELLED' and t.started_at is null`;
 if(!proof)return null;
 const [usage]=await tx`select u.*,c.redemption_id from benefit_free_trip_usages u
   join benefit_free_trip_credits c on c.id=u.credit_id
   where u.trip_id=${tripId} and u.driver_id=${driverId} for update of u`;
 if(!usage||usage.reversed_at||usage.completed_at)return null;
 await tx`update benefit_free_trip_usages set reversed_at=now(),reversal_reason='PASSENGER_CANCELLED',reversed_by=${passengerId} where id=${usage.id}`;
 await tx`update benefit_free_trip_credits set remaining_trips=remaining_trips+1 where id=${usage.credit_id}`;
 await tx`insert into audit_log(actor_id,action,entity_type,entity_id,next_value,reason)
   values(${passengerId},'BENEFIT_FREE_TRIP_REVERSED','BENEFIT_REDEMPTION',${usage.redemption_id},
     ${tx.json({tripId,driverId,usageId:usage.id})},'Cancelación del pasajero antes de iniciar el viaje')`;
 return {tripId,driverId,usageId:String(usage.id),redemptionId:String(usage.redemption_id)};
}
