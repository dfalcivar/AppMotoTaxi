alter table operational_settings add column passenger_cancellation_policy jsonb not null
  default '{"enabled":true,"steps":[{"fromCount":1,"suspensionDays":0},{"fromCount":3,"suspensionDays":2},{"fromCount":4,"suspensionDays":5},{"fromCount":5,"suspensionDays":7},{"fromCount":6,"suspensionDays":null}]}';

alter table users add column passenger_cancellation_count integer not null default 0 check (passenger_cancellation_count >= 0);
alter table users add column passenger_cancellation_suspended boolean not null default false;
alter table users add column passenger_suspended_until timestamptz;
alter table device_tokens add column notification_protocol smallint not null default 1;

create table passenger_cancellations (
  id uuid primary key default gen_random_uuid(),
  passenger_id uuid not null references users(id),
  trip_id uuid not null unique references trips(id),
  driver_id uuid not null references users(id),
  occurred_at timestamptz not null default now(),
  consecutive_number integer not null,
  trip_status text not null,
  suspension_days integer check (suspension_days >= 0),
  suspension_started_at timestamptz,
  suspension_until timestamptz,
  status text not null check (status in ('RECORDED','SUSPENDED','EXPIRED','REACTIVATED')),
  policy_snapshot jsonb not null,
  reactivated_by uuid references users(id),
  reactivated_at timestamptz,
  unique(passenger_id, consecutive_number)
);
create index passenger_cancellations_history on passenger_cancellations(passenger_id, occurred_at desc);

-- Existing historical rows remain untouched. New assignments must carry proof
-- of an actual acceptance. Deferred validation permits recording the offer and
-- changing the trip atomically, in either order.
create function enforce_trip_assignment() returns trigger language plpgsql as $$
declare current_trip trips%rowtype;
begin
  select * into current_trip from trips where id=new.id;
  if current_trip.status in ('ASSIGNED','DRIVER_EN_ROUTE','DRIVER_ARRIVED','IN_PROGRESS') then
    if current_trip.driver_id is null or current_trip.assigned_at is null then
      raise exception 'TRIP_ASSIGNMENT_REQUIRED' using errcode='23514';
    end if;
    if not exists(select 1 from driver_offers where trip_id=new.id and driver_id=current_trip.driver_id and accepted=true)
       and not exists(select 1 from scheduled_trip_responses where trip_id=new.id and driver_id=current_trip.driver_id and accepted=true) then
      raise exception 'TRIP_ACCEPTANCE_REQUIRED' using errcode='23514';
    end if;
  end if;
  return null;
end;
$$;
create constraint trigger trips_assignment_integrity
  after insert or update of status,driver_id on trips
  deferrable initially deferred for each row execute function enforce_trip_assignment();
