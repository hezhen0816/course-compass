# Database Schema Contract

狀態：current + planned contract
更新：2026-06-13

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

## Planned Typed Schema

下列資料表是重構目標，需先在 clone/local 驗證 migration、對帳與 rollback 方案，再切 production。

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
