from __future__ import annotations

from pathlib import Path


def migration_sql(filename: str) -> str:
    return Path("supabase/migrations", filename).read_text()


def test_school_credentials_migration_keeps_plaintext_for_backend_promotion() -> None:
    sql = migration_sql("20260612181431_add_school_credentials_table.sql")

    assert "- 'school_password'" not in sql
    assert "backend promotes and removes it" in sql


def test_school_credentials_private_migration_moves_public_rows_to_private_schema() -> None:
    sql = migration_sql("20260613130302_move_school_credentials_private.sql")

    assert "create table if not exists app_private.school_credentials" in sql
    assert "from public.school_credentials" in sql
    assert "delete from public.school_credentials" in sql
    assert "security invoker" in sql
    assert "security definer" not in sql.lower()
    assert "grant execute on function public.get_school_credentials(uuid) to service_role" in sql
    assert "revoke all on function public.get_school_credentials(uuid) from public, anon, authenticated" in sql


def test_remove_legacy_school_password_migration_clears_content_and_legacy_content() -> None:
    sql = migration_sql("20260613031804_remove_legacy_school_password_from_user_data.sql")

    assert "content #>> '{settings,school_password}'" in sql
    assert "legacy_content #>> '{settings,school_password}'" in sql
    assert "- 'school_password'" in sql
    assert "- 'schoolCredentials'" in sql


def test_typed_planner_schema_foundation_is_additive() -> None:
    sql = migration_sql("20260614211338_add_typed_planner_schema_foundation.sql").lower()

    assert "create table if not exists public.planner_profiles" in sql
    assert "create table if not exists public.selection_candidates" in sql
    assert "create table if not exists public.course_offerings" in sql
    assert "legacy public.user_data.content remains production truth until cutover" in sql
    assert "drop table" not in sql
    assert "truncate table" not in sql
