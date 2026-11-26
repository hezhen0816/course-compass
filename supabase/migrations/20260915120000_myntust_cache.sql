-- myNTUST GPA 與授課歷史不屬於個別使用者，只需保留 24 小時的新鮮度。
-- 落地到 app_private 可避免後端重啟後再次大量請求 myNTUST。
create table if not exists app_private.myntust_grade_cache (
  course_no text primary key,
  status text not null,
  gpa numeric,
  semester integer,
  students integer,
  distribution jsonb,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists app_private.myntust_history_cache (
  course_name text primary key,
  rows jsonb not null,
  fetched_at timestamptz not null default now(),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

alter table app_private.myntust_grade_cache enable row level security;
drop policy if exists myntust_grade_cache_service_role_only on app_private.myntust_grade_cache;
create policy myntust_grade_cache_service_role_only on app_private.myntust_grade_cache for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

alter table app_private.myntust_history_cache enable row level security;
drop policy if exists myntust_history_cache_service_role_only on app_private.myntust_history_cache;
create policy myntust_history_cache_service_role_only on app_private.myntust_history_cache for all
  using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop trigger if exists trg_myntust_grade_cache_updated_at on app_private.myntust_grade_cache;
create trigger trg_myntust_grade_cache_updated_at before update on app_private.myntust_grade_cache
  for each row execute function public.set_updated_at();
drop trigger if exists trg_myntust_history_cache_updated_at on app_private.myntust_history_cache;
create trigger trg_myntust_history_cache_updated_at before update on app_private.myntust_history_cache
  for each row execute function public.set_updated_at();

revoke all on app_private.myntust_grade_cache, app_private.myntust_history_cache from public, anon, authenticated;
grant select, insert, update, delete on app_private.myntust_grade_cache, app_private.myntust_history_cache to service_role;

create or replace function public.get_myntust_cache(p_kind text, p_keys text[])
returns setof jsonb
language sql
security definer
set search_path to ''
as $$
  select pg_catalog.to_jsonb(c)
  from app_private.myntust_grade_cache as c
  where p_kind = 'grade'
    and c.course_no = any(coalesce(p_keys, array[]::text[]))
    and c.fetched_at >= now() - interval '24 hours'
  union all
  select pg_catalog.to_jsonb(c)
  from app_private.myntust_history_cache as c
  where p_kind = 'history'
    and c.course_name = any(coalesce(p_keys, array[]::text[]))
    and c.fetched_at >= now() - interval '24 hours';
$$;

create or replace function public.upsert_myntust_grade(
  p_course_no text, p_status text, p_gpa numeric, p_semester integer,
  p_students integer, p_distribution jsonb)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into app_private.myntust_grade_cache
    (course_no, status, gpa, semester, students, distribution, fetched_at)
  values
    (p_course_no, p_status, p_gpa, p_semester, p_students, p_distribution, now())
  on conflict (course_no) do update
  set status = excluded.status,
      gpa = excluded.gpa,
      semester = excluded.semester,
      students = excluded.students,
      distribution = excluded.distribution,
      fetched_at = excluded.fetched_at;
$$;

create or replace function public.upsert_myntust_history(p_course_name text, p_rows jsonb)
returns void
language sql
security definer
set search_path to ''
as $$
  insert into app_private.myntust_history_cache (course_name, rows, fetched_at)
  values (p_course_name, p_rows, now())
  on conflict (course_name) do update
  set rows = excluded.rows,
      fetched_at = excluded.fetched_at;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.get_myntust_cache(text, text[])',
    'public.upsert_myntust_grade(text, text, numeric, integer, integer, jsonb)',
    'public.upsert_myntust_history(text, jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
