# 資料庫結構

`supabase/migrations/` 是建立新資料庫時的結構來源。

| 結構 | 作用 |
| --- | --- |
| `public.user_data` | 每個 Supabase 使用者一列規劃資料，`content` 為 JSONB，包含學期、修課紀錄、學分目標與門檻。列級安全性依 `auth.uid()` 限制存取 |
| `public.*_snapshots` | 同步後的課表、歷年修課與 Moodle 資料。後端以 Supabase 使用者 ID 及 `profile_key` 讀寫，只開放給 service role |
| `public.monitored_courses`、`public.user_settings`、`public.system_logs`、`public.email_test_requests` | 名額監聽、個人通知設定、日誌與測試信請求 |
| `app_private.gpa_api_keys` | 經後端加密的 myNTUST API 金鑰，透過 service-role-only RPC 存取 |
| `app_private.myntust_*_cache` | GPA 與查詢資料快取 |
