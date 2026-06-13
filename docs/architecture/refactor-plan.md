# Course Compass Refactor Plan

狀態：進行中
更新：2026-06-13

本文件是目前仍有效的重構執行計畫。舊版產品定位與 UX audit 已移到 `docs/archive/2026-refactor/`，只作為歷史脈絡。

## 目標

- Web 與 iOS 保持各自適合的互動流程，但共用同一套資料規則與 backend API。
- 校務帳密與官方選課 session 只由 backend 持有、加密與使用。
- 官方選課操作必須由使用者明確確認後單次送出；不做自動搶課、名額輪詢、自動重試或排程送出。
- `public.user_data.content` 從主要資料來源逐步降級為 legacy payload，最終改由 typed tables 與 domain API 承擔主要讀寫。

## 已完成

- Backend official selection API 已支援 sync、keep-alive、join、add-to-waitlist、remove、reorder。
- Mutating official selection API 需要 `confirmed: true`。
- 校務密碼已移到 `app_private.school_credentials`，以 server-side key 加密，不回傳給 Web/iOS。
- 官方選課 session 已移到 `app_private.school_sessions`，以 server-side key 加密。
- Legacy `user_data.content.settings.school_password` production plaintext 已清除。
- Backend 已改用 Supabase Auth `/auth/v1/user` 驗證 access token，不再本地 decode JWT payload 當作身份驗證。
- Backend route handlers 已拆到 `backend/api/*`，校務 session/context helper 已拆到 `backend/services/session_context.py`。
- NTUST、Moodle、官方選課、課表與 TR 查詢 client/parser 已拆到 `backend/integrations/*`，舊 `backend/*.py` import 路徑暫時保留相容 wrapper。
- 官方選課 session 的 Supabase RPC row 存取已開始集中到 `backend/repositories/school_sessions.py`，加解密與 TTL 仍保留在 `backend/school_sessions.py`。
- 課表、歷史、Moodle snapshot 的 Supabase REST row 存取已集中到 `backend/repositories/snapshots.py`，快照相容 wrapper 與課表 entry 正規化仍保留在 `backend/snapshots.py`。
- 校務帳密 private RPC row 存取已集中到 `backend/repositories/credentials.py`，加解密、Auth token 驗證與 legacy promotion 還保留在 `backend/credentials.py`。
- Production Railway backend 與 Vercel web 已可部署並驗證 official selection capability。

## 目前架構

```text
backend/
  app.py                 # FastAPI app setup and router wiring
  api/
    courses.py           # course semester/search routes
    health.py            # health route
    official_selection.py # official A02 sync, keep-alive, and confirmed action routes
    planner.py           # planner PDF import route
    school_credentials.py # school credential status/save/delete routes
    sync.py              # schedule, history, and Moodle sync/snapshot routes
    tr_rooms.py          # TR room status route
  integrations/
    history.py           # academic history parser/client
    moodle.py            # Moodle assignments sync
    ntust_common.py      # shared NTUST SSO/form helpers
    official_selection.py # official A02 parser/client/action helpers
    schedule.py          # school schedule sync parser/client
    tr_rooms.py          # course query and room status helpers
  services/
    session_context.py   # backend-owned credential/session context helpers
  repositories/
    credentials.py      # Supabase RPC access for encrypted school credential rows
    school_sessions.py   # Supabase RPC access for encrypted official session rows
    snapshots.py         # Supabase REST access for schedule/history/Moodle snapshot rows
  credentials.py         # app_private.school_credentials access and encryption
  school_sessions.py     # app_private.school_sessions access and encryption
  official_selection.py  # compatibility wrapper; remove after imports migrate
  schedule.py            # compatibility wrapper; remove after imports migrate
  history.py             # compatibility wrapper; remove after imports migrate
  moodle.py              # compatibility wrapper; remove after imports migrate
  tr_rooms.py            # compatibility wrapper; remove after imports migrate
web/src/
  features/              # feature-level UI and hooks
  hooks/useCourseData.ts # current user_data.content compatibility layer
ios/App/App/
  ...                    # native app; still compatible with current shared payload
supabase/migrations/
  ...                    # private credential/session migrations and legacy cleanup
```

## Planned Target Layout

```text
backend/
  api/              # FastAPI route modules: auth, planner, courses, sync, official_selection
  core/             # config, security, time, errors
  integrations/     # ntust, moodle, course_query, official_selection parsers/clients
  repositories/     # Supabase/Postgres data access
  services/         # planner sync, credential, session, migration services
  schemas/          # Pydantic request/response models
web/src/
  app/              # app shell, routing, providers
  features/         # course-search, selection, graduation, history, settings
  shared/           # reusable UI, api client, hooks, utils
ios/App/App/
  Features/
  Services/
  Models/
  Stores/
docs/
  architecture/
  data-contracts/
  archive/2026-refactor/
tests/
  backend/
  fixtures/
```

## Execution Order

1. Keep the current production lane green.
   - Verify: `npm run check`, production backend verifier, Railway/Vercel commit checks.
2. Finish low-risk structure cleanup.
   - Move historical docs and reference images into `docs/archive/2026-refactor/`.
   - Move long-lived test fixtures into `tests/fixtures/`.
3. Split backend responsibilities without changing API behavior.
   - Route handlers are now in `backend/api/*`; keep shrinking `backend/app.py` to setup/wiring only.
   - Parsing/client code is now in `backend/integrations/*`; retire compatibility wrappers after internal imports settle.
   - Move Supabase reads/writes into `backend/repositories/*`; school credential, school session, and snapshot row access have started.
   - Keep compatibility imports while tests are being migrated.
4. Add typed table migrations behind a backup-first cutover.
   - Create full `user_data_refactor_backup` before any destructive change.
   - Preserve unknown JSON fields in metadata columns.
   - Produce a row-count reconciliation report before production cutover.
5. Move Web/iOS reads and writes to typed APIs.
   - `public.user_data.content` remains available for one release as rollback/legacy data.
   - Remove whole-payload upsert paths only after Web/iOS compatibility checks pass.

## Non-Goals

- No background scheduled login.
- No automatic official selection submission.
- No frontend or iOS access to service-role secrets.
- No immediate drop of legacy `public.user_data.content`.

## Required Gates

```bash
npm run web:lint
npm run web:build
npm run backend:check
npm run ios:build
npm run check
```

Production gates:

```bash
bash scripts/python.sh scripts/verify_production_backend.py
curl -fsS https://course-planner-backend-production.up.railway.app/health
```
