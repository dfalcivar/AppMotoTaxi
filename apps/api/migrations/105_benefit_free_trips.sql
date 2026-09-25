-- Trip credits granted by a benefit are independent of purchased trip packages.
create table benefit_free_trip_credits (
 id uuid primary key default gen_random_uuid(),
 redemption_id uuid not null unique references benefit_redemptions(id),
 user_id uuid not null references users(id),
 original_trips integer not null check(original_trips>0),
 remaining_trips integer not null check(remaining_trips>=0 and remaining_trips<=original_trips),
 expires_at timestamptz not null,
 created_at timestamptz not null default now()
);
create index benefit_free_trip_available on benefit_free_trip_credits(user_id,expires_at)
 where remaining_trips>0;

create table benefit_free_trip_usages (
 id uuid primary key default gen_random_uuid(),
 credit_id uuid not null references benefit_free_trip_credits(id),
 trip_id uuid not null references trips(id),
 driver_id uuid not null references users(id),
 accepted_at timestamptz not null default now(),
 completed_at timestamptz,
 reversed_at timestamptz,
 reversal_reason text,
 reversed_by uuid references users(id),
 unique(trip_id,driver_id)
);
create index benefit_free_trip_usage_credit on benefit_free_trip_usages(credit_id,accepted_at);

create function active_free_trip_benefit(p_user uuid) returns uuid language sql stable as $$
 select r.id from benefit_redemptions r
 join benefit_free_trip_credits c on c.redemption_id=r.id and c.user_id=r.user_id
 join users u on u.id=r.user_id join drivers d on d.user_id=u.id
 where r.user_id=p_user and r.benefit_type='FREE_TRIPS' and r.status='ACTIVE'
   and r.effective_from<=now() and r.effective_until>now()
   and c.remaining_trips>0 and c.expires_at>now()
   and u.status='ACTIVE' and d.approval_status='APROBADO'
   and not exists(select 1 from driver_documents x where x.driver_id=p_user and x.status='SUSPENDED')
   and not exists(select 1 from driver_memberships m where m.driver_id=p_user and m.cycle_closed_at is null
     and m.status in ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP'))
 order by c.expires_at,r.id limit 1
$$;

create or replace function commercial_driver_can_accept(p_driver uuid,p_trip uuid,p_round integer)
 returns boolean language plpgsql stable as $$
declare e jsonb;m driver_memberships%rowtype;w driver_wallets%rowtype;
begin
 e:=trip_offer_economics(p_trip,p_round);
 if e is null then return true; end if;
 if exists(select 1 from arrival_search_exclusions x join trips t on t.arrival_search_session_id=x.session_id
   where t.id=p_trip and x.driver_id=p_driver) then return false; end if;
 if active_courtesy_benefit(p_driver) is not null or active_free_trip_benefit(p_driver) is not null then return true; end if;
 select * into m from driver_memberships where driver_id=p_driver and cycle_closed_at is null;
 if found then
   if m.status in ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP') then return false; end if;
   if m.status in ('ACTIVE','EXPIRING','PAYMENT_DUE') or (m.status='GRACE_PERIOD' and m.grace_allows_trips_applied) then
     if (m.suspension_at is null or m.suspension_at>now()) and
        (m.plan_type_snapshot<>'TRIP_PACK' or m.completed_trips<m.included_trips_snapshot) then return true; end if;
   end if;
 end if;
 select * into w from driver_wallets where driver_id=p_driver and enabled=true;
 return found and w.total-w.reserved>=(e->>'theoreticalCommission')::numeric;
end $$;
