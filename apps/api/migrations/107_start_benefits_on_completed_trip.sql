-- Courtesy validity starts with the first completed trip covered by the grant.
-- Existing grants with no completed trip since redemption can safely wait too.
alter table benefit_redemptions
  add column activation_pending boolean not null default false;

update benefit_redemptions r set status='PENDING',activation_pending=true,updated_at=now()
where r.benefit_type='COURTESY_DAYS' and r.status in ('ACTIVE','PENDING')
  and r.effective_until>now()
  and not exists(select 1 from trips t where t.driver_id=r.user_id
    and t.status='COMPLETED' and t.completed_at>=r.redeemed_at);

create table benefit_courtesy_trip_usages (
  id uuid primary key default gen_random_uuid(),
  redemption_id uuid not null references benefit_redemptions(id),
  trip_id uuid not null references trips(id),
  driver_id uuid not null references users(id),
  accepted_at timestamptz not null default now(),
  completed_at timestamptz,
  unique(trip_id,driver_id)
);
create index benefit_courtesy_usage_redemption on benefit_courtesy_trip_usages(redemption_id,accepted_at);

create or replace function active_courtesy_benefit(p_user uuid) returns uuid language sql stable as $$
 select r.id from benefit_redemptions r
 join users u on u.id=r.user_id join drivers d on d.user_id=u.id
 where r.user_id=p_user and r.benefit_type='COURTESY_DAYS'
   and ((r.status in ('ACTIVE','PENDING') and not r.activation_pending and r.effective_from<=now() and r.effective_until>now())
     or (r.status='PENDING' and r.activation_pending))
   and u.status='ACTIVE' and d.approval_status='APROBADO'
   and not exists(select 1 from driver_documents x where x.driver_id=p_user and x.status='SUSPENDED')
   and (not r.activation_pending or not exists(select 1 from driver_memberships m where m.driver_id=p_user and m.cycle_closed_at is null
     and m.status in ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP'))
   and not exists(select 1 from driver_memberships m where m.driver_id=p_user and m.cycle_closed_at is null
     and ((m.plan_type_snapshot='TRIP_PACK' and m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE','GRACE_PERIOD')
       and m.completed_trips<m.included_trips_snapshot and (m.expires_at is null or m.expires_at>now()))
       or (m.plan_type_snapshot<>'TRIP_PACK' and
         ((m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE') and m.expires_at>now())
           or (m.status='GRACE_PERIOD' and m.grace_allows_trips_applied and m.grace_ends_at>now()))))))
 order by case when r.activation_pending then 1 else 0 end,r.redeemed_at,r.id limit 1
$$;

-- A later purchase may move an already running courtesy. A pending grant has
-- no clock to preserve and is selected automatically after paid coverage ends.
create or replace function defer_courtesy_after_purchase() returns trigger language plpgsql as $$
declare r benefit_redemptions%rowtype; anchor timestamptz; remaining interval;
begin
 if new.cycle_closed_at is not null or new.status not in ('ACTIVE','EXPIRING') or new.expires_at<=now() then return new; end if;
 anchor:=new.expires_at;
 for r in select * from benefit_redemptions where user_id=new.driver_id and benefit_type='COURTESY_DAYS'
   and not activation_pending and status in ('ACTIVE','PENDING') and effective_until>now() order by effective_from,id for update loop
   if r.effective_from<anchor then
     remaining:=r.effective_until-greatest(r.effective_from,now());
     update benefit_redemptions set effective_from=anchor,effective_until=anchor+remaining,expires_at=anchor+remaining,
       updated_at=now() where id=r.id;
     insert into audit_log(actor_id,action,entity_type,entity_id,previous_value,next_value,reason)
       values(new.driver_id,'BENEFIT_RESCHEDULED','BENEFIT_REDEMPTION',r.id,
       jsonb_build_object('from',r.effective_from,'until',r.effective_until),
       jsonb_build_object('from',anchor,'until',anchor+remaining),'Paid coverage extended; remaining courtesy preserved');
     anchor:=anchor+remaining;
   else anchor:=r.effective_until; end if;
 end loop;
 return new;
end $$;

-- Unused, unexpired free-trip grants also stop counting until their first
-- completed benefit trip. Grants already used retain their original terms.
update benefit_free_trip_credits c set activation_pending=true
from benefit_redemptions r
where r.id=c.redemption_id and r.status='ACTIVE' and r.effective_until>now()
  and c.remaining_trips=c.original_trips
  and not exists(select 1 from benefit_free_trip_usages u where u.credit_id=c.id);
update benefit_redemptions r set status='PENDING',activation_pending=true
from benefit_free_trip_credits c
where c.redemption_id=r.id and c.activation_pending and r.status in ('ACTIVE','PENDING');
