# 台科大選課清單測試資料

這個資料夾保存台科大「選課清單」代表性輸出資料。重跑抓取用的本機 research script 已移到 `scripts/research/course_selection/`，輸出仍會寫回本資料夾。

## Python 安裝

```bash
cd /Users/hezhen/GitHub/course_planner/scripts/research/course_selection
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Python 執行

```bash
cd /Users/hezhen/GitHub/course_planner/scripts/research/course_selection
NTUST_USERNAME="你的學號" \
NTUST_PASSWORD="你的校務密碼" \
.venv/bin/python fetch_course_schedule.py
```

如需強制驗證站台憑證，可額外指定：

```bash
NTUST_VERIFY_SSL=true
```

台科站台目前在 `requests` 下可能出現憑證鏈驗證問題，所以腳本預設使用 `NTUST_VERIFY_SSL=false`。

## 保留的輸出

- `courses.csv`: 課程清單 CSV
- `schedule.csv`: 課表時段 CSV
- `run-summary.json`: 本次執行摘要

## 不追蹤的中間產物

重跑腳本時，以下檔案只作為除錯用途，預設不納入版控：

- `courselist-page.html`
- `flow-log.md`
- `selected-courses.json`
- `schedule-slots.json`
- `login-timeout.html`

## 已驗證流程

2026-03-10 已驗證以下流程可達：

1. `GET` 選課系統入口並取得 SSO 登入頁。
2. 解析 SSO 登入表單與 hidden inputs，直接提交帳密。
3. 遇到 `signin-oidc` callback 時自動提交回傳表單。
4. 進入 `/ChooseList/D01/D01` 後解析課程表格與課表表格。
