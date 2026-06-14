# Migration Scripts

這個資料夾放本機手動執行的資料遷移維護腳本。

- `migrate_legacy_school_credentials.py`：將 legacy `user_data.content.settings.school_password` 或舊 `schoolCredentials.passwordCiphertext` 遷移到 `app_private.school_credentials`。

執行規則：

- 預設 dry-run，不寫資料。
- 只有明確加上 `--apply` 才會寫入資料庫。
- 需要 `.env` 中的 Supabase service role 與後端加密設定。
- 不屬於前後端 runtime，也不應接到 Vercel/Railway flow。
