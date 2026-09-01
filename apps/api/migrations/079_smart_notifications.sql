-- Incremental extension of the existing notification center and FCM pipeline.
alter table user_notifications
  add column if not exists category text not null default 'TRANSACTIONAL',
  add column if not exists priority text not null default 'HIGH',
  add column if not exists reference_id text,
  add column if not exists deep_link text,
  add column if not exists action text,
  add column if not exists status text not null default 'CREATED',
  add column if not exists persist_in_center boolean not null default true,
  add column if not exists send_push boolean not null default true,
  add column if not exists scheduled_at timestamptz,
  add column if not exists push_sent_at timestamptz,
  add column if not exists opened_at timestamptz,
  add column if not exists provider_message_id text,
  add column if not exists idempotency_key text,
  add column if not exists error_code text,
  add column if not exists error_message text;

alter table user_notifications drop constraint if exists user_notifications_category_check;
alter table user_notifications add constraint user_notifications_category_check
  check (category in ('TRANSACTIONAL','OPERATIONAL','SMART','CAMPAIGN','PROMOTIONAL'));
alter table user_notifications drop constraint if exists user_notifications_priority_check;
alter table user_notifications add constraint user_notifications_priority_check
  check (priority in ('CRITICAL','HIGH','NORMAL','LOW'));
alter table user_notifications drop constraint if exists user_notifications_status_check;
alter table user_notifications add constraint user_notifications_status_check
  check (status in ('CREATED','QUEUED','SENT','FAILED','SKIPPED'));

create unique index if not exists user_notifications_idempotency_unique
  on user_notifications(idempotency_key) where idempotency_key is not null;
create index if not exists user_notifications_category_created_idx
  on user_notifications(category,created_at desc);
create index if not exists user_notifications_status_scheduled_idx
  on user_notifications(status,scheduled_at) where scheduled_at is not null;
create index if not exists user_notifications_reference_idx
  on user_notifications(reference_id) where reference_id is not null;

alter table device_tokens
  add column if not exists enabled boolean not null default true,
  add column if not exists invalidated_at timestamptz;
create index if not exists device_tokens_delivery_idx
  on device_tokens(user_id,last_seen_at desc) where enabled and invalidated_at is null;

create table if not exists smart_notification_config (
  id smallint primary key default 1 check (id=1),
  mode text not null default 'OFF' check (mode in ('OFF','TEST','ON')),
  frequent_trip_enabled boolean not null default true,
  return_trip_enabled boolean not null default true,
  favorite_destination_enabled boolean not null default true,
  reactivation_enabled boolean not null default true,
  minimum_trips smallint not null default 5 check (minimum_trips between 2 and 100),
  minimum_matches smallint not null default 3 check (minimum_matches between 2 and 100),
  minimum_confidence numeric(5,2) not null default 70 check (minimum_confidence between 0 and 100),
  analysis_window_days smallint not null default 30 check (analysis_window_days between 7 and 365),
  schedule_tolerance_minutes smallint not null default 25 check (schedule_tolerance_minutes between 5 and 180),
  notification_lead_minutes smallint not null default 15 check (notification_lead_minutes between 1 and 180),
  max_per_user_per_day smallint not null default 1 check (max_per_user_per_day between 0 and 20),
  minimum_interval_minutes integer not null default 720 check (minimum_interval_minutes between 1 and 10080),
  allowed_start_time time not null default '06:00',
  allowed_end_time time not null default '21:00',
  enabled_week_days smallint[] not null default '{1,2,3,4,5,6,7}',
  inactive_user_days smallint not null default 21 check (inactive_user_days between 7 and 365),
  scheduler_interval_minutes smallint not null default 15 check (scheduler_interval_minutes between 1 and 1440),
  last_scheduler_run_at timestamptz,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (allowed_start_time < allowed_end_time)
);
insert into smart_notification_config(id,mode) values (1,'OFF') on conflict(id) do nothing;

create table if not exists smart_notification_patterns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  pattern_key text not null,
  pattern_type text not null check (pattern_type in ('FREQUENT_TRIP','RETURN_HOME','FAVORITE_DESTINATION','REACTIVATION')),
  origin_reference text,
  destination_reference text,
  origin_lat double precision,
  origin_lng double precision,
  destination_lat double precision,
  destination_lng double precision,
  favorite_destination_id uuid references favorite_places(id) on delete set null,
  week_days smallint[] not null default '{}',
  average_time time,
  time_tolerance_minutes smallint,
  matches_count integer not null default 0,
  trips_analyzed integer not null default 0,
  confidence_score numeric(5,2) not null default 0,
  first_detected_at timestamptz not null default now(),
  last_detected_at timestamptz not null default now(),
  last_evaluated_at timestamptz not null default now(),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,pattern_key)
);
create index if not exists smart_patterns_active_idx
  on smart_notification_patterns(is_active,confidence_score desc,last_evaluated_at desc);
create index if not exists smart_patterns_user_idx
  on smart_notification_patterns(user_id,last_evaluated_at desc);

create table if not exists notification_test_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade unique,
  enabled boolean not null default true,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 3 and 120),
  campaign_type text not null check (campaign_type in ('CAMPAIGN','EVENT','PROMOTIONAL')),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 500),
  deep_link text,
  action text,
  metadata jsonb not null default '{}',
  segment jsonb not null default '{}',
  status text not null default 'DRAFT' check (status in ('DRAFT','SCHEDULED','PROCESSING','SENT','CANCELLED','FAILED')),
  scheduled_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid not null references users(id),
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists notification_campaigns_status_idx
  on notification_campaigns(status,scheduled_at,created_at desc);

create table if not exists notification_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references notification_campaigns(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  notification_id uuid references user_notifications(id) on delete set null,
  status text not null default 'QUEUED' check (status in ('QUEUED','SENT','FAILED','SKIPPED','OPENED')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  unique(campaign_id,user_id)
);
create index if not exists notification_campaign_recipients_status_idx
  on notification_campaign_recipients(campaign_id,status);

create table if not exists notification_analytics_events (
  id bigserial primary key,
  notification_id uuid not null references user_notifications(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  event text not null check (event in ('CREATED','SENT','FAILED','OPENED','DEEP_LINK_OPENED','TRIP_PREPARATION_OPENED','TRIP_REQUESTED','TRIP_COMPLETED')),
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'
);
create index if not exists notification_analytics_notification_idx
  on notification_analytics_events(notification_id,occurred_at);
create index if not exists notification_analytics_event_idx
  on notification_analytics_events(event,occurred_at desc);

comment on table smart_notification_patterns is 'Patrones derivados; trips sigue siendo la fuente de verdad.';
comment on table notification_campaigns is 'Campañas administradas por Costa-Go. Comercios no tienen acceso directo a envío push.';
