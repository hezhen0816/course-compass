# Course Compass Refactor Plan

狀態：進行中
更新：2026-06-14

本文件是目前仍有效的重構執行計畫。過時的產品定位、UX audit、reference images 與舊設計 QA 已從 repo 移除。

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
- NTUST、Moodle、官方選課、課表與 TR 查詢 client/parser 已拆到 `backend/integrations/*`，對應純 re-export wrapper 已移除。
- 官方選課 session 的 Supabase RPC row 存取已集中到 `backend/repositories/school_sessions.py`，加解密、TTL 與 repository wiring 已移到 `backend/services/school_session_store.py`。
- 課表、歷史、Moodle snapshot 的 Supabase REST row 存取已集中到 `backend/repositories/snapshots.py`，domain flow 已在 `backend/services/snapshots.py`，舊 `backend/snapshots.py` 已移除。
- 校務帳密 private RPC、Supabase Auth 與 `public.user_data` REST row 存取已開始集中到 `backend/repositories/credentials.py`，加解密與 Supabase header/config guard 已抽到 `backend/core/security.py`，legacy promotion runtime wiring 已移到 `backend/services/credential_store.py`。
- 共用設定與台北時間 helper 已移到 `backend/core/config.py` 與 `backend/core/time_utils.py`，舊 `backend/config.py`、`backend/time_utils.py` 已移除。
- 共用錯誤型別已移到 `backend/core/errors.py`，避免 service/API 反向依賴 credentials 過渡層。
- Pydantic request/response schemas 已移到 `backend/schemas/*` 並按 domain 拆分，舊 `backend/models.py` 與 `backend/schemas/models.py` 已移除。
- 官方選課 session 的加解密 payload、TTL、load/save/delete domain 流程已抽到 `backend/services/school_sessions.py`，runtime wiring 已移到 `backend/services/school_session_store.py`，舊 `backend/school_sessions.py` 已移除。
- 校務帳密狀態、legacy promotion、save/delete cleanup 流程已抽到 `backend/services/credentials.py`，舊 `backend/credentials.py` 已移除。
- 雙主修 PDF 需求解析已移到 `backend/services/planner_pdf.py`，舊 `backend/planner_pdf.py` 已移除。
- 課表、歷史、Moodle snapshot domain flow 已移到 `backend/services/snapshots.py`，舊 `backend/snapshots.py` 已移除。
- Production Railway backend 與 Vercel web 已可部署並驗證 official selection capability。
- 已建立 `docs/architecture/refactor-inventory.md` 作為重構盤點基準。
- 已建立 typed schema foundation migration：`supabase/migrations/20260614211338_add_typed_planner_schema_foundation.sql`。
- Supabase Auth 與 `public.user_data` REST 存取已開始移到 `backend/repositories/credentials.py`，credential runtime wiring 已移到 `backend/services/credential_store.py`。
- Typed planner apply 已有 service/repository 邊界：`backend/services/typed_planner/apply.py` 與 `backend/repositories/typed_planner.py` 可 dry-run 驗證 package、batch URL/header/body、row counts 與 apply readiness checks；受保護 execute 入口要求 `allow_writes=True` 與固定確認字串，目前尚未接 CLI/API/production flow。
- 資料庫 migration regression tests 已從大型 backend pure test 拆到 `tests/backend/test_database_migrations.py`，並補上 typed schema foundation additive gate。
- 課程查詢 endpoint regression tests 已從大型 backend pure test 拆到 `tests/backend/test_course_search_api.py`。
- PDF requirement parser regression tests 已從大型 backend pure test 拆到 `tests/backend/test_planner_pdf_service.py`。
- Snapshot repository/service regression tests 已從大型 backend pure test 拆到 `tests/backend/test_snapshots_service.py`。
- TR room parser/API regression tests 已從大型 backend pure test 拆到 `tests/backend/test_tr_rooms_api.py`。
- Moodle assignment 與 history parser regression tests 已從大型 backend pure test 拆到 `tests/backend/test_ntust_content_parsers.py`。
- 過時的 `docs/archive/2026-refactor/` 與 `docs/design/web_planning_workspace_qa.md` 已刪除，避免 repo 保留不再代表現況的文件與參考圖片。
- Health check 與 production backend verifier regression tests 已從大型 backend pure test 拆到 `tests/backend/test_health_and_production_verifier.py`。
- Schedule、history 與 Moodle sync API regression tests 已從大型 backend pure test 拆到 `tests/backend/test_sync_api.py`。
- Credential repository regression tests 已從大型 backend pure test 拆到 `tests/backend/test_credentials_repository.py`。
- School session store/repository regression tests 已從大型 backend pure test 拆到 `tests/backend/test_school_session_store.py`。
- Official selection client regression tests 已從大型 backend pure test 拆到 `tests/backend/test_official_selection_client.py`。
- Official selection API route regression tests 已從大型 backend pure test 拆到 `tests/backend/test_official_selection_api.py`。
- Credential store runtime regression tests 已從大型 backend pure test 拆到 `tests/backend/test_credential_store.py`。
- Legacy credential migration regression tests 已從大型 backend pure test 拆到 `tests/backend/test_legacy_credential_migration.py`。
- School credentials API regression test 已從大型 backend pure test 改名整理到 `tests/backend/test_school_credentials_api.py`，舊 `test_backend_pure.py` 已移除。
- Web 舊版 planner/sidebar/settings UI 元件已移除：`CourseModal`、`SettingsModal`、`SemesterGrid`、`Sidebar`、`ProgressBar`。
- Web app shell 元件已搬到 `web/src/app/`，修課軌跡課程詳情 modal 已搬到 `web/src/features/history/`。
- Web 共用 API client、Supabase client 與 planner constants 已搬到 `web/src/shared/`，未引用的舊 `parseCourselist.ts` 與 Vite 預設 `react.svg` 已移除。
- Web 跨頁 hooks `useAuth`、`useCourseData` 已搬到 `web/src/shared/hooks/`。
- Web shared types 已從 `web/src/types/index.ts` 搬到 `web/src/shared/types.ts`。
- Web 共用 domain helper 已從 `web/src/domain/` 搬到 `web/src/shared/domain/`。
- Web app implementation 已搬到 `web/src/app/CoursePlannerWebApp.tsx`，根層 `App.tsx` 只保留入口 re-export。
- Web global stylesheet 已從 `web/src/index.css` 搬到 `web/src/app/global.css`。
- 已建立 `docs/architecture/test-inventory.md`，把 backend tests 與 fixtures 分成必留、保守保留與可評估瘦身，避免在重構中誤刪 parser/API/DB 安全網。
- 已建立 typed planner backfill preview/package service `backend/services/typed_planner/backfill.py` 與 CLI wrapper `scripts/typed_planner/preview_backfill.py`，可離線拆解 `public.user_data.content`、輸出 typed table 對帳 counts，並產生本機 raw backup package；不連線、不寫 DB、不把敏感 token 放入 preview。
- 已建立 no-write typed planner apply plan builder，可從通過 contract/reconciliation 的 package 產生 table order 與 row count 計畫；仍不產生 SQL、不寫 DB。

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
    credentials.py       # school credential domain flow and legacy cleanup
    credential_store.py  # school credential runtime wiring, encryption, and repository adapters
    planner_pdf.py       # requirement PDF import parsing service
    school_session_store.py # official session runtime wiring, encryption, and repository adapters
    school_sessions.py   # official session domain flow, encryption payload, TTL helpers
    session_context.py   # backend-owned credential/session context helpers
    snapshots.py         # schedule/history/Moodle snapshot domain flow
    typed_planner/
      apply.py           # typed planner backfill apply dry-run service
      backfill.py        # offline typed planner preview/reconciliation service
  core/
    config.py            # backend settings, constants, NTUST/Supabase URLs
    errors.py            # shared backend exception types
    security.py          # secret validation, encryption, and Supabase header helpers
    time_utils.py        # timezone-aware clock helper
  schemas/
    courses.py           # course search schemas
    official_selection.py # official selection schemas
    planner.py           # requirement PDF import schemas
    school_credentials.py # school credential schemas
    sync.py              # schedule/history/Moodle sync schemas
    tr_rooms.py          # TR room status schemas
  repositories/
    credentials.py      # Supabase RPC access for encrypted school credential rows
    school_sessions.py   # Supabase RPC access for encrypted official session rows
    snapshots.py         # Supabase REST access for schedule/history/Moodle snapshot rows
    typed_planner.py     # typed planner backfill batch repository boundary
