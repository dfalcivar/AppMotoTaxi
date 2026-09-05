-- Extensión EMAIL del sistema de notificaciones existente para campañas comerciales.
-- Los eventos se crean apagados para que el despliegue no origine envíos inesperados.

create table if not exists notification_event_definitions (
  event_type text primary key,
  category text not null,
  communication_class text not null default 'SERVICE_TRANSACTIONAL',
  channels text[] not null default '{}',
  enabled boolean not null default false,
  template_key text not null,
  schedule_config jsonb not null default '{}'::jsonb,
  max_attempts smallint not null default 4 check(max_attempts between 1 and 12),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check(category in ('COMMERCIAL')),
  check(communication_class in ('SERVICE_TRANSACTIONAL','PROMOTIONAL')),
  check(channels <@ array['PUSH','IN_APP','EMAIL']::text[])
);

insert into notification_event_definitions(event_type,category,communication_class,channels,enabled,template_key,schedule_config)
values
  ('CAMPAIGN_EXPIRING_7D','COMMERCIAL','SERVICE_TRANSACTIONAL',array['EMAIL'],false,'commercial_campaign_expiring',jsonb_build_object('daysBefore',7)),
  ('CAMPAIGN_EXPIRING_3D','COMMERCIAL','SERVICE_TRANSACTIONAL',array['EMAIL'],false,'commercial_campaign_expiring',jsonb_build_object('daysBefore',3)),
  ('CAMPAIGN_EXPIRED','COMMERCIAL','SERVICE_TRANSACTIONAL',array['EMAIL'],false,'commercial_campaign_expired','{}'::jsonb),
  ('CAMPAIGN_MONTHLY_REPORT','COMMERCIAL','SERVICE_TRANSACTIONAL',array['EMAIL'],false,'commercial_campaign_monthly_report',jsonb_build_object('dayOfMonth',1))
on conflict(event_type) do nothing;

create table if not exists notification_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  event_type text not null references notification_event_definitions(event_type),
  campaign_id uuid references affiliate_banners(id) on delete cascade,
  advertiser_id uuid references advertisers(id) on delete set null,
  recipient_email text not null,
  subject text not null,
  period_key text not null,
  status text not null default 'QUEUED' check(status in ('QUEUED','PROCESSING','RETRY','SENT','FAILED','TEST')),
  attempts integer not null default 0,
  max_attempts integer not null default 4,
  next_attempt_at timestamptz not null default now(),
  scheduled_at timestamptz not null default now(),
  sent_at timestamptz,
  provider_message_id text,
  last_error_code text,
  last_error_message text,
  is_test boolean not null default false,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists notification_email_deliveries_real_unique
  on notification_email_deliveries(campaign_id,event_type,period_key) where not is_test;
create index if not exists notification_email_deliveries_ready_idx
  on notification_email_deliveries(status,next_attempt_at,created_at) where status in ('QUEUED','RETRY');
create index if not exists notification_email_deliveries_campaign_idx
  on notification_email_deliveries(campaign_id,created_at desc);

alter table operational_settings
  add column if not exists advertising_renewal_contact_url text;

comment on table notification_email_deliveries is
  'Canal EMAIL de NotificationService. Historial, idempotencia y reintentos para comunicaciones comerciales.';
