-- Shared planner data lives in public.user_data.
-- Legacy school_password fields were removed from user_data content and legacy_content in migration 20260613031804.
-- Web/backend credentials now live in app_private.school_credentials as encrypted ciphertext.
-- Official school sessions live in app_private.school_sessions as encrypted ciphertext.
-- normalize_user_data_content_v2() execute grants are restricted in migration 20260612181548.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.school_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_account text not null,
  password_ciphertext text not null,
  key_version integer not null default 1,
  last_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_school_credentials_updated_at on public.school_credentials;
create trigger trg_school_credentials_updated_at
before update on public.school_credentials
for each row
execute function public.set_updated_at();

alter table public.school_credentials enable row level security;

drop policy if exists school_credentials_service_role_only on public.school_credentials;
create policy school_credentials_service_role_only
on public.school_credentials
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

revoke all on table public.school_credentials from anon, authenticated;
grant select, insert, update, delete on table public.school_credentials to service_role;

create schema if not exists app_private;

revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

create table if not exists app_private.school_credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  school_account text not null,
  password_ciphertext text not null,
  key_version integer not null default 1,
  last_verified_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_school_credentials_updated_at on app_private.school_credentials;
create trigger trg_school_credentials_updated_at
before update on app_private.school_credentials
for each row
execute function public.set_updated_at();

alter table app_private.school_credentials enable row level security;

drop policy if exists school_credentials_service_role_only on app_private.school_credentials;
create policy school_credentials_service_role_only
on app_private.school_credentials
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

revoke all on table app_private.school_credentials from public, anon, authenticated;
grant select, insert, update, delete on table app_private.school_credentials to service_role;

delete from public.school_credentials;
revoke all on table public.school_credentials from anon, authenticated, service_role;

