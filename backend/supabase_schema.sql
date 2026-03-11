-- Shared planner data lives in public.user_data.
-- iOS currently writes these keys into user_data.content.settings:
-- school_account, school_password, reminder_minutes

create table if not exists public.schedule_sync_snapshots (
  profile_key text primary key,
  school_account text not null,
  student_name text,
  payload jsonb not null,
  synced_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

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
