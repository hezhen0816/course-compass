-- Course Compass cloud planning and per-user sync snapshots.

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path to 'public', 'pg_catalog'
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- ---------------------------------------------------------------- user_data
create table if not exists public.user_data (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  content jsonb,
  updated_at timestamptz default timezone('utc'::text, now()),
  content_version integer default 2 not null,
  legacy_content jsonb,
  migrated_at timestamptz,
  last_writer text,
  constraint user_data_pkey primary key (id),
  constraint user_data_user_id_key unique (user_id),
  constraint user_data_user_id_fkey foreign key (user_id) references auth.users(id)
);

create or replace function public.normalize_user_data_content_v2()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  previous_content jsonb;
  incoming_content jsonb;
  merged_content jsonb;
  detected_writer text;
begin
  previous_content := case
    when tg_op = 'UPDATE' then coalesce(old.content, '{}'::jsonb)
    else '{}'::jsonb
  end;
  incoming_content := coalesce(new.content, '{}'::jsonb);

  if jsonb_typeof(incoming_content) is distinct from 'object' then
    incoming_content := '{}'::jsonb;
  end if;

  if jsonb_typeof(previous_content) is distinct from 'object' then
    previous_content := '{}'::jsonb;
  end if;

  -- Drop credential fields submitted by older planner clients.
  previous_content := previous_content #- '{settings,school_password}' #- '{settings,schoolCredentials}';
  incoming_content := incoming_content #- '{settings,school_password}' #- '{settings,schoolCredentials}';

  if new.legacy_content is null and new.content is not null then
    if tg_op = 'UPDATE' then
      new.legacy_content := coalesce(old.legacy_content, case when old.content is not null then previous_content else incoming_content end);
    else
      new.legacy_content := incoming_content;
    end if;
  end if;
  if jsonb_typeof(new.legacy_content) = 'object' then
    new.legacy_content := new.legacy_content #- '{settings,school_password}' #- '{settings,schoolCredentials}';
  end if;

  detected_writer := case
    when incoming_content ? 'schemaVersion'
      or incoming_content ? 'requirementSets'
      or incoming_content ? 'pendingRequirements'
      or incoming_content ? 'historyRecords'
      then 'web'
    else 'legacy_client'
  end;

  merged_content := previous_content || incoming_content;
  new.content := merged_content || jsonb_build_object(
    'schemaVersion', 2,
    'semesters', coalesce(incoming_content->'semesters', previous_content->'semesters', '[]'::jsonb),
    'targets', coalesce(incoming_content->'targets', previous_content->'targets', '{}'::jsonb),
    'settings', coalesce(incoming_content->'settings', previous_content->'settings', '{}'::jsonb),
    'requirementSets', coalesce(incoming_content->'requirementSets', previous_content->'requirementSets', '[]'::jsonb),
    'pendingRequirements', coalesce(incoming_content->'pendingRequirements', previous_content->'pendingRequirements', '[]'::jsonb),
    'historyRecords', coalesce(incoming_content->'historyRecords', previous_content->'historyRecords', '[]'::jsonb)
  );
  new.content_version := 2;
  new.migrated_at := coalesce(new.migrated_at, timezone('utc', now()));

  if tg_op = 'INSERT'
    or new.last_writer is null
    or (
      tg_op = 'UPDATE'
      and new.content is distinct from old.content
      and new.last_writer is not distinct from old.last_writer
    ) then
    new.last_writer := detected_writer;
  end if;

  return new;
end;
$$;

revoke execute on function public.normalize_user_data_content_v2() from public, anon, authenticated;

drop trigger if exists trg_user_data_normalize_content_v2 on public.user_data;
create trigger trg_user_data_normalize_content_v2
  before insert or update on public.user_data
  for each row execute function public.normalize_user_data_content_v2();

alter table public.user_data enable row level security;
grant select, insert, update on public.user_data to authenticated;
drop policy if exists "使用者只能查閱自己的資料" on public.user_data;
drop policy if exists "使用者只能新增自己的資料" on public.user_data;
drop policy if exists "使用者只能更新自己的資料" on public.user_data;
create policy "使用者只能查閱自己的資料" on public.user_data for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "使用者只能新增自己的資料" on public.user_data for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "使用者只能更新自己的資料" on public.user_data for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------- sync snapshots (service role only)
create table if not exists public.schedule_sync_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  school_account text not null,
  student_name text,
  payload jsonb not null,
  synced_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  constraint schedule_sync_snapshots_pkey primary key (user_id, profile_key)
);
create index if not exists schedule_sync_snapshots_synced_at_idx on public.schedule_sync_snapshots using btree (synced_at desc);

create table if not exists public.history_import_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  school_account text not null,
  student_name text,
  payload jsonb not null,
  imported_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  constraint history_import_snapshots_pkey primary key (user_id, profile_key)
);
create index if not exists history_import_snapshots_imported_at_idx on public.history_import_snapshots using btree (imported_at desc);

create table if not exists public.moodle_assignment_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  school_account text not null,
  payload jsonb not null,
  synced_at timestamptz default timezone('utc'::text, now()) not null,
  updated_at timestamptz default timezone('utc'::text, now()) not null,
  constraint moodle_assignment_snapshots_pkey primary key (user_id, profile_key)
);
create index if not exists moodle_assignment_snapshots_synced_at_idx on public.moodle_assignment_snapshots using btree (synced_at desc);

do $$
declare t text;
begin
  foreach t in array array['schedule_sync_snapshots','history_import_snapshots','moodle_assignment_snapshots'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "service role only" on public.%I', t);
    execute format('create policy "service role only" on public.%I for all using ((select auth.role()) = ''service_role'') with check ((select auth.role()) = ''service_role'')', t);
    execute format('drop trigger if exists trg_%s_updated_at on public.%I', t, t);
    execute format('create trigger trg_%s_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select, insert, update on public.%I to service_role', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- app_private (service role only)
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;
