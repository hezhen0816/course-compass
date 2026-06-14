# Typed Planner Scripts

這個資料夾只放 typed planner 資料庫重構用的本機維護 CLI。

- `preview_backfill.py`：從本機 `public.user_data` JSON 匯出產生 typed table preview/package。
- `plan_backfill.py`：從 package 產生 no-write apply plan 或 PostgREST batch artifact。
- `dry_run_apply.py`：對 package 跑 repository dry-run 與 readiness checks。

這些工具不屬於前後端 runtime，不連 Supabase、不寫資料庫，也不應接到 Vercel/Railway flow。
