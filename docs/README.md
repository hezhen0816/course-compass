# Docs

`docs/` 保存跨端產品決策與可回查的 QA 記錄，不放 build output、臨時截圖或本機快取。

- `architecture/refactor-plan.md`：目前有效的全專案重構計畫、執行順序與驗證 gate。
- `architecture/refactor-inventory.md`：重構前盤點基準，包含 checkpoint、相容 wrapper、文件、資料庫與驗證 gate。
- `architecture/test-inventory.md`：測試與 fixture 的保留等級、刪減邊界與後續瘦身 checkpoint。
- `data-contracts/database-schema.md`：current production schema 與 planned typed schema 的責任邊界。

大型或可重現的測試 fixture 請放 `tests/fixtures/`；不需要長期保存的 debug 產物請留在 `/tmp` 或本機未追蹤目錄。
