-- 一次性資料修正（使用者 2026-09-16 同意）：把低於 worker 下限的 check_interval 拉到 15000ms。
-- worker 端本來就有 MIN_CHECK_INTERVAL_SECONDS = 15 的硬下限，所以這支不改變實際打學校的節奏，
-- 只是讓設定頁顯示的數字與實際行為一致（原本兩個閒置帳號顯示 1500ms 卻會跑 15 秒）。
update public.user_settings
   set check_interval = 15000
 where check_interval is null
    or check_interval < 15000;
