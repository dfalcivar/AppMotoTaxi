-- Evoluciona las campañas existentes para recomendar actualizaciones de Costa-Go.
-- No activa actualizaciones obligatorias ni crea un canal de notificaciones paralelo.
alter table device_tokens
  add column if not exists app_version text,
  add column if not exists app_build integer,
  add column if not exists app_version_reported_at timestamptz;

create index if not exists device_tokens_app_version_idx
  on device_tokens(platform,app_build,app_version) where enabled and invalidated_at is null;

alter table notification_campaigns drop constraint if exists notification_campaigns_campaign_type_check;
alter table notification_campaigns add constraint notification_campaigns_campaign_type_check
  check (campaign_type in ('CAMPAIGN','EVENT','PROMOTIONAL','APP_UPDATE'));

alter table notification_analytics_events drop constraint if exists notification_analytics_events_event_check;
alter table notification_analytics_events add constraint notification_analytics_events_event_check
  check (event in ('CREATED','SENT','FAILED','OPENED','DEEP_LINK_OPENED','STORE_OPENED','APP_UPDATED','TRIP_PREPARATION_OPENED','TRIP_REQUESTED','TRIP_COMPLETED'));

create unique index if not exists notification_app_updated_once_idx
  on notification_analytics_events(notification_id,event) where event='APP_UPDATED';

create table if not exists app_version_config (
  platform text primary key check (platform in ('ANDROID','IOS')),
  latest_version text,
  latest_build integer,
  minimum_supported_version text,
  minimum_supported_build integer,
  update_policy text not null default 'RECOMMENDED' check (update_policy in ('RECOMMENDED','REQUIRED')),
  required_update_enabled boolean not null default false,
  message text not null default 'Hay una nueva versión de Costa-Go disponible.',
  store_url text,
  updated_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not required_update_enabled or update_policy='REQUIRED')
);

insert into app_version_config(platform,store_url)
values ('ANDROID','https://play.google.com/store/apps/details?id=ec.atacames.mototaxi.mototaxi_atacames'),
       ('IOS',null)
on conflict(platform) do nothing;

comment on column device_tokens.app_version is 'Version instalada reportada por la app autenticada.';
comment on column device_tokens.app_build is 'Build instalado reportado por la app autenticada.';
comment on table app_version_config is 'Configuración por plataforma; REQUIRED permanece inactivo hasta habilitación administrativa futura.';
