create table if not exists push_delivery_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  trip_id uuid references trips(id) on delete set null,
  event_type text not null,
  status text not null check (status in ('SENT','PARTIAL','FAILED','SKIPPED')),
  attempted integer not null default 0 check (attempted >= 0),
  sent integer not null default 0 check (sent >= 0),
  failed integer not null default 0 check (failed >= 0),
  error_codes text[] not null default '{}',
  duration_ms integer not null default 0 check (duration_ms >= 0),
  created_at timestamptz not null default now()
);

create index if not exists push_delivery_events_created_idx on push_delivery_events(created_at desc);
create index if not exists push_delivery_events_trip_idx on push_delivery_events(trip_id, created_at desc) where trip_id is not null;
create index if not exists push_delivery_events_status_idx on push_delivery_events(status, created_at desc);

comment on table push_delivery_events is 'Resultados no sensibles de entrega FCM para diagnóstico operativo.';

