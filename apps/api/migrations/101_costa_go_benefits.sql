-- Independent benefits. No existing memberships, payments or balances are modified.
create table benefit_definitions (
 id uuid primary key default gen_random_uuid(), code text not null unique check(code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
 name text not null, description text not null default '', benefit_type text not null,
 value numeric(12,2) not null check(value>0), currency text,
 audience text not null check(audience in ('DRIVER','PASSENGER','BOTH')),
 one_time boolean not null default true, requires_activation boolean not null default true,
 starts_at timestamptz not null, ends_at timestamptz not null check(ends_at>starts_at),
 expiration_days integer check(expiration_days>0), max_global integer check(max_global>0), max_per_user integer check(max_per_user>0),
 status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
 config jsonb not null default '{}' check(jsonb_typeof(config)='object'), version integer not null default 1,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(not one_time or coalesce(max_per_user=1,false))
);
create table benefit_areas (
 benefit_id uuid references benefit_definitions(id), service_area_id uuid references service_areas(id), primary key(benefit_id,service_area_id)
);
create table benefit_redemptions (
 id uuid primary key default gen_random_uuid(), benefit_id uuid not null references benefit_definitions(id),
 benefit_code text not null references benefit_definitions(code), user_id uuid not null references users(id),
 campaign_id uuid references costa_go_campaigns(id), audience text not null, zone_id uuid references service_areas(id),
 benefit_type text not null, benefit_value numeric(12,2) not null, one_time boolean not null,
 status text not null default 'ACTIVE' check(status in ('PENDING','ACTIVE','USED','EXPIRED','CANCELLED','FAILED')),
 source text not null, effective_from timestamptz not null, effective_until timestamptz not null,
 expires_at timestamptz, reference_id text, metadata jsonb not null default '{}',
 redeemed_at timestamptz not null default now(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check(effective_until>effective_from)
);
create unique index benefit_once_per_user on benefit_redemptions(user_id,benefit_code) where one_time;
create unique index benefit_once_per_campaign on benefit_redemptions(user_id,benefit_code,campaign_id) where campaign_id is not null;
create index benefit_user_coverage on benefit_redemptions(user_id,effective_from,effective_until) where status in ('PENDING','ACTIVE');
create index benefit_redemption_definition on benefit_redemptions(benefit_id,redeemed_at);
create function protect_benefit_identity() returns trigger language plpgsql as $$
begin
 if new.code<>old.code or new.one_time<>old.one_time or new.benefit_type<>old.benefit_type then
   raise exception 'BENEFIT_IDENTITY_IMMUTABLE';
 end if;
 return new;
end $$;
create trigger benefit_identity before update on benefit_definitions for each row execute function protect_benefit_identity();
create function stamp_benefit_redemption() returns trigger language plpgsql as $$
declare d benefit_definitions%rowtype;
begin
 select * into strict d from benefit_definitions where id=new.benefit_id for update;
 new.benefit_code:=d.code; new.one_time:=d.one_time; new.benefit_type:=d.benefit_type;
 return new;
end $$;
create trigger benefit_redemption_identity before insert on benefit_redemptions for each row execute function stamp_benefit_redemption();
-- Returns actual coverage, independently of an expired paid membership. Manual suspension still blocks access.
create function active_courtesy_benefit(p_user uuid) returns uuid language sql stable as $$
 select r.id from benefit_redemptions r join users u on u.id=r.user_id join drivers d on d.user_id=u.id
 where r.user_id=p_user and r.benefit_type='COURTESY_DAYS' and r.status in ('ACTIVE','PENDING')
 and r.effective_from<=now() and r.effective_until>now() and u.status='ACTIVE' and d.approval_status='APROBADO'
 and not exists(select 1 from driver_documents x where x.driver_id=p_user and x.status='SUSPENDED')
 and not exists(select 1 from driver_memberships m where m.driver_id=p_user and m.cycle_closed_at is null and m.status='SUSPENDED')
 order by r.effective_until,r.id limit 1
$$;
-- Preserve remaining courtesy when a later purchase extends paid coverage. No paid-cycle fields are changed.
create function defer_courtesy_after_purchase() returns trigger language plpgsql as $$
declare r benefit_redemptions%rowtype; anchor timestamptz; remaining interval;
begin
 if new.cycle_closed_at is not null or new.status not in ('ACTIVE','EXPIRING') or new.expires_at<=now() then return new; end if;
 anchor:=new.expires_at;
 for r in select * from benefit_redemptions where user_id=new.driver_id and benefit_type='COURTESY_DAYS'
   and status in ('ACTIVE','PENDING') and effective_until>now() order by effective_from,id for update loop
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
create trigger preserve_courtesy_after_purchase after insert or update of expires_at on driver_memberships
 for each row execute function defer_courtesy_after_purchase();

CREATE OR REPLACE FUNCTION commercial_driver_can_accept(p_driver uuid,p_trip uuid,p_round integer) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
DECLARE e jsonb;m driver_memberships%ROWTYPE;w driver_wallets%ROWTYPE;
BEGIN
  e:=trip_offer_economics(p_trip,p_round);
  IF e IS NULL THEN RETURN true; END IF;
  IF EXISTS(SELECT 1 FROM arrival_search_exclusions x JOIN trips t ON t.arrival_search_session_id=x.session_id
    WHERE t.id=p_trip AND x.driver_id=p_driver) THEN RETURN false; END IF;
  IF active_courtesy_benefit(p_driver) IS NOT NULL THEN RETURN true; END IF;
  SELECT * INTO m FROM driver_memberships WHERE driver_id=p_driver AND cycle_closed_at IS NULL;
  IF FOUND THEN
    IF m.status IN ('SUSPENDED','SUSPENDED_NON_PAYMENT','SUSPENSION_PENDING_ACTIVE_TRIP') THEN RETURN false; END IF;
    IF m.status IN ('ACTIVE','EXPIRING','PAYMENT_DUE') OR (m.status='GRACE_PERIOD' AND m.grace_allows_trips_applied) THEN
      IF (m.suspension_at IS NULL OR m.suspension_at>now()) AND (m.plan_type_snapshot<>'TRIP_PACK' OR m.completed_trips<m.included_trips_snapshot) THEN RETURN true; END IF;
    END IF;
  END IF;
  SELECT * INTO w FROM driver_wallets WHERE driver_id=p_driver AND enabled=true;
  RETURN FOUND AND w.total-w.reserved>=(e->>'theoreticalCommission')::numeric;
END $$;


-- Reserved infrastructure; no public writer or active handler for these types in this phase.
-- Promotional money has its own ledger and NEVER increments driver_wallets.total.
create table benefit_promotional_credits (
 id uuid primary key default gen_random_uuid(), redemption_id uuid not null unique references benefit_redemptions(id),
 user_id uuid not null references users(id), currency text not null check(currency='USD'),
 original_amount numeric(12,2) not null check(original_amount>0), remaining numeric(12,2) not null,
 reserved numeric(12,2) not null default 0, expires_at timestamptz, created_at timestamptz not null default now(),
 check(remaining>=0 and remaining<=original_amount and reserved>=0 and reserved<=remaining)
);
create table benefit_promotional_movements (
 id uuid primary key default gen_random_uuid(),credit_id uuid not null references benefit_promotional_credits(id),
 kind text not null check(kind in ('GRANT','RESERVE','RELEASE','CONSUME','EXPIRE')),
 amount numeric(12,2) not null check(amount>0),reference_id text,idempotency_key text not null unique,
 metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create table benefit_reward_programs (
 id uuid primary key default gen_random_uuid(),name text not null,
 required_event text not null check(required_event in ('DRIVER_APPROVED','FIRST_COMPLETED_TRIP','COMPLETED_TRIP_TARGET')),
 required_trips integer check(required_trips>0),period_days integer check(period_days>0),
 referrer_benefit_code text references benefit_definitions(code),referred_benefit_code text references benefit_definitions(code),
 reward_benefit_code text references benefit_definitions(code),max_redemptions integer check(max_redemptions>0),
 enabled boolean not null default false check(not enabled), config jsonb not null default '{}'
);
create table benefit_referrals (
 id uuid primary key default gen_random_uuid(),program_id uuid not null references benefit_reward_programs(id),
 referrer_user_id uuid not null references users(id),referred_user_id uuid not null unique references users(id),
 status text not null default 'PENDING' check(status in ('PENDING','QUALIFIED','REWARDED','REJECTED')),
 created_at timestamptz not null default now(),check(referrer_user_id<>referred_user_id)
);
create function reject_self_referral() returns trigger language plpgsql as $$
declare inviter jsonb;invitee jsonb;email_a text;email_b text;phone_a text;phone_b text;
begin
 select to_jsonb(u) into inviter from users u where id=new.referrer_user_id;
 select to_jsonb(u) into invitee from users u where id=new.referred_user_id;
 email_a:=lower(trim(coalesce(inviter->>'email','')));email_b:=lower(trim(coalesce(invitee->>'email','')));
 phone_a:=regexp_replace(coalesce(inviter->>'phone',''),'[^0-9]','','g');phone_b:=regexp_replace(coalesce(invitee->>'phone',''),'[^0-9]','','g');
 if new.referrer_user_id=new.referred_user_id or (email_a<>'' and email_a=email_b) or (phone_a<>'' and phone_a=phone_b) then
 raise exception 'SELF_REFERRAL_NOT_ALLOWED'; end if;
 return new;
end $$;
create trigger benefit_referral_identity before insert or update of referrer_user_id,referred_user_id on benefit_referrals
 for each row execute function reject_self_referral();
create table benefit_reward_events (
 id uuid primary key default gen_random_uuid(),source_event_id text not null unique,
 user_id uuid not null references users(id),event_type text not null,
 occurred_at timestamptz not null,verified_at timestamptz,processed_at timestamptz,metadata jsonb not null default '{}'
);
create table benefit_reward_progress (
 program_id uuid not null references benefit_reward_programs(id),user_id uuid not null references users(id),
 period_key text not null,current_count integer not null default 0 check(current_count>=0),target integer not null check(target>0),
 updated_at timestamptz not null default now(),primary key(program_id,user_id,period_key)
);
