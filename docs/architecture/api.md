# API 與授權

FastAPI 的根路徑 `/docs` 提供 OpenAPI 介面，`/healthz` 提供就緒檢查。部署 Web 時以 `CORS_ORIGINS` 設定跨來源白名單。

| 路徑 | 用途 |
| --- | --- |
| `/api/courses/*` | 課程及學期查詢。登入後可選用個人的 myNTUST 金鑰 |
| `/api/schedule/sync`、`/api/history/import`、`/api/moodle/assignments/sync` | 使用者輸入校務帳密後同步資料 |
| `/api/schedule/{profile_key}`、`/api/history/{profile_key}`、`/api/moodle/assignments/{profile_key}` | 讀取目前 Supabase 使用者對應的同步快照 |
| `/api/official-selection/a02/*` | 初選同步及經使用者確認的選課操作 |
| `/api/planner/import-requirements/pdf`、`/api/planner/solve` | PDF 匯入與多學期排課求解 |
| `/api/gpa-api-key` | 管理個人的 myNTUST 金鑰，狀態回應只回傳是否已設定與是否啟用 |

校務同步與選課需要有效的 Supabase bearer token。同步時如指定 `profile_key`，須與此次登入校務帳號相同。選課 session 依使用者與校務帳號區分，保留在 API 程序記憶體。
