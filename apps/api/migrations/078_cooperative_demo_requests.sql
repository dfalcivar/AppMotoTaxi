create sequence if not exists cooperative_demo_code_seq;

create table if not exists cooperative_demo_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  cooperative_name text not null,
  contact_name text not null,
  role_title text not null,
  phone text not null,
  email text not null,
  city text not null,
  unit_count integer not null check (unit_count between 1 and 10000),
  message text not null,
  status text not null default 'NEW' check (status in ('NEW','CONTACTED','QUALIFIED','CLOSED')),
  submission_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cooperative_demo_requests_status_created_idx
  on cooperative_demo_requests(status, created_at desc);
