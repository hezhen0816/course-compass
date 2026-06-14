# Deployment Scripts

這個資料夾放 release/deployment checkpoint 才需要手動執行的工具。

- `verify_production_backend.py`：檢查 production backend health 與 OpenAPI 是否包含官方選課相關能力。

這些工具不屬於目前本機 refactor gate。依目前重構目標，不要在每個階段自動執行，也不要把它們接到 Vercel/Railway flow。
