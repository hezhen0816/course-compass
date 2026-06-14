begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

create table if not exists public.planner_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_key text not null,
  display_name text,
  school_account text,
  settings jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, profile_key)
);

create table if not exists public.academic_terms (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.planner_profiles(id) on delete cascade,
  term_code text not null,
  term_label text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (profile_id, term_code)
);

create table if not exists public.planner_courses (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.academic_terms(id) on delete cascade,
  course_no text,
  course_name text not null,
  credits numeric(4, 1),
  requirement_category text,
  require_option text,
  department_code text,
  teacher text,
  status text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.course_meetings (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.planner_courses(id) on delete cascade,
  weekday smallint,
  period text,
  room text,
  raw_time text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.course_details (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.planner_courses(id) on delete cascade,
  detail_key text not null,
  detail_value jsonb not null default 'null'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (course_id, detail_key)
);

create table if not exists public.grading_items (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.planner_courses(id) on delete cascade,
  item_name text not null,
  weight numeric(6, 3),
  score numeric(6, 2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.requirement_sets (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.planner_profiles(id) on delete cascade,
  name text not null,
  program_type text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.requirements (
  id uuid primary key default gen_random_uuid(),
  requirement_set_id uuid not null references public.requirement_sets(id) on delete cascade,
  name text not null,
  category text,
  required_credits numeric(5, 1),
  required_count integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.requirement_options (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.requirements(id) on delete cascade,
  option_group text,
  name text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.requirement_option_courses (
  id uuid primary key default gen_random_uuid(),
  requirement_option_id uuid not null references public.requirement_options(id) on delete cascade,
  course_no text,
  course_name text not null,
  credits numeric(4, 1),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.academic_history_records (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.planner_profiles(id) on delete cascade,
  term_code text,
  course_no text,
  course_name text not null,
  credits numeric(4, 1),
  grade text,
  requirement_category text,
  passed boolean,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.selection_plans (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.planner_profiles(id) on delete cascade,
  term_code text not null,
  phase text not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (profile_id, term_code, phase)
);

create table if not exists public.selection_candidates (
  id uuid primary key default gen_random_uuid(),
  selection_plan_id uuid not null references public.selection_plans(id) on delete cascade,
  course_no text,
  course_name text not null,
  credits numeric(4, 1),
  require_option text,
  department_code text,
  teacher text,
  status text,
  list_type text,
  gpa numeric(3, 2),
  gpa_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.selection_priorities (
  id uuid primary key default gen_random_uuid(),
  selection_plan_id uuid not null references public.selection_plans(id) on delete cascade,
  selection_candidate_id uuid not null references public.selection_candidates(id) on delete cascade,
  priority integer not null,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (selection_plan_id, priority)
);

create table if not exists public.official_selection_cache (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.planner_profiles(id) on delete cascade,
  school_account text,
  term_code text,
  payload jsonb not null,
  synced_at timestamptz not null default timezone('utc', now()),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.course_offerings (
  id uuid primary key default gen_random_uuid(),
  term_code text not null,
  course_no text not null,
  course_name text not null,
  department_code text,
  credits numeric(4, 1),
  require_option text,
  teacher text,
  capacity_current integer,
  capacity_limit integer,
  notes text,
  gpa numeric(3, 2),
  gpa_status text,
  source text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (term_code, course_no)
);

create table if not exists public.course_offering_meetings (
  id uuid primary key default gen_random_uuid(),
  course_offering_id uuid not null references public.course_offerings(id) on delete cascade,
  weekday smallint,
  period text,
  room text,
  raw_slot text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.sync_runs (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.planner_profiles(id) on delete set null,
  sync_type text not null,
  status text not null,
  source text,
  started_at timestamptz not null default timezone('utc', now()),
  finished_at timestamptz,
  error_message text,
  payload_summary jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists academic_terms_profile_id_idx on public.academic_terms (profile_id);
create index if not exists planner_courses_term_id_idx on public.planner_courses (term_id);
create index if not exists planner_courses_course_no_idx on public.planner_courses (course_no);
create index if not exists course_meetings_course_id_idx on public.course_meetings (course_id);
create index if not exists requirement_sets_profile_id_idx on public.requirement_sets (profile_id);
create index if not exists requirements_requirement_set_id_idx on public.requirements (requirement_set_id);
create index if not exists academic_history_records_profile_id_idx on public.academic_history_records (profile_id);
create index if not exists selection_plans_profile_id_idx on public.selection_plans (profile_id);
create index if not exists selection_candidates_plan_id_idx on public.selection_candidates (selection_plan_id);
create index if not exists official_selection_cache_profile_id_idx on public.official_selection_cache (profile_id);
create index if not exists course_offerings_term_course_idx on public.course_offerings (term_code, course_no);
create index if not exists course_offering_meetings_offering_id_idx on public.course_offering_meetings (course_offering_id);
create index if not exists sync_runs_profile_id_started_at_idx on public.sync_runs (profile_id, started_at desc);

drop trigger if exists trg_planner_profiles_updated_at on public.planner_profiles;
create trigger trg_planner_profiles_updated_at
before update on public.planner_profiles
for each row execute function public.set_updated_at();

drop trigger if exists trg_academic_terms_updated_at on public.academic_terms;
create trigger trg_academic_terms_updated_at
before update on public.academic_terms
for each row execute function public.set_updated_at();

drop trigger if exists trg_planner_courses_updated_at on public.planner_courses;
create trigger trg_planner_courses_updated_at
before update on public.planner_courses
for each row execute function public.set_updated_at();

drop trigger if exists trg_course_meetings_updated_at on public.course_meetings;
create trigger trg_course_meetings_updated_at
before update on public.course_meetings
for each row execute function public.set_updated_at();

drop trigger if exists trg_course_details_updated_at on public.course_details;
create trigger trg_course_details_updated_at
before update on public.course_details
for each row execute function public.set_updated_at();

drop trigger if exists trg_grading_items_updated_at on public.grading_items;
create trigger trg_grading_items_updated_at
before update on public.grading_items
for each row execute function public.set_updated_at();

drop trigger if exists trg_requirement_sets_updated_at on public.requirement_sets;
create trigger trg_requirement_sets_updated_at
before update on public.requirement_sets
for each row execute function public.set_updated_at();

drop trigger if exists trg_requirements_updated_at on public.requirements;
create trigger trg_requirements_updated_at
before update on public.requirements
for each row execute function public.set_updated_at();

drop trigger if exists trg_requirement_options_updated_at on public.requirement_options;
create trigger trg_requirement_options_updated_at
before update on public.requirement_options
for each row execute function public.set_updated_at();

drop trigger if exists trg_requirement_option_courses_updated_at on public.requirement_option_courses;
create trigger trg_requirement_option_courses_updated_at
before update on public.requirement_option_courses
for each row execute function public.set_updated_at();

drop trigger if exists trg_academic_history_records_updated_at on public.academic_history_records;
create trigger trg_academic_history_records_updated_at
before update on public.academic_history_records
for each row execute function public.set_updated_at();

drop trigger if exists trg_selection_plans_updated_at on public.selection_plans;
create trigger trg_selection_plans_updated_at
before update on public.selection_plans
for each row execute function public.set_updated_at();

drop trigger if exists trg_selection_candidates_updated_at on public.selection_candidates;
create trigger trg_selection_candidates_updated_at
before update on public.selection_candidates
for each row execute function public.set_updated_at();

drop trigger if exists trg_selection_priorities_updated_at on public.selection_priorities;
create trigger trg_selection_priorities_updated_at
before update on public.selection_priorities
for each row execute function public.set_updated_at();

drop trigger if exists trg_official_selection_cache_updated_at on public.official_selection_cache;
create trigger trg_official_selection_cache_updated_at
before update on public.official_selection_cache
for each row execute function public.set_updated_at();

drop trigger if exists trg_course_offerings_updated_at on public.course_offerings;
create trigger trg_course_offerings_updated_at
before update on public.course_offerings
for each row execute function public.set_updated_at();

drop trigger if exists trg_course_offering_meetings_updated_at on public.course_offering_meetings;
create trigger trg_course_offering_meetings_updated_at
before update on public.course_offering_meetings
for each row execute function public.set_updated_at();

drop trigger if exists trg_sync_runs_updated_at on public.sync_runs;
create trigger trg_sync_runs_updated_at
before update on public.sync_runs
for each row execute function public.set_updated_at();

alter table public.planner_profiles enable row level security;
alter table public.academic_terms enable row level security;
alter table public.planner_courses enable row level security;
alter table public.course_meetings enable row level security;
alter table public.course_details enable row level security;
alter table public.grading_items enable row level security;
alter table public.requirement_sets enable row level security;
alter table public.requirements enable row level security;
alter table public.requirement_options enable row level security;
alter table public.requirement_option_courses enable row level security;
alter table public.academic_history_records enable row level security;
alter table public.selection_plans enable row level security;
alter table public.selection_candidates enable row level security;
alter table public.selection_priorities enable row level security;
alter table public.official_selection_cache enable row level security;
alter table public.course_offerings enable row level security;
alter table public.course_offering_meetings enable row level security;
alter table public.sync_runs enable row level security;

drop policy if exists "service role only" on public.planner_profiles;
create policy "service role only" on public.planner_profiles for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.academic_terms;
create policy "service role only" on public.academic_terms for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.planner_courses;
create policy "service role only" on public.planner_courses for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.course_meetings;
create policy "service role only" on public.course_meetings for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.course_details;
create policy "service role only" on public.course_details for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.grading_items;
create policy "service role only" on public.grading_items for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.requirement_sets;
create policy "service role only" on public.requirement_sets for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.requirements;
create policy "service role only" on public.requirements for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.requirement_options;
create policy "service role only" on public.requirement_options for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.requirement_option_courses;
create policy "service role only" on public.requirement_option_courses for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.academic_history_records;
create policy "service role only" on public.academic_history_records for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.selection_plans;
create policy "service role only" on public.selection_plans for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.selection_candidates;
create policy "service role only" on public.selection_candidates for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.selection_priorities;
create policy "service role only" on public.selection_priorities for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.official_selection_cache;
create policy "service role only" on public.official_selection_cache for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.course_offerings;
create policy "service role only" on public.course_offerings for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.course_offering_meetings;
create policy "service role only" on public.course_offering_meetings for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

drop policy if exists "service role only" on public.sync_runs;
create policy "service role only" on public.sync_runs for all
using ((select auth.role()) = 'service_role') with check ((select auth.role()) = 'service_role');

revoke all on table public.planner_profiles from anon, authenticated;
revoke all on table public.academic_terms from anon, authenticated;
revoke all on table public.planner_courses from anon, authenticated;
revoke all on table public.course_meetings from anon, authenticated;
revoke all on table public.course_details from anon, authenticated;
revoke all on table public.grading_items from anon, authenticated;
revoke all on table public.requirement_sets from anon, authenticated;
revoke all on table public.requirements from anon, authenticated;
revoke all on table public.requirement_options from anon, authenticated;
revoke all on table public.requirement_option_courses from anon, authenticated;
revoke all on table public.academic_history_records from anon, authenticated;
revoke all on table public.selection_plans from anon, authenticated;
revoke all on table public.selection_candidates from anon, authenticated;
revoke all on table public.selection_priorities from anon, authenticated;
revoke all on table public.official_selection_cache from anon, authenticated;
revoke all on table public.course_offerings from anon, authenticated;
revoke all on table public.course_offering_meetings from anon, authenticated;
revoke all on table public.sync_runs from anon, authenticated;

grant select, insert, update, delete on table public.planner_profiles to service_role;
grant select, insert, update, delete on table public.academic_terms to service_role;
grant select, insert, update, delete on table public.planner_courses to service_role;
grant select, insert, update, delete on table public.course_meetings to service_role;
grant select, insert, update, delete on table public.course_details to service_role;
grant select, insert, update, delete on table public.grading_items to service_role;
grant select, insert, update, delete on table public.requirement_sets to service_role;
grant select, insert, update, delete on table public.requirements to service_role;
grant select, insert, update, delete on table public.requirement_options to service_role;
grant select, insert, update, delete on table public.requirement_option_courses to service_role;
grant select, insert, update, delete on table public.academic_history_records to service_role;
grant select, insert, update, delete on table public.selection_plans to service_role;
grant select, insert, update, delete on table public.selection_candidates to service_role;
grant select, insert, update, delete on table public.selection_priorities to service_role;
grant select, insert, update, delete on table public.official_selection_cache to service_role;
grant select, insert, update, delete on table public.course_offerings to service_role;
grant select, insert, update, delete on table public.course_offering_meetings to service_role;
grant select, insert, update, delete on table public.sync_runs to service_role;

comment on table public.planner_profiles is 'Typed planner profile root. Created as additive refactor foundation; legacy public.user_data.content remains production truth until cutover.';
comment on table public.academic_terms is 'Typed academic term rows derived from planner payload semesters.';
comment on table public.planner_courses is 'Typed planned course rows derived from planner semester courses.';
comment on table public.course_meetings is 'Typed course meeting slots for timetable and conflict checks.';
comment on table public.course_details is 'Key-value extension table for course details that do not yet have stable typed columns.';
comment on table public.grading_items is 'Typed grading items for planned or historical course score breakdowns.';
comment on table public.requirement_sets is 'Typed requirement set roots for major, double major, minor, and imported requirement plans.';
comment on table public.requirements is 'Typed requirement categories and credit/count rules.';
comment on table public.requirement_options is 'Typed selectable requirement option groups.';
comment on table public.requirement_option_courses is 'Typed course options attached to requirement options.';
comment on table public.academic_history_records is 'Typed historical course records imported from official academic history.';
comment on table public.selection_plans is 'Typed selection planning root by profile, term, and phase.';
comment on table public.selection_candidates is 'Typed official/manual selection candidates, including waitlist and add-sign planning entries.';
comment on table public.selection_priorities is 'Typed official selection priority order.';
comment on table public.official_selection_cache is 'Service-role official selection cache. Does not store credentials, session cookies, or GPA API tokens.';
comment on table public.course_offerings is 'Typed course query cache by term and course number.';
comment on table public.course_offering_meetings is 'Typed course offering meeting slots from the official course query system.';
comment on table public.sync_runs is 'Typed sync execution log replacing scattered snapshot metadata over time.';

commit;
