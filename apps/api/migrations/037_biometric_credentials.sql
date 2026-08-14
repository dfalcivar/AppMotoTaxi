create table if not exists biometric_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  secret_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  unique (user_id)
);

create index if not exists biometric_credentials_active_user_idx
  on biometric_credentials (user_id)
  where revoked_at is null;
