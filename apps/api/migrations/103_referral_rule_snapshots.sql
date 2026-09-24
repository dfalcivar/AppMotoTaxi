-- Preserve the terms accepted by each referral while allowing future programme revisions.
alter table benefit_reward_programs add column must_be_approved boolean not null default false;
alter table benefit_reward_programs add column must_be_active boolean not null default true;
update benefit_reward_programs set must_be_approved=(audience='DRIVER' and required_event<>'REGISTRATION_COMPLETED');
alter table benefit_reward_programs drop constraint referral_qualifying_event;
alter table benefit_reward_programs add constraint referral_qualifying_event check(required_event in ('REGISTRATION_COMPLETED','PASSENGER_FIRST_COMPLETED_TRIP','DRIVER_APPROVED','DRIVER_FIRST_COMPLETED_TRIP','DRIVER_APPROVED_AND_FIRST_COMPLETED_TRIP','X_COMPLETED_TRIPS','FIRST_COMPLETED_TRIP','DRIVER_APPROVED_AND_X_COMPLETED_TRIPS','COMPLETED_TRIP_TARGET'));
alter table benefit_referrals add column rules_snapshot jsonb;
update benefit_referrals r set rules_snapshot=to_jsonb(p)||jsonb_build_object('zone_ids',coalesce((select jsonb_agg(service_area_id) from referral_program_areas where program_id=p.id),'[]'::jsonb)) from benefit_reward_programs p where p.id=r.program_id;
alter table benefit_referrals alter column rules_snapshot set not null;
alter table benefit_referrals add constraint referral_rules_object check(jsonb_typeof(rules_snapshot)='object' and rules_snapshot ? 'required_event' and rules_snapshot ? 'required_trips');
create function capture_referral_rules() returns trigger language plpgsql as $$
begin
 select to_jsonb(p)||jsonb_build_object('zone_ids',coalesce((select jsonb_agg(service_area_id) from referral_program_areas where program_id=p.id),'[]'::jsonb)) into new.rules_snapshot from benefit_reward_programs p where id=new.program_id for share;
 perform id from benefit_definitions where code in (new.rules_snapshot->>'referrer_benefit_code',new.rules_snapshot->>'referred_benefit_code') order by code for share;
 return new;
end $$;
create trigger referral_capture_rules before insert on benefit_referrals for each row execute function capture_referral_rules();
create or replace function protect_referral_identity() returns trigger language plpgsql as $$
begin
 if new.program_id<>old.program_id or new.referrer_user_id<>old.referrer_user_id or new.referred_user_id<>old.referred_user_id or new.referral_code is distinct from old.referral_code or new.rules_snapshot is distinct from old.rules_snapshot or new.audience is distinct from old.audience or new.zone_id is distinct from old.zone_id or new.created_at<>old.created_at then raise exception 'REFERRAL_IMMUTABLE';end if;
 return new;
end $$;
create function protect_referral_code() returns trigger language plpgsql as $$
begin
 if TG_OP='DELETE' then raise exception 'REFERRAL_CODE_IMMUTABLE';end if;
 if new.user_id<>old.user_id or new.code<>old.code then raise exception 'REFERRAL_CODE_IMMUTABLE';end if;
 return new;
end $$;
create trigger referral_code_immutable before update or delete on referral_codes for each row execute function protect_referral_code();
-- Codes identify stable economic definitions once promised to any invited account.
-- To change reward economics, create another benefit and select it for future referrals.
create function protect_referral_benefit_terms() returns trigger language plpgsql as $$
declare benefit_code text;
begin
 if TG_TABLE_NAME='benefit_definitions' then
  if (to_jsonb(new)-array['name','description','status','version','updated_at'])=(to_jsonb(old)-array['name','description','status','version','updated_at']) then return new;end if;
  benefit_code:=old.code;
 else
  select code into benefit_code from benefit_definitions where id=coalesce(new.benefit_id,old.benefit_id) for update;
 end if;
 if exists(select 1 from benefit_referrals where rules_snapshot->>'referrer_benefit_code'=benefit_code or rules_snapshot->>'referred_benefit_code'=benefit_code) then raise exception 'BENEFIT_REFERRAL_TERMS_LOCKED';end if;
 if TG_OP='DELETE' then return old;end if;
 return new;
end $$;
create trigger benefit_referral_terms before update on benefit_definitions for each row execute function protect_referral_benefit_terms();
create trigger benefit_referral_zones before insert or update or delete on benefit_areas for each row execute function protect_referral_benefit_terms();
