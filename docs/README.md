# Docs

`docs/` 保存跨端產品決策與可回查的 QA 記錄，不放 build output、臨時截圖或本機快取。

- `product_redefinition.md`：目前產品定位、頁面職責、校務帳密與官方選課邊界。
- `web_ux_low_risk_audit.md`：歷史 Web UX audit，保留當時觀察與低風險建議。
- `design/`：設計 QA 記錄與已引用的參考圖片。

大型或可重現的測試 fixture 請放 `test_artifacts/`；不需要長期保存的 debug 產物請留在 `/tmp` 或本機未追蹤目錄。
