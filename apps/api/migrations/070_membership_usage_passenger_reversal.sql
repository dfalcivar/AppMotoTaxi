-- Keep the existing consumption ledger and all historical completed usages.
-- A reassigned trip can consume one unit for each driver who accepted it.
alter table membership_cycle_trip_usages drop constraint membership_cycle_trip_usages_trip_id_key;
alter table membership_cycle_trip_usages add constraint membership_usage_trip_driver_key unique(trip_id,driver_id);
alter table membership_cycle_trip_usages alter column completed_at drop not null;
alter table membership_cycle_trip_usages add column accepted_at timestamptz;
alter table membership_cycle_trip_usages add column reversed_by uuid references users(id);
create index membership_usage_cycle_idx on membership_cycle_trip_usages(membership_cycle_id);
