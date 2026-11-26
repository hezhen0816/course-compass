-- 每日監控時段：worker 只在這個時段內查課程人數，時段外整輪跳過（完全不打學校），
-- 心跳照常，所以儀表板仍看得到 Worker 在線。兩欄都留空＝全天監控（維持舊行為）。
-- 支援跨午夜，例如 08:00–02:00。時間以台灣時間解讀。
alter table public.user_settings
  add column if not exists monitor_window_start time,
  add column if not exists monitor_window_end time;

-- check_interval 的單位是毫秒（前端滑桿與 worker 都當 ms 用），但 baseline 的預設值寫成 30，
-- 新帳號一建立就是 30 毫秒；2026-09-16 實測有帳號因此每 1–5 秒打一次學校。預設改成 30 秒。
-- 既有資料不在這裡動：worker 端已有 15 秒硬下限，要不要改回寫由使用者決定。
alter table public.user_settings alter column check_interval set default 30000;
