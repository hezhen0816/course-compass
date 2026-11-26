-- 基本監控間隔的下限與預設 2026-09-16 由使用者裁示自 15 秒改為 5 秒
-- （worker 的 MIN_CHECK_INTERVAL_SECONDS 同步改成 5.0）。
-- 只改欄位預設值，不動既有資料：目前四個帳號都是 15000，要不要降由各自在設定頁決定。
alter table public.user_settings alter column check_interval set default 5000;