create or replace function public.get_school_credentials(
  p_user_id uuid
)
returns table (
  school_account text,
  password_ciphertext text,
  key_version integer,
  last_verified_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select
    c.school_account,
    c.password_ciphertext,
    c.key_version,
    c.last_verified_at
  from app_private.school_credentials as c
  where c.user_id = p_user_id
  limit 1;
$$;

create or replace function public.upsert_school_credentials(
  p_user_id uuid,
  p_school_account text,
  p_password_ciphertext text,
  p_key_version integer default 1,
  p_last_verified_at timestamptz default timezone('utc', now())
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into app_private.school_credentials (
    user_id,
    school_account,
    password_ciphertext,
    key_version,
    last_verified_at
  )
  values (
    p_user_id,
    p_school_account,
    p_password_ciphertext,
    coalesce(p_key_version, 1),
    p_last_verified_at
  )
  on conflict (user_id) do update
  set
    school_account = excluded.school_account,
    password_ciphertext = excluded.password_ciphertext,
    key_version = excluded.key_version,
    last_verified_at = excluded.last_verified_at;
$$;

create or replace function public.delete_school_credentials(
  p_user_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from app_private.school_credentials as c
  where c.user_id = p_user_id;
$$;

revoke all on function public.get_school_credentials(uuid) from public, anon, authenticated;
revoke all on function public.upsert_school_credentials(uuid, text, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_school_credentials(uuid) from public, anon, authenticated;

grant execute on function public.get_school_credentials(uuid) to service_role;
grant execute on function public.upsert_school_credentials(uuid, text, text, integer, timestamptz) to service_role;
grant execute on function public.delete_school_credentials(uuid) to service_role;

create table if not exists app_private.school_sessions (
  user_id uuid not null references auth.users(id) on delete cascade,
  school_account text not null,
  session_ciphertext text not null,
  key_version integer not null default 1,
  expires_at timestamptz not null,
  last_keep_alive_at timestamptz,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, school_account)
);

drop trigger if exists trg_school_sessions_updated_at on app_private.school_sessions;
create trigger trg_school_sessions_updated_at
before update on app_private.school_sessions
for each row
execute function public.set_updated_at();

alter table app_private.school_sessions enable row level security;

drop policy if exists school_sessions_service_role_only on app_private.school_sessions;
create policy school_sessions_service_role_only
on app_private.school_sessions
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

revoke all on table app_private.school_sessions from public, anon, authenticated;
grant select, insert, update, delete on table app_private.school_sessions to service_role;

create or replace function public.get_school_session(
  p_user_id uuid,
  p_school_account text
)
returns table (
  school_account text,
  session_ciphertext text,
  key_version integer,
  expires_at timestamptz,
  last_keep_alive_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  select
    s.school_account,
    s.session_ciphertext,
    s.key_version,
    s.expires_at,
    s.last_keep_alive_at
  from app_private.school_sessions as s
  where s.user_id = p_user_id
    and s.school_account = p_school_account
    and s.expires_at > timezone('utc', now())
  limit 1;
$$;

create or replace function public.upsert_school_session(
  p_user_id uuid,
  p_school_account text,
  p_session_ciphertext text,
  p_expires_at timestamptz,
  p_last_keep_alive_at timestamptz default timezone('utc', now())
)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into app_private.school_sessions (
    user_id,
    school_account,
    session_ciphertext,
    key_version,
    expires_at,
    last_keep_alive_at
  )
  values (
    p_user_id,
    p_school_account,
    p_session_ciphertext,
    1,
    p_expires_at,
    p_last_keep_alive_at
  )
  on conflict (user_id, school_account) do update
  set
    session_ciphertext = excluded.session_ciphertext,
    key_version = excluded.key_version,
    expires_at = excluded.expires_at,
    last_keep_alive_at = excluded.last_keep_alive_at;
$$;

create or replace function public.delete_school_session(
  p_user_id uuid,
  p_school_account text default null
)
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from app_private.school_sessions as s
  where s.user_id = p_user_id
    and (
      p_school_account is null
      or s.school_account = p_school_account
    );
$$;

revoke all on function public.get_school_session(uuid, text) from public, anon, authenticated;
revoke all on function public.upsert_school_session(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.delete_school_session(uuid, text) from public, anon, authenticated;

grant execute on function public.get_school_session(uuid, text) to service_role;
grant execute on function public.upsert_school_session(uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.delete_school_session(uuid, text) to service_role;

create table if not exists public.schedule_sync_snapshots (
  profile_key text primary key,
  school_account text not null,
  student_name text,
  payload jsonb not null,
  synced_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_schedule_sync_snapshots_updated_at on public.schedule_sync_snapshots;
create trigger trg_schedule_sync_snapshots_updated_at
before update on public.schedule_sync_snapshots
for each row
execute function public.set_updated_at();

alter table public.schedule_sync_snapshots enable row level security;

drop policy if exists "service role only" on public.schedule_sync_snapshots;
create policy "service role only"
on public.schedule_sync_snapshots
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

create table if not exists public.history_import_snapshots (
  profile_key text primary key,
  school_account text not null,
  student_name text,
  payload jsonb not null,
  imported_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

drop trigger if exists trg_history_import_snapshots_updated_at on public.history_import_snapshots;
create trigger trg_history_import_snapshots_updated_at
before update on public.history_import_snapshots
for each row
execute function public.set_updated_at();

alter table public.history_import_snapshots enable row level security;

drop policy if exists "service role only" on public.history_import_snapshots;
create policy "service role only"
on public.history_import_snapshots
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');

create table if not exists public.moodle_assignment_snapshots (
  profile_key text primary key,
  school_account text not null,
  payload jsonb not null,
  synced_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists moodle_assignment_snapshots_synced_at_idx
  on public.moodle_assignment_snapshots (synced_at desc);

drop trigger if exists trg_moodle_assignment_snapshots_updated_at on public.moodle_assignment_snapshots;
create trigger trg_moodle_assignment_snapshots_updated_at
before update on public.moodle_assignment_snapshots
for each row
execute function public.set_updated_at();

alter table public.moodle_assignment_snapshots enable row level security;

drop policy if exists "service role only" on public.moodle_assignment_snapshots;
create policy "service role only"
on public.moodle_assignment_snapshots
for all
using ((select auth.role()) = 'service_role')
with check ((select auth.role()) = 'service_role');
