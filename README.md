# Course Compass 修課羅盤 Workspace

這個 repo 明確分成兩條產品線與三個共享支援區：

- `web/`：React + Vite 的課程與學分規劃 Web 版
- `ios/`：SwiftUI 原生 iPhone App
- `backend/`：Python 同步服務
- `supabase/`：migration 與資料庫結構
- `test_artifacts/`：測試素材與校務頁面樣本

`backend/`、`supabase/`、`test_artifacts/` 都維持在根目錄，方便兩端共用。

## 目錄角色

### Web

- 專注在大螢幕操作最有價值的流程
- 提供課程規劃、HTML 匯入、學分門檻設定、課程細節與成績試算
- 使用雲端帳號保存 `public.user_data`

詳細說明在 [web/README.md](/Users/hezhen/Project/course_planner/web/README.md)。

### iOS

- 原生 SwiftUI App
- 提供首頁摘要、每週課表、手機版學分規劃與設定
- 額外串接同步服務，從校務系統抓課表與歷史修課紀錄

詳細說明在 [ios/README.md](/Users/hezhen/Project/course_planner/ios/README.md)。

### Backend

- `FastAPI` 提供課表同步與歷史修課匯入 API
- 以校務帳密登入校務系統抓資料
- 將同步結果寫入 `schedule_sync_snapshots` 與 `history_import_snapshots`
- 入口仍是 `backend/app.py`；SSO/課表、Moodle、TR 空教室、Supabase snapshot 存取已拆成 backend 內部模組

### Supabase

- Web 與 iOS 共用同一個 Supabase 專案
- 學分規劃存於 `public.user_data`
- iOS 額外的同步快照由後端寫入
- Web/backend 的校務帳密保存改由 `public.school_credentials` 保存加密密文，並只開放 `service_role` 存取
- `user_data.content.settings` 目前使用的欄位鍵：
  - `school_account`
  - `reminder_minutes`
  - `school_password` 僅視為舊 iOS 相容欄位，後續 iOS 重構應移除

### Test Artifacts

- `test_artifacts/course_selection/`：課表與選課頁樣本
- `test_artifacts/edu_need_history/`：歷史修課紀錄頁樣本

## 開發指令

### 根目錄總控

```bash
npm run web:dev
npm run dev:all
npm run web:build
npm run web:lint
npm run ios:open
npm run ios:build
npm run backend:dev
npm run backend:check
npm run check
```

`npm run dev:all` 會優先使用 repo `.venv/bin/python`，若不存在則使用 `/Users/hezhen/.venvs/course_planner/bin/python` 啟動 backend。

### Web 安裝

```bash
cd /Users/hezhen/Project/course_planner/web
npm install
```

Web 會從 repo 根目錄讀取 `.env`，不需要另外複製一份到 `web/`。

### Backend 安裝

```bash
cd /Users/hezhen/Project/course_planner
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements-dev.txt
cp .env.example .env
```

需要的環境變數：

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SCHOOL_CREDENTIALS_ENCRYPTION_SECRET=... # 建議使用 openssl rand -hex 32 產生
NTUST_VERIFY_SSL=false
```

說明：

- `VITE_SUPABASE_*` 給 Web 前端使用
- `SUPABASE_SERVICE_ROLE_KEY` 只給 Python 後端使用
- iOS 不應直接持有 `service_role`
- `SCHOOL_CREDENTIALS_ENCRYPTION_SECRET` 只給 Python 後端使用，用於加解密 `public.school_credentials.password_ciphertext`；不可使用 `.env.example` placeholder，長度需至少 32 字元
- Web 不會讀取或保存校務密碼明文；官方選課 session 過期時由後端使用已保存密文重新登入
- iOS 仍有舊版 `school_password` 相容欄位；SQL migration 不會直接刪除 plaintext，後端會在下一次 authenticated credential use 時加密遷移到 `public.school_credentials` 並清除舊欄位

資料表與快照 schema 在 [backend/supabase_schema.sql](/Users/hezhen/Project/course_planner/backend/supabase_schema.sql)，migration 在 [supabase/migrations](/Users/hezhen/Project/course_planner/supabase/migrations)。

## API

- `GET /api/school-credentials`：讀取校務帳密保存狀態，不回傳密碼
- `PUT /api/school-credentials`：由後端加密保存校務帳密
- `DELETE /api/school-credentials`：清除已保存校務帳密
- `POST /api/schedule/sync`：同步校務課表並保存快照
- `GET /api/schedule/{profile_key}`：讀取最新課表快照
- `POST /api/history/import`：匯入歷史修課紀錄並保存快照
- `GET /api/tr-rooms/status`：查詢目前或下一節 TR 教室使用狀態
- `POST /api/moodle/assignments/sync`：同步 Moodle 待繳事項快照
- `POST /api/official-selection/a02/*`：使用者明確確認後送出官方初選操作；不做自動搶課、輪詢或排程送出

## 驗證

```bash
npm run lint
npm run build
npm audit --prefix web --audit-level=moderate
npm run backend:check
npm run ios:build
```

`npm run check` 會串起 Web lint/build、backend check 與 iOS build，適合提交前使用。

## 維護原則

1. Web 與 iOS 不共用畫面與互動流程，只共用資料規則。
2. `backend/`、`supabase/`、`test_artifacts/` 維持根目錄，作為共享基礎設施。
3. 新功能優先先判斷屬於 Web 還是 iOS，再決定落點。
