alter function public.set_updated_at() set search_path = public, pg_catalog;

create index if not exists grading_items_course_id_idx
  on public.grading_items (course_id);

create index if not exists requirement_options_requirement_id_idx
  on public.requirement_options (requirement_id);

create index if not exists requirement_option_courses_requirement_option_id_idx
  on public.requirement_option_courses (requirement_option_id);

create index if not exists selection_priorities_selection_candidate_id_idx
  on public.selection_priorities (selection_candidate_id);
