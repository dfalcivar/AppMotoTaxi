-- Institutional campaigns are independent of paid advertising and financial flows.
create table costa_go_campaigns (
  id uuid primary key default gen_random_uuid(),
  internal_name text not null,
  title text not null,
  audience text not null check (audience in ('PASSENGER','DRIVER','BOTH')),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  priority integer not null default 0 check (priority between 0 and 1000),
  status text not null default 'DRAFT' check (status in ('DRAFT','PENDING_APPROVAL','APPROVED','REJECTED','ACTIVE','PAUSED','FINISHED')),
  enabled boolean not null default false,
  all_zones boolean not null default true,
  content jsonb not null default '{}'::jsonb check (jsonb_typeof(content)='object'),
  version integer not null default 1,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (not enabled or status='ACTIVE')
);
create index costa_go_campaigns_live_idx on costa_go_campaigns(priority desc, starts_at desc) where enabled and status='ACTIVE';
create table costa_go_campaign_areas (
  campaign_id uuid not null references costa_go_campaigns(id) on delete cascade,
  service_area_id uuid not null references service_areas(id) on delete restrict,
  primary key(campaign_id,service_area_id)
);
-- Same bytea image storage used by existing banners; never accept arbitrary file paths.
create table costa_go_campaign_assets (
  campaign_id uuid not null references costa_go_campaigns(id) on delete cascade,
  kind text not null check (kind in ('MAIN','DARK','THUMBNAIL','DECORATION')),
  mime text not null check (mime in ('image/jpeg','image/png','image/webp')),
  data bytea not null check (octet_length(data) between 1 and 2097152),
  updated_at timestamptz not null default now(),
  primary key(campaign_id,kind)
);
-- Optional association for the existing notification engine; does not schedule or send push.
alter table notification_campaigns add column costa_go_campaign_id uuid
  references costa_go_campaigns(id) on delete set null;
create index notification_campaigns_costa_go_idx on notification_campaigns(costa_go_campaign_id)
  where costa_go_campaign_id is not null;
