# Database Schema Contract

狀態：current + typed schema foundation
更新：2026-06-14

本文件記錄資料庫責任邊界。`current production` 是已上線或已存在的資料來源；`planned typed schema` 是重構目標，尚未完成前不得把它當作 production truth。

## Current Production

### `public.user_data`

目前仍是 Web/iOS 共用 planner payload 的主要資料來源。

重要欄位：
- `user_id`
- `content`
- `legacy_content`
- `content_version`
- `last_writer`
- `migrated_at`

目前 `content` 仍可能承載：
- `semesters`
- `requirementSets`
- `pendingRequirements`
- `historyRecords`
- `selectionPlan`
- `settings.school_account`
- `settings.reminder_minutes`

不得再寫入：
- `settings.school_password`
- `schoolCredentials.passwordCiphertext`

### `app_private.school_credentials`

用途：保存校務帳號與加密後的校務密碼。

安全邊界：
- 只允許 backend service role 透過 RPC 存取。
- Web/iOS 不可直接讀取。
- API status 只回傳 `school_account`、`has_password`、`last_verified_at`，不可回傳密碼或 ciphertext。
- Backend API 必須先用 Supabase Auth `/auth/v1/user` 驗證 access token。

### `app_private.school_sessions`

用途：保存官方選課 session cookie/state。

安全邊界：
- 只允許 backend service role 透過 RPC 存取。
- Web/iOS 不可直接讀取。
- Session 只在使用者前台同步或明確官方操作時 keep-alive 或重新登入。
- Keep-alive 不得觸發 join/remove/reorder。

### Snapshot Tables

目前 backend 仍使用 snapshot table 保存同步結果：
- `schedule_sync_snapshots`
- `history_import_snapshots`
- `moodle_assignment_snapshots`

這些表屬於 current compatibility layer，未來會被 `sync_runs` 與 typed domain rows 取代。

## Typed Schema Foundation

Migration `20260614211338_add_typed_planner_schema_foundation.sql` 已加入 typed tables 的第一階段基礎建設。

這個 migration 只做 additive schema：

- 建立 typed tables、indexes、updated_at triggers、RLS 與 service-role grants。
- 不搬移 `public.user_data.content`。
- 不刪除 snapshot tables。
- 不改 Web/iOS 讀寫路徑。
- 不保存校務密碼、official session cookie 或 GPA API token。

目前 typed tables 是重構目標的 landing zone，尚未接上 production read/write。

## Planned Typed Schema

下列資料表是重構目標。基礎表已建立後，仍需先在 clone/local 驗證 backfill、對帳與 rollback 方案，再切 production read/write。

### Planner

- `planner_profiles`
- `academic_terms`
- `planner_courses`
- `course_meetings`
- `course_details`
- `grading_items`

取代：
- `content.semesters[].courses[]`
- course detail nested fields

### Requirements

- `requirement_sets`
- `requirements`
- `requirement_options`
- `requirement_option_courses`

取代：
- `content.requirementSets`
- `content.pendingRequirements`

### Academic History

- `academic_history_records`

取代：
- `content.historyRecords`

### Selection

- `selection_plans`
- `selection_candidates`
- `selection_priorities`
- `official_selection_cache`

取代：
- `content.selectionPlan`

### Course Offerings

- `course_offerings`
- `course_offering_meetings`

用途：
- 保存官方課程查詢快取。
- 支援 Web/iOS 共用查詢結果與衝堂檢查。

### Sync

- `sync_runs`

取代：
- `schedule_sync_snapshots`
- `history_import_snapshots`
- `moodle_assignment_snapshots`
- 分散在 payload 裡的同步 metadata

## Migration Invariants

- 先建立完整 backup，再拆 JSON。
- 不丟棄未知欄位；無法映射的 payload 存入對應 row 的 `metadata jsonb`。
- Preview/backfill 報告不可保存校務密碼、official session cookie 或 GPA API token；若 source payload 含敏感欄位，必須在 metadata 中遮罩。
- 切換前後至少對帳：
  - 使用者數
  - 學期數
  - 課程數
  - 歷史紀錄數
  - requirement set 數
  - pending requirement 數
  - selection candidate 數
- 舊 `public.user_data.content` 至少保留一個 release。
- Web/iOS 兩端都改到 typed API 並驗證後，才允許移除 whole-payload upsert。

