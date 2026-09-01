-- Preferencias sobre el ecosistema existente de notificaciones.
-- Las notificaciones transaccionales de viaje y seguridad no se pueden desactivar.
create table if not exists user_notification_preferences (
  user_id uuid not null references users(id) on delete cascade,
  context text not null check (context in ('PASSENGER','DRIVER','COMMON')),
  preference_key text not null check (preference_key in (
    'PASSENGER_SMART_RECOMMENDATIONS',
    'PASSENGER_SCHEDULED_TRIP_REMINDERS',
    'DRIVER_MEMBERSHIP_REMINDERS',
    'DRIVER_DOCUMENT_EXPIRATION_REMINDERS',
    'PROMOTIONAL_NOTIFICATIONS'
  )),
  enabled boolean not null default true,
  state text not null default 'ENABLED' check (state in ('ENABLED','USER_DISABLED','AUTO_PAUSED')),
  auto_paused_until timestamptz,
  ignored_streak integer not null default 0 check (ignored_streak >= 0),
  modified_source text not null default 'USER' check (modified_source in ('USER','SYSTEM','ADMIN','MIGRATION')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,context,preference_key),
  check ((context='PASSENGER' and preference_key like 'PASSENGER_%')
      or (context='DRIVER' and preference_key like 'DRIVER_%')
      or (context='COMMON' and preference_key='PROMOTIONAL_NOTIFICATIONS')),
  check ((state='AUTO_PAUSED') = (auto_paused_until is not null))
);
create index if not exists user_notification_preferences_key_idx
  on user_notification_preferences(preference_key,state,updated_at desc);

alter table smart_notification_config
  add column if not exists max_per_user_per_week smallint not null default 3 check (max_per_user_per_week between 0 and 50),
  add column if not exists ignored_to_reduce_frequency smallint not null default 3 check (ignored_to_reduce_frequency between 1 and 20),
  add column if not exists ignored_to_pause smallint not null default 5 check (ignored_to_pause between 2 and 50),
  add column if not exists auto_pause_days smallint not null default 15 check (auto_pause_days between 1 and 90),
  add column if not exists reduced_frequency_multiplier smallint not null default 2 check (reduced_frequency_multiplier between 1 and 10);

alter table operational_settings
  add column if not exists passenger_scheduled_reminder_minutes integer[] not null default '{30,10}',
  add column if not exists passenger_scheduled_max_reminders smallint not null default 2 check (passenger_scheduled_max_reminders between 0 and 10),
  add column if not exists reminder_allowed_start_time time not null default '06:00',
  add column if not exists reminder_allowed_end_time time not null default '22:00',
  add column if not exists driver_membership_reminder_days integer[] not null default '{5,3,1}',
  add column if not exists driver_membership_max_reminders smallint not null default 3 check (driver_membership_max_reminders between 0 and 10),
  add column if not exists driver_document_reminder_days integer[] not null default '{30,15,7}';

create table if not exists notification_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  reminder_type text not null,
  reference_id text not null,
  offset_value integer not null,
  notification_id uuid references user_notifications(id) on delete set null,
  sent_at timestamptz not null default now(),
  unique(user_id,reminder_type,reference_id,offset_value)
);
create index if not exists notification_reminder_deliveries_reference_idx
  on notification_reminder_deliveries(reminder_type,reference_id,sent_at desc);

alter table user_notifications drop constraint if exists user_notifications_category_check;
alter table user_notifications add constraint user_notifications_category_check
  check (category in ('TRANSACTIONAL','OPERATIONAL','REMINDER','SYSTEM','SMART','CAMPAIGN','PROMOTIONAL'));

comment on table user_notification_preferences is 'Preferencias opcionales; las alertas de viaje, seguridad y sistema siguen siempre activas.';
comment on column user_notification_preferences.modified_source is 'Distingue decisiones manuales de pausas automáticas para no reactivar al usuario sin consentimiento.';
