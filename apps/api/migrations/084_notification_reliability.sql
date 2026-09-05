-- Reliability and observability layer for the existing Costa-Go notification pipeline.
-- Critical trip/security notifications remain synchronous; non-critical work is queued.

alter table user_notifications
  add column if not exists expires_at timestamptz,
  add column if not exists collapse_key text,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz,
  add column if not exists fallback_shown_at timestamptz;

alter table user_notifications drop constraint if exists user_notifications_priority_check;
update user_notifications set priority=case priority
  when 'CRITICAL' then 'TRIP_CRITICAL'
  when 'HIGH' then 'OPERATIONAL'
  when 'NORMAL' then case category when 'SMART' then 'SMART' when 'REMINDER' then 'REMINDER' when 'CAMPAIGN' then 'CAMPAIGN' else 'OPERATIONAL' end
  when 'LOW' then 'PROMOTIONAL'
  else priority end;
alter table user_notifications add constraint user_notifications_priority_check check
  (priority in ('SECURITY','TRIP_CRITICAL','OPERATIONAL','REMINDER','SMART','SYSTEM','CAMPAIGN','PROMOTIONAL'));
alter table user_notifications drop constraint if exists user_notifications_status_check;
alter table user_notifications add constraint user_notifications_status_check check
  (status in ('CREATED','QUEUED','PROCESSING','RETRY','SENT','FAILED','SKIPPED','DEAD_LETTER','EXPIRED'));
create index if not exists user_notifications_expiry_idx on user_notifications(expires_at) where expires_at is not null;

alter table device_tokens
  add column if not exists device_id text,
  add column if not exists session_id uuid,
  add column if not exists permission_status text not null default 'UNKNOWN',
  add column if not exists invalidated_reason text,
  add column if not exists provider_error_code text,
  add column if not exists updated_at timestamptz not null default now();
alter table device_tokens drop constraint if exists device_tokens_permission_status_check;
alter table device_tokens add constraint device_tokens_permission_status_check
  check(permission_status in ('AUTHORIZED','PROVISIONAL','DENIED','NOT_DETERMINED','UNKNOWN'));
update device_tokens d set session_id=u.active_session_id from users u
  where u.id=d.user_id and d.session_id is null and u.active_session_id is not null;
create index if not exists device_tokens_session_idx on device_tokens(user_id,session_id) where enabled and invalidated_at is null;
create unique index if not exists device_tokens_user_device_unique on device_tokens(user_id,device_id) where device_id is not null;

create table if not exists notification_delivery_config (
  id smallint primary key default 1 check(id=1),
  max_attempts smallint not null default 5 check(max_attempts between 1 and 12),
  base_backoff_seconds integer not null default 30 check(base_backoff_seconds between 5 and 3600),
  batch_size integer not null default 50 check(batch_size between 1 and 500),
  circuit_failure_threshold integer not null default 10 check(circuit_failure_threshold between 2 and 1000),
  circuit_window_minutes integer not null default 5 check(circuit_window_minutes between 1 and 120),
  circuit_cooldown_minutes integer not null default 10 check(circuit_cooldown_minutes between 1 and 1440),
  attribution_window_hours integer not null default 24 check(attribution_window_hours between 1 and 720),
  analytics_retention_days integer not null default 180 check(analytics_retention_days between 30 and 1095),
  delivery_retention_days integer not null default 90 check(delivery_retention_days between 30 and 365),
  updated_by uuid references users(id),
  updated_at timestamptz not null default now()
);
insert into notification_delivery_config(id) values(1) on conflict(id) do nothing;

create table if not exists notification_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique references user_notifications(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  priority text not null,
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','RETRY','SENT','FAILED','DEAD_LETTER','EXPIRED','SKIPPED')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  expires_at timestamptz,
  collapse_key text,
  locked_at timestamptz,
  locked_by text,
  last_error_code text,
  last_error_message text,
  processing_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists notification_delivery_jobs_ready_idx
  on notification_delivery_jobs(status,next_attempt_at,priority,created_at)
  where status in ('QUEUED','RETRY');

create table if not exists notification_provider_incidents (
  id bigserial primary key,
  provider text not null default 'FCM',
  state text not null check(state in ('OPEN','HALF_OPEN','CLOSED')),
  reason text,
  failure_count integer not null default 0,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notification_provider_incidents_open_idx on notification_provider_incidents(state,opened_at desc);

create table if not exists notification_trip_attributions (
  notification_id uuid primary key references user_notifications(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  trip_id uuid references trips(id) on delete set null,
  prepared_at timestamptz,
  requested_at timestamptz,
  completed_at timestamptz,
  attribution_expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists notification_trip_attributions_trip_idx on notification_trip_attributions(trip_id);

alter table notification_analytics_events drop constraint if exists notification_analytics_events_event_check;
alter table notification_analytics_events add constraint notification_analytics_events_event_check check
  (event in ('CREATED','QUEUED','RETRY','SENT','FAILED','SKIPPED','DEAD_LETTER','EXPIRED','OPENED','DEEP_LINK_OPENED','STORE_OPENED','APP_UPDATED','TRIP_PREPARATION_OPENED','TRIP_REQUESTED','TRIP_COMPLETED','FALLBACK_SHOWN'));

comment on table notification_delivery_jobs is 'Cola durable del NotificationService existente; no es un sistema de notificaciones paralelo.';