## Backfill Preview Tool

`backend/services/typed_planner_backfill.py` 是 typed schema 切換前的離線預覽與對帳核心；`scripts/preview_typed_planner_backfill.py`、`scripts/plan_typed_planner_backfill.py` 與 `scripts/apply_typed_planner_backfill.py` 是本機 CLI wrappers。

目前 preview contract version：`typed-planner-backfill-preview-v1`。

用途：
- 讀取本機 JSON 匯出的 `public.user_data` rows。
- 將 `content.semesters`、`requirementSets`、`pendingRequirements`、`historyRecords`、`selectionPlan` 拆成 typed table preview rows。
- 輸出每張 typed table 的 row count、source count 與 warnings。
- 在 `preview.json`、`reconciliation.json`、`manifest.json` 與 `backup-user-data.json` 寫入 `contract_version`，供後續 apply lane 驗證。
- 保留無法穩定映射的原始欄位到 `metadata.source_payload`，但會遮罩 `settings.school_password`、`passwordCiphertext`、`gpaApi.apiKey`。
- 可用 `--package-dir` 產生本機 backfill package：
  - `backup-user-data.json`：完整原始 backup，可能包含敏感資料，只能留在本機安全位置。
  - `preview.json`：typed table preview，敏感欄位已遮罩。
  - `reconciliation.json`：source count 與 typed preview count 對帳結果。
  - `manifest.json`：package 摘要、狀態、檔案清單與是否含敏感 backup。
- `build_typed_planner_apply_plan(package)` 可把通過對帳的 package 轉成本機 apply plan：
  - 檢查 `manifest`、`preview`、`reconciliation` 的 `contract_version`。
  - 要求 `database_writes=false`、`reconciliation.status=passed`，且 package 必須包含完整 preview rows。
  - 輸出 typed table 寫入順序、各表 row count 與總 row count，供下一階段設計真正 apply lane 前審查。
- `build_typed_planner_apply_batches(package)` 可進一步輸出 no-write PostgREST upsert batches：
  - 每張 typed table 產生 `POST /rest/v1/{table}?on_conflict=id` 的 row-level payload。
  - 使用 `Prefer: resolution=merge-duplicates,return=minimal`，讓下一階段 repository 寫入可以沿用同一份 batch contract。
  - batches 只使用 redacted `preview.json` rows，不讀取 raw backup。
  - `backend/repositories/typed_planner.py` 的執行 helper 會跳過 `rows=[]` 的空 batch，避免對 PostgREST 發空 upsert。
- `scripts/apply_typed_planner_backfill.py` 目前只做 dry-run：
  - 讀取 package，產生 batches，通過 repository dry-run，輸出 batch count / non-empty count / total row count。
  - 不輸出完整 rows，避免 dry-run report 變成另一份搬移資料。

明確限制：
- 不連 Supabase。
- 不寫資料庫。
- 不產生 production backfill SQL。
- apply plan / apply batches 仍是 no-write artifacts，不產生 SQL，也不執行 upsert。
- `backup-user-data.json` 是本機原始備份，不可提交到 repo。
- `reconciliation.json` 只證明本機 preview count 是否一致，不取代 production reconciliation。

使用方式：

```bash
bash scripts/python.sh scripts/preview_typed_planner_backfill.py user_data_export.json --counts-only
bash scripts/python.sh scripts/preview_typed_planner_backfill.py user_data_export.json --package-dir /tmp/course-planner-backfill-preview
bash scripts/python.sh scripts/plan_typed_planner_backfill.py /tmp/course-planner-backfill-preview --output /tmp/course-planner-backfill-preview/apply-plan.json
bash scripts/python.sh scripts/plan_typed_planner_backfill.py /tmp/course-planner-backfill-preview --format batches --output /tmp/course-planner-backfill-preview/apply-batches.json
bash scripts/python.sh scripts/apply_typed_planner_backfill.py /tmp/course-planner-backfill-preview --output /tmp/course-planner-backfill-preview/apply-dry-run.json
```

輸入可為：

```json
[
  {"user_id": "...", "content": {"semesters": []}}
]
```

或：

```json
{"rows": [{"user_id": "...", "content": {"semesters": []}}]}
```
