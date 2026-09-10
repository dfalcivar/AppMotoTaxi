create table if not exists mobile_admin_access (
  user_id uuid primary key references users(id) on delete cascade,
  access_role text not null check(access_role in ('SUPER_ADMIN','MOBILE_OPERATIONS_ADMIN')),
  enabled boolean not null default false,
  assigned_by uuid references users(id) on delete set null,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mobile_admin_access_enabled_idx
  on mobile_admin_access(enabled) where enabled;

comment on table mobile_admin_access is
  'Autorización administrativa adicional para cuentas móviles; no reemplaza PASSENGER/DRIVER.';
