# Test Inventory

狀態：active baseline
更新：2026-06-15

本文件回答「這些 test 是否都必須」這個問題。結論是：不是每一份測試與 fixture 都同等重要，但目前 backend regression tests 大多在保護官方選課、校務帳密、parser 與資料庫遷移邊界，不建議在沒有替代驗證前直接刪除。

## Test Policy

- 不新增瀏覽器自動化測試；使用者明確要求不要跑自動化瀏覽器測試。
- 每個重構階段只跑本機 gate，不碰 Vercel、Railway 或 production verifier。
- 新增測試只保護高風險重構邊界：parser、credential/session、資料庫 migration、資料搬移 preview。
- 不為單純搬檔或改名新增測試；用既有 `backend:check`、`web:lint`、`web:build` 驗證。
- 本機產物如 `.DS_Store`、`__pycache__`、`.pytest_cache` 不應提交；現有 `.gitignore` 已排除。

## Backend Tests

| 檔案 | 保留等級 | 保留理由 |
| --- | --- | --- |
| `test_official_selection_parser.py` | 必留 | 官方 A02 HTML 版型不穩，parser 直接影響已登記志願、待加簽與課表資料。 |
| `test_official_selection_client.py` | 必留 | 保護官方選課 sync/join/waitlist/reorder 行為，避免誤操作或錯用來源資料。 |
| `test_official_selection_api.py` | 必留 | 保護 mutating API 必須 `confirmed: true`，以及保存 session/credentials 的使用邏輯。 |
| `test_course_search_api.py` | 必留 | 查課結果是 GPA、待加簽、課表補時段與開課系所解析的主要來源。 |
| `test_schedule_integration.py` | 必留 | 保護課表時段 grouping 與 metadata，避免課卡重複或錯位。 |
| `test_sync_api.py` | 必留 | 保護 schedule/history/Moodle sync 走 backend-owned credentials，不回退到前端密碼流。 |
| `test_credentials_repository.py` | 必留 | 保護 Supabase `user_data` 與 private credential RPC 存取格式。 |
| `test_credential_store.py` | 必留 | 保護 server-side key、Supabase Auth 驗證與密碼加解密邏輯。 |
| `test_credential_service.py` | 必留 | 保護 legacy plaintext promotion 與清除行為。 |
| `test_legacy_credential_migration.py` | 必留 | 保護 dry-run/apply migration 不遺失或外洩校務密碼。 |
| `test_school_credentials_api.py` | 必留 | 保護 API 不回傳密碼。 |
| `test_school_session_service.py` | 必留 | 保護官方 session 加密 payload 與 TTL domain 規則。 |
| `test_school_session_store.py` | 必留 | 保護 official session private RPC round trip。 |
| `test_session_context.py` | 必留 | 保護 request context、saved credential 與 official session reuse/persist 流程。 |
| `test_database_migrations.py` | 必留 | 保護 migration 是 additive、legacy data 不被提前破壞。 |
| `typed_planner/test_backfill_preview.py` | 必留 | 保護 typed planner preview/package/reconciliation contract、敏感欄位遮罩與 no-write apply plan/batches。 |
| `typed_planner/test_apply_service.py` | 必留 | 保護 typed planner backfill apply dry-run 不寫資料庫、不輸出完整 rows，且 execute 必須 readiness ready 與固定確認。 |
| `typed_planner/test_repository.py` | 必留 | 保護 typed planner batch repository 的 dry-run 與 PostgREST upsert URL/header/body shape。 |
| `test_snapshots_service.py` | 保守保留 | 保護 snapshot repository/service 的 Supabase query/write shape；若未來 typed API 完成可重新評估。 |
| `test_ntust_content_parsers.py` | 保守保留 | 保護 Moodle/history parser；若改成正式 fixture contract 後可拆小或整併。 |
| `test_planner_pdf_service.py` | 保守保留 | PDF 需求解析已不是最高信心流程，但仍保護既有匯入功能不倒退。 |
| `test_tr_rooms_api.py` | 保守保留 | TR 教室查詢是附屬功能；保留到 room status feature 穩定後再評估。 |
| `test_health_and_production_verifier.py` | 可評估瘦身 | Production verifier 本階段不跑；可保留 health capability test，將 production verifier 規格移到 deployment lane 後再決定。 |

## Fixtures

| 路徑 | 保留等級 | 保留理由 |
| --- | --- | --- |
| `tests/fixtures/course_selection/` | 保守保留 | 保存台科大選課清單代表性輸出；手動抓取腳本在 `scripts/research/course_selection/`。 |
| `tests/fixtures/edu_need_history/` | 保守保留 | 保存歷年修課紀錄代表性輸出，對 history parser 有回歸價值；手動抓取腳本在 `scripts/research/edu_need_history/`。 |
| `tests/fixtures/moodle_timeline/` | 可評估瘦身 | Moodle timeline 目前不是核心選課工作台；手動抓取腳本在 `scripts/research/moodle_timeline/`，後續可評估刪除代表性輸出只留 README。 |

## Current Cleanup Boundary

本階段不刪 backend regression tests，因為它們大多對應已拆分的 backend module 與官方系統風險。可立即清理的是：

- 本機未追蹤 cache：`.pytest_cache/`、各層 `__pycache__/`、`*.pyc`、`.DS_Store`。
- 若後續要進一步瘦身，先查 `rg 'tests/fixtures' tests backend scripts docs`，確認 fixture 是否還被使用。
- 若 fixture output 只作為研究紀錄，優先移到 `docs/research/` 或刪除輸出檔，避免讓 `tests/` 看起來比實際更重。

## Next Review Checkpoint

完成 typed database backfill preview 後再重新評估：

1. `test_health_and_production_verifier.py` 是否應拆成 health test 與 deployment verifier test。
2. Moodle fixture 是否仍需留在 repo。
3. `scripts/research/*` 是否仍需要保留 requirements 與可重跑腳本。
