alter table operational_settings alter column passenger_cancellation_policy set default
  '{"enabled":true,"cycleDurationDays":30,"steps":[{"fromCount":1,"suspensionDays":0},{"fromCount":3,"suspensionDays":2},{"fromCount":4,"suspensionDays":5},{"fromCount":5,"suspensionDays":7},{"fromCount":6,"suspensionDays":null}]}';
update operational_settings set passenger_cancellation_policy=
  '{"cycleDurationDays":30}'::jsonb || passenger_cancellation_policy;

create table passenger_cancellation_cycles (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references users(id),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  duration_days integer not null check(duration_days>0),
  source text not null default 'OPERATIONAL' check(source in ('OPERATIONAL','LEGACY')),
  created_at timestamptz not null default now(),
  unique(id,passenger_id),
  check(ends_at=starts_at+duration_days*interval '24 hours')
);
create index passenger_cancellation_cycles_history on passenger_cancellation_cycles(passenger_id,starts_at desc);
alter table users add column passenger_cancellation_total bigint not null default 0 check(passenger_cancellation_total>=0);
alter table users add column passenger_cancellation_cycle_id uuid;
alter table users add constraint passenger_current_cancellation_cycle_fk
  foreign key(passenger_cancellation_cycle_id,id) references passenger_cancellation_cycles(id,passenger_id);
alter table passenger_cancellations add column cycle_id uuid;
alter table passenger_cancellations add column reason_code text not null default 'PASSENGER_CANCELLED';
alter table passenger_cancellations add column originated_by uuid references users(id);

-- Preserve every previous number, timestamp and penalty. The former lifetime
-- history is explicitly a legacy cycle, not retroactively re-penalized/rebilled.
insert into passenger_cancellation_cycles(passenger_id,starts_at,ends_at,duration_days,source)
select passenger_id,min(occurred_at),min(occurred_at)+
  greatest(30,floor(extract(epoch from (max(occurred_at)-min(occurred_at)))/86400)::int+1)*interval '24 hours',
  greatest(30,floor(extract(epoch from (max(occurred_at)-min(occurred_at)))/86400)::int+1),'LEGACY'
from passenger_cancellations group by passenger_id;
update passenger_cancellations c set cycle_id=cy.id,originated_by=c.passenger_id
from passenger_cancellation_cycles cy where cy.passenger_id=c.passenger_id;
update users u set passenger_cancellation_total=(select count(*) from passenger_cancellations c where c.passenger_id=u.id),
  passenger_cancellation_cycle_id=cy.id,
  passenger_cancellation_count=case when cy.ends_at>now() then u.passenger_cancellation_count else 0 end
from passenger_cancellation_cycles cy where cy.passenger_id=u.id;

alter table passenger_cancellations alter column cycle_id set not null;
alter table passenger_cancellations alter column originated_by set not null;
alter table passenger_cancellations add constraint cancellation_cycle_passenger_fk
  foreign key(cycle_id,passenger_id) references passenger_cancellation_cycles(id,passenger_id);
alter table passenger_cancellations drop constraint passenger_cancellations_passenger_id_consecutive_number_key;
alter table passenger_cancellations add constraint cancellation_cycle_number_key unique(cycle_id,consecutive_number);
create index passenger_cancellations_cycle_idx on passenger_cancellations(cycle_id,occurred_at desc,id);
