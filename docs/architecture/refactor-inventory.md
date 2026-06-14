# Refactor Inventory

狀態：active baseline
更新：2026-06-14

本文件是全專案重構的盤點基準。重構時先更新這份清單，再做搬移或刪除，避免把功能修正、檔案整理與資料庫切換混在同一個不可回溯的變更裡。

## Checkpoint

- checkpoint commit：`9952315 checkpoint: save planner gpa and official selection work`
- refactor branch：`codex/project-refactor`
- checkpoint gate：
  - `npm run web:lint`
  - `npm run web:build`
  - `npm run backend:check`

## Current Top-Level Layout

- `web/`：React/Vite frontend，目前主要功能分散在 `web/src/features/*` 與 `web/src/App.tsx`。
- `backend/`：FastAPI backend，已部分拆成 `api/`、`core/`、`integrations/`、`repositories/`、`services/`、`schemas/`。
- `ios/`：native iOS app，仍相容 current shared payload。
- `supabase/`：production migration history。
- `docs/`：現行架構與資料契約。
- `tests/`：backend tests 與可回查 fixtures。
- `scripts/`：本機啟動、Python runtime wrapper、production verifier 與 migration helper。

## Generated Or Local-Only Files

目前有本機產生但未被 git 追蹤的 Python cache：

- `backend/__pycache__/`
- `tests/backend/__pycache__/`

`git ls-files` 沒有列出 tracked `__pycache__`、`.pytest_cache`、`node_modules`、`dist`、`.DS_Store` 或 `*.pyc`。後續只需要清除本機 cache，不需要從版控移除。

## Backend Compatibility Wrappers

下列純 re-export wrapper 已在 `codex/project-refactor` 移除：

- `backend/config.py` -> `backend/core/config.py`
- `backend/time_utils.py` -> `backend/core/time_utils.py`
- `backend/models.py` -> `backend/schemas/*`
- `backend/schemas/models.py` -> `backend/schemas/*`
- `backend/official_selection.py` -> `backend/integrations/official_selection.py`
- `backend/schedule.py` -> `backend/integrations/schedule.py`
- `backend/history.py` -> `backend/integrations/history.py`
- `backend/moodle.py` -> `backend/integrations/moodle.py`
- `backend/tr_rooms.py` -> `backend/integrations/tr_rooms.py`
- `backend/ntust_common.py` -> `backend/integrations/ntust_common.py`
- `backend/planner_pdf.py` -> `backend/services/planner_pdf.py`
- `backend/snapshots.py` -> `backend/services/snapshots.py`
- `backend/credentials.py` -> `backend/services/credential_store.py`
- `backend/school_sessions.py` -> `backend/services/school_session_store.py`

目前沒有純 backend top-level compatibility wrapper 留待收斂。若再刪除檔案，必須先確認安全邊界、依賴注入與 tests/scripts 都已改到目標 module。

`backend/credentials.py` 已退場。credential error type、security helpers、runtime wiring、domain rules 已分別收斂到 `backend/core/errors.py`、`backend/core/security.py`、`backend/services/credential_store.py`、`backend/services/credentials.py` 與 `backend/repositories/credentials.py`。`backend/school_sessions.py` 已退場，official session runtime wiring 已移到 `backend/services/school_session_store.py`。

## Docs

現行文件：

- `docs/architecture/refactor-plan.md`
- `docs/architecture/refactor-inventory.md`
- `docs/data-contracts/database-schema.md`
- `docs/README.md`

已刪除的過時文件與資料：

- `docs/archive/2026-refactor/product_redefinition.md`
- `docs/archive/2026-refactor/web_ux_low_risk_audit.md`
- `docs/archive/2026-refactor/reference-images/`
- `docs/design/web_planning_workspace_qa.md`

後續規則：

- 現行規格只放 `architecture/`、`data-contracts/`。
- 舊產品定位、舊 UX audit、參考截圖與過期 QA 記錄不再保留在 repo。
- 不把臨時截圖、build output、本機 debug dump 放進 `docs/`。

## Web Cleanup

下列舊版 planner/sidebar/settings UI 元件已無 current app import，並已從 `web/src/components/` 移除：

- `CourseModal.tsx`
- `SettingsModal.tsx`
- `SemesterGrid.tsx`
- `Sidebar.tsx`
- `ProgressBar.tsx`

## Database Refactor Baseline

Current production truth：

- `public.user_data.content`
- `app_private.school_credentials`
- `app_private.school_sessions`
- `schedule_sync_snapshots`
- `history_import_snapshots`
- `moodle_assignment_snapshots`

Typed schema foundation：

- migration：`supabase/migrations/20260614211338_add_typed_planner_schema_foundation.sql`
- 只新增 typed tables、indexes、RLS 與 comments。
- 不搬資料、不刪舊欄位、不更改 Web/iOS 讀寫路徑。

資料庫重構切換順序：

1. 建 typed tables。
2. 建 preview/backfill script 與對帳報告。
3. Backend 開始 dual-write。
4. Backend API 改成 typed-read with legacy fallback。
5. Web/iOS 確認只透過 API，不直接依賴 `user_data.content` shape。
6. 至少一個 release 後才停止 whole-payload upsert。

## Validation Gates

每個階段至少跑：

```bash
git diff --check
npm run web:lint
npm run web:build
npm run backend:check
```

合併前再跑：

```bash
npm run check
bash scripts/python.sh scripts/verify_production_backend.py
```

依使用者要求，不跑瀏覽器自動化測試。
