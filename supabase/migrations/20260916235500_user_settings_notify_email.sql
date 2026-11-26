-- 自訂通知收件人。預設仍是該帳號的 Auth 登入信箱；worker 只在該使用者自己備有寄件憑證
-- （per-user SMTP 帳密或 Resend API Key）時才採用這個欄位，否則一律回退登入信箱——
-- 否則任何人都能把 worker 的全域寄件設定指向任意地址當跳板。
alter table public.user_settings
  add column if not exists notify_email text;