web/src/
  app/                   # app shell components
  features/              # feature-level UI and hooks
  shared/                # API client, Supabase client, constants, and cross-page hooks
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
tests/
  backend/
  fixtures/          # representative fixture outputs; capture scripts live in scripts/research/
  # 詳見 docs/architecture/test-inventory.md
```

## Execution Order

1. Keep the current local refactor lane green.
   - Verify per phase: `git diff --check`, `npm run backend:check`, `npm run web:lint`, `npm run web:build`.
   - Do not run production backend verifier, Railway checks, or Vercel checks during this refactor goal.
2. Finish low-risk structure cleanup.
   - Remove historical docs, reference images, and obsolete QA notes that no longer represent the current app.
   - Move long-lived test fixture outputs into `tests/fixtures/`; keep manual capture scripts in `scripts/research/`.
3. Split backend responsibilities without changing API behavior.
   - Route handlers are now in `backend/api/*`; keep shrinking `backend/app.py` to setup/wiring only.
   - Parsing/client code is now in `backend/integrations/*`; retire compatibility wrappers after internal imports settle.
   - Official selection parser regression tests are now isolated in `tests/backend/test_official_selection_parser.py`.
   - Official selection client regression tests are now isolated in `tests/backend/test_official_selection_client.py`.
   - Official selection API route regression tests are now isolated in `tests/backend/test_official_selection_api.py`.
   - Schedule helper regression tests are now isolated in `tests/backend/test_schedule_integration.py`.
   - Schedule/history/Moodle sync API regression tests are now isolated in `tests/backend/test_sync_api.py`.
   - Credential repository regression tests are now isolated in `tests/backend/test_credentials_repository.py`.
   - Credential store runtime regression tests are now isolated in `tests/backend/test_credential_store.py`.
   - Legacy credential migration regression tests are now isolated in `tests/backend/test_legacy_credential_migration.py`.
   - School credentials API regression test is now isolated in `tests/backend/test_school_credentials_api.py`, and the historical `test_backend_pure.py` file has been removed.
   - School session store/repository regression tests are now isolated in `tests/backend/test_school_session_store.py`.
   - Move Supabase reads/writes into `backend/repositories/*`; school credential, school session, and snapshot row access have started.
   - Core config/time helpers are now in `backend/core/*`; retire compatibility wrappers after scripts and external imports settle.
   - Pydantic API schemas are now split by domain in `backend/schemas/*`; retire compatibility wrappers after scripts and external imports settle.
   - School session and credential domain flows are now in `backend/services/*`; continue shrinking compatibility wrappers.
   - Keep compatibility imports while tests are being migrated.
4. Add typed table migrations behind a backup-first cutover.
   - Typed table foundation is additive only; production read/write remains on the current compatibility layer until dual-write and reconciliation are ready.
   - Preview/backfill tool 已可先離線產生 typed table rows、raw backup package、對帳 counts 與 no-write apply plan；下一步才是設計真正 apply lane。
   - Create full `user_data_refactor_backup` before any destructive change or backfill write.
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

## Current Refactor Gates

```bash
git diff --check
npm run web:lint
npm run web:build
npm run backend:check
```

## Release/Deployment Gates

These are intentionally outside the current local refactor lane. Run them only for a release/deployment checkpoint, not during the current "do not touch Vercel/Railway" goal.

```bash
npm run ios:build
npm run check
bash scripts/python.sh scripts/verify_production_backend.py
curl -fsS https://course-planner-backend-production.up.railway.app/health
```
