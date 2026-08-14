create table if not exists mobile_account_roles (
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('PASSENGER','DRIVER')),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

insert into mobile_account_roles (user_id, role)
select id, 'PASSENGER' from users
where role in ('PASSENGER','DRIVER') and deleted_at is null
on conflict do nothing;

insert into mobile_account_roles (user_id, role)
select user_id, 'DRIVER' from drivers
on conflict do nothing;

alter table users add column if not exists last_mobile_role text;

do $$ begin
  alter table users add constraint users_last_mobile_role_check
    check (last_mobile_role is null or last_mobile_role in ('PASSENGER','DRIVER'));
exception when duplicate_object then null;
end $$;

update users set last_mobile_role=case when role='DRIVER' then 'DRIVER' else 'PASSENGER' end
where role in ('PASSENGER','DRIVER') and last_mobile_role is null;

update users set status='ACTIVE'
where deleted_at is null and email_verified_at is not null
  and exists(select 1 from mobile_account_roles mar where mar.user_id=users.id);

create index if not exists mobile_account_roles_role_idx on mobile_account_roles(role,user_id);
