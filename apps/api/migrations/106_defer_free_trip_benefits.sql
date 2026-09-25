-- Free-trip gifts wait until paid coverage and courtesy days are finished.
-- Their validity starts on the first qualifying trip after that coverage.
alter table benefit_free_trip_credits
  add column activation_pending boolean not null default false,
  add column validity_days integer check (validity_days between 1 and 365);

update benefit_free_trip_credits c set validity_days=greatest(1,least(365,
  ceil(extract(epoch from (r.effective_until-r.effective_from))/86400)::integer))
from benefit_redemptions r where r.id=c.redemption_id;
alter table benefit_free_trip_credits alter column validity_days set not null;

update benefit_free_trip_credits c set activation_pending=true
from benefit_redemptions r
where r.id=c.redemption_id and r.status='ACTIVE' and c.remaining_trips=c.original_trips
  and not exists(select 1 from benefit_free_trip_usages u where u.credit_id=c.id)
  and (active_courtesy_benefit(c.user_id) is not null or exists(
    select 1 from driver_memberships m where m.driver_id=c.user_id and m.cycle_closed_at is null
      and ((m.plan_type_snapshot='TRIP_PACK' and m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE','GRACE_PERIOD')
          and m.completed_trips<m.included_trips_snapshot and (m.expires_at is null or m.expires_at>now()))
        or (m.plan_type_snapshot<>'TRIP_PACK' and
          ((m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE') and m.expires_at>now())
            or (m.status='GRACE_PERIOD' and m.grace_allows_trips_applied and m.grace_ends_at>now()))))));

update benefit_redemptions r set status='PENDING'
from benefit_free_trip_credits c where c.redemption_id=r.id and c.activation_pending;

create or replace function active_free_trip_benefit(p_user uuid) returns uuid language sql stable as $$
 select r.id from benefit_redemptions r
 join benefit_free_trip_credits c on c.redemption_id=r.id and c.user_id=r.user_id
 join users u on u.id=r.user_id join drivers d on d.user_id=u.id
 where r.user_id=p_user and r.benefit_type='FREE_TRIPS'
   and ((r.status='ACTIVE' and not c.activation_pending and r.effective_from<=now()
     and r.effective_until>now() and c.expires_at>now())
     or (r.status='PENDING' and c.activation_pending))
   and c.remaining_trips>0 and u.status='ACTIVE' and d.approval_status='APROBADO'
   and active_courtesy_benefit(p_user) is null
   and not exists(select 1 from driver_memberships m where m.driver_id=p_user and m.cycle_closed_at is null
     and ((m.plan_type_snapshot='TRIP_PACK' and m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE','GRACE_PERIOD')
          and m.completed_trips<m.included_trips_snapshot and (m.expires_at is null or m.expires_at>now()))
       or (m.plan_type_snapshot<>'TRIP_PACK' and
         ((m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE') and m.expires_at>now())
           or (m.status='GRACE_PERIOD' and m.grace_allows_trips_applied and m.grace_ends_at>now())))))
   and not exists(select 1 from driver_documents x where x.driver_id=p_user and x.status='SUSPENDED')
   and not exists(select 1 from driver_memberships m where m.driver_id=p_user and m.cycle_closed_at is null
     and m.status in ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP'))
 order by c.activation_pending,c.expires_at,r.id limit 1
$$;
