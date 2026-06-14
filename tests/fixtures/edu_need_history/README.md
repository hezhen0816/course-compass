# 台科大歷史修課紀錄測試資料

這個資料夾保存台科大學生必修課程查詢頁面的歷史修課紀錄代表性輸出資料。重跑抓取用的本機 research script 已移到 `scripts/research/edu_need_history/`，輸出仍會寫回本資料夾。

## Python 安裝

```bash
cd /Users/hezhen/GitHub/course_planner/scripts/research/edu_need_history
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Python 執行

```bash
cd /Users/hezhen/GitHub/course_planner/scripts/research/edu_need_history
NTUST_USERNAME="你的學號" \
NTUST_PASSWORD="你的校務密碼" \
.venv/bin/python fetch_edu_need_history.py
```

如需強制驗證站台憑證，可額外指定：

```bash
NTUST_VERIFY_SSL=true
```

台科站台目前在 `requests` 下可能出現憑證鏈驗證問題，所以腳本預設使用 `NTUST_VERIFY_SSL=false`。

## 保留的輸出

- `history-courses.csv`: 平面化課程紀錄 CSV
- `run-summary.json`: 本次執行摘要

## 不追蹤的中間產物

重跑腳本時，以下檔案只作為除錯用途，預設不納入版控：

- `edu-need-page.html`
- `flow-log.md`
- `history-courses.json`
- `login-timeout.html`
