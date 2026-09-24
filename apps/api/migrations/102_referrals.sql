-- Complete the reserved referral infrastructure without granting historical rewards.
alter table benefit_reward_programs drop constraint benefit_reward_programs_enabled_check;
alter table benefit_reward_programs drop constraint benefit_reward_programs_required_event_check;
alter table benefit_reward_programs add column code text unique;
alter table benefit_reward_programs add column description text not null default '';
alter table benefit_reward_programs add column audience text not null default 'DRIVER' check(audience in ('DRIVER','PASSENGER','BOTH'));
alter table benefit_reward_programs add column starts_at timestamptz;
alter table benefit_reward_programs add column ends_at timestamptz;
alter table benefit_reward_programs add column status text not null default 'DRAFT' check(status in ('DRAFT','ACTIVE','PAUSED','FINISHED'));
alter table benefit_reward_programs add column max_rewards_per_referrer integer check(max_rewards_per_referrer>0);
alter table benefit_reward_programs add column share_message text not null default 'Te invito a usar Costa-Go. Regístrate y utiliza mi código: {code}. {url}';
alter table benefit_reward_programs add column version integer not null default 1;
alter table benefit_reward_programs add column created_at timestamptz not null default now();
alter table benefit_reward_programs add column updated_at timestamptz not null default now();
alter table benefit_reward_programs add constraint referral_program_dates check(not enabled or (code is not null and starts_at is not null and ends_at>starts_at and status='ACTIVE'));
alter table benefit_reward_programs add constraint referral_qualifying_event check(required_event in ('REGISTRATION_COMPLETED','PASSENGER_FIRST_COMPLETED_TRIP','DRIVER_APPROVED','DRIVER_FIRST_COMPLETED_TRIP','DRIVER_APPROVED_AND_FIRST_COMPLETED_TRIP','X_COMPLETED_TRIPS','FIRST_COMPLETED_TRIP','COMPLETED_TRIP_TARGET'));
create table referral_program_areas(program_id uuid references benefit_reward_programs(id),service_area_id uuid references service_areas(id),primary key(program_id,service_area_id));
create table referral_codes(user_id uuid primary key references users(id),code text not null unique check(code ~ '^CG-[A-F0-9]{16}$'),created_at timestamptz not null default now());
alter table benefit_referrals add column referral_code text references referral_codes(code);
alter table benefit_referrals add column audience text check(audience in ('DRIVER','PASSENGER'));
alter table benefit_referrals add column zone_id uuid references service_areas(id);
alter table benefit_referrals add column source text not null default 'MANUAL' check(source in ('MANUAL','LINK'));
alter table benefit_referrals add column qualified_at timestamptz;
alter table benefit_referrals add column rewarded_at timestamptz;
alter table benefit_referrals add column qualifying_reference_id text;
alter table benefit_referrals add column next_attempt_at timestamptz not null default now();
alter table benefit_referrals add column last_error text;
alter table benefit_referrals add column updated_at timestamptz not null default now();
create index referral_pending_processing on benefit_referrals(next_attempt_at) where status in ('PENDING','QUALIFIED');
create unique index benefit_referral_grant_once on benefit_redemptions(source,reference_id) where source='REFERRAL';
alter table users add column referral_rewards_excluded boolean not null default false;
alter table trips add column referral_test_trip boolean not null default false;
-- Respect actual account columns; no IP/device heuristics.
create or replace function reject_self_referral() returns trigger language plpgsql as $$
declare a jsonb;b jsonb;ea text;eb text;pa text;pb text;
begin
 select to_jsonb(u) into a from users u where id=new.referrer_user_id;
 select to_jsonb(u) into b from users u where id=new.referred_user_id;
 ea:=lower(trim(coalesce(a->>'email','')));eb:=lower(trim(coalesce(b->>'email','')));
 pa:=regexp_replace(coalesce(a->>'phone_e164',a->>'phone',''),'[^0-9]','','g');pb:=regexp_replace(coalesce(b->>'phone_e164',b->>'phone',''),'[^0-9]','','g');
 if new.referrer_user_id=new.referred_user_id or (ea<>'' and ea=eb) or (pa<>'' and pa=pb) then raise exception 'SELF_REFERRAL_NOT_ALLOWED';end if;
 if (a->>'created_at')::timestamptz >= (b->>'created_at')::timestamptz then raise exception 'REFERRER_MUST_PRECEDE_USER';end if;
 return new;
end $$;
create function protect_referral_identity() returns trigger language plpgsql as $$
begin
 if new.program_id<>old.program_id or new.referrer_user_id<>old.referrer_user_id or new.referred_user_id<>old.referred_user_id or new.referral_code is distinct from old.referral_code then raise exception 'REFERRAL_IMMUTABLE';end if;
 return new;
end $$;
create trigger referral_immutable before update on benefit_referrals for each row execute function protect_referral_identity();

-- Existing Google Play review accounts are test accounts for rewards as well.
create function referral_test_account(p_user uuid) returns boolean language sql stable as $$
 select coalesce((select referral_rewards_excluded from users where id=p_user),false)
 or exists(select 1 from user_service_area_access where user_id=p_user and review_mode)
$$;
create function stamp_referral_test_trip() returns trigger language plpgsql as $$
begin
 new.referral_test_trip:=new.referral_test_trip or referral_test_account(new.passenger_id) or referral_test_account(new.driver_id);
 return new;
end $$;
create trigger referral_test_trip before insert or update of driver_id,passenger_id on trips for each row execute function stamp_referral_test_trip();
