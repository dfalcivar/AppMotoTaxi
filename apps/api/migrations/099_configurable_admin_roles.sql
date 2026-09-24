-- Roles web configurables. El enum users.role y las sesiones existentes se conservan.
create table if not exists admin_custom_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  enabled boolean not null default true,
  created_by uuid references users(id) on delete set null,
  updated_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_custom_roles_name_length check (length(trim(name)) between 3 and 80)
);
create unique index if not exists admin_custom_roles_name_unique on admin_custom_roles(lower(name));

create table if not exists admin_custom_role_permissions (
  role_id uuid not null references admin_custom_roles(id) on delete cascade,
  permission text not null,
  primary key (role_id, permission)
);

alter table users add column if not exists admin_custom_role_id uuid
  references admin_custom_roles(id) on delete restrict;
create index if not exists users_admin_custom_role_id_idx on users(admin_custom_role_id)
  where admin_custom_role_id is not null;

insert into admin_custom_roles(id,name,description,enabled)
values ('e6031b0f-cab8-44b0-9907-67412fba26a8','Gestión Operativa',
  'Gestión operativa, financiera, comercial y de soporte de Costa-Go.',true)
on conflict (id) do nothing;

insert into admin_custom_role_permissions(role_id,permission)
select 'e6031b0f-cab8-44b0-9907-67412fba26a8'::uuid, permission from (values
  ('dashboard:view'),('operations:view'),('alerts:view'),('drivers:view'),
  ('drivers:manage'),('drivers:approve'),('drivers:reject'),
  ('drivers:request_corrections'),('drivers:suspend'),('drivers:documents:view'),
  ('drivers:documents:manage'),('trips:view'),('passengers:view'),('cooperatives:view'),
  ('memberships:view'),('memberships:manage'),('membership_grace:manage'),
  ('payment_orders:create'),('payments:collect'),('payments:transfer_review'),
  ('payments:view_all'),('collection_points:manage'),('cash_closures:review'),
  ('settlements:review'),('settlements:view_all'),('FACTURACION_VER'),
  ('CLIENTES_FISCALES_VER'),('CLIENTES_FISCALES_EDITAR'),
  ('FACTURACION_DASHBOARD_VER'),('FACTURACION_CONSULTAR_ESTADO'),
  ('FACTURACION_REINTENTAR'),('FACTURACION_DESCARGAR'),('FACTURACION_REENVIAR'),
  ('incidents:view'),('incidents:manage'),('support:view'),('support:manage'),
  ('faq:view'),('faq:manage'),('commercial:dashboard'),
  ('commercial:leads:view'),('commercial:leads:manage'),
  ('commercial:advertisers:view'),('commercial:advertisers:manage'),
  ('commercial:orders:view'),('commercial:orders:manage'),
  ('commercial:payments:view'),('commercial:payments:review'),
  ('commercial:campaigns:view'),('commercial:campaigns:manage'),
  ('commercial:campaigns:review'),('commercial:campaigns:approve'),
  ('commercial:campaigns:reject'),('commercial:campaigns:request_correction'),
  ('commercial:campaigns:pause'),('commercial:campaigns:resume'),
  ('advertising:view'),('advertising:manage'),
  ('notification_campaigns:view'),('notification_campaigns:manage'),
  ('reports:view'),('reports:export')
) as selected(permission)
on conflict do nothing;
