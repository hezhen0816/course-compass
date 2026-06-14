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

- `web/`：React/Vite frontend，目前 app shell 與跨頁狀態 wiring 在 `web/src/app/`，主要功能在 `web/src/features/*`，`web/src/App.tsx` 只保留入口 re-export。
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
- `docs/architecture/test-inventory.md`
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

Current app shell 元件已移到 `web/src/app/`，修課軌跡使用的 `CourseDetailModal` 已移到 `web/src/features/history/`。`web/src/components/` 目前沒有仍需保留的檔案。
全域 stylesheet 也已移到 `web/src/app/global.css`。

共用 frontend infrastructure 已集中到 `web/src/shared/`：

- `shared/api.ts`
- `shared/supabase.ts`
- `shared/constants.ts`
- `shared/types.ts`
- `shared/hooks/useAuth.ts`
- `shared/hooks/useCourseData.ts`
- `shared/domain/planner.ts`
- `shared/domain/courseDepartments.ts`

舊 `web/src/utils/parseCourselist.ts` 與 Vite 預設 `web/src/assets/react.svg` 沒有 current import，已移除。

## Tests

目前 backend regression tests 已按 domain 拆分到 `tests/backend/`，不再集中於歷史大型 pure test。測試保留等級與 fixture cleanup 邊界記錄在 `docs/architecture/test-inventory.md`。

重構期間的測試原則：

- 官方選課 parser/client/API、credential/session、database migration 與 sync API tests 屬於必留安全網。
- Fixture 抓取腳本與代表性輸出屬於保守保留；後續若移除，需先確認沒有測試、文件或 parser 回歸流程引用。
- 不提交本機 cache；`.gitignore` 已排除 `.DS_Store`、`__pycache__`、`.pytest_cache` 與 `*.pyc`。

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

已建立離線 preview 工具：

- `backend/services/typed_planner_backfill.py`
- `scripts/preview_typed_planner_backfill.py`
- service 保留 preview/package/reconciliation 核心邏輯，script 只做 CLI 包裝。
- preview/package/reconciliation 目前使用 contract version：`typed-planner-backfill-preview-v1`。
- 只讀本機 JSON，不連 Supabase、不寫 DB。
- 輸出 typed table preview rows、row counts、source counts 與 warnings。
- `metadata.source_payload` 保留原始未知欄位，但遮罩校務密碼、舊 ciphertext 與 GPA API key。
- `--package-dir` 會產生本機 raw backup、redacted preview、reconciliation 與 manifest；raw backup 可能包含敏感資料，不可提交。
- `build_typed_planner_apply_plan(package)` 會驗證 package contract 與對帳狀態，產生 no-write apply plan 的 table order / row counts；目前仍不產生 SQL、不寫資料庫。

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
