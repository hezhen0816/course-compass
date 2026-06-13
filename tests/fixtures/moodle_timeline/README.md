# 台科大 Moodle 時間軸測試資料

這個資料夾包含一個可重跑的 Python 腳本，用來登入 `https://moodle2.ntust.edu.tw/my/`，抓取儀表板「時間軸」目前可見的待處理項目，並輸出代表性的待繳事項資料。

## Python 安裝

```bash
cd /Users/hezhen/GitHub/course_planner/tests/fixtures/moodle_timeline
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## Python 執行

```bash
cd /Users/hezhen/GitHub/course_planner/tests/fixtures/moodle_timeline
NTUST_USERNAME="你的學號" \
NTUST_PASSWORD="你的校務密碼" \
.venv/bin/python fetch_moodle_timeline.py
```

如需強制驗證站台憑證，可額外指定：

```bash
NTUST_VERIFY_SSL=true
```

台科站台目前在 `requests` 下可能出現憑證鏈驗證問題，所以腳本預設使用 `NTUST_VERIFY_SSL=false`。

## 保留的輸出

- `timeline-items.csv`: 時間軸目前可見項目 CSV
- `timeline-assignments.csv`: 待繳事項與待完成項目 CSV
- `run-summary.json`: 本次執行摘要

## 不追蹤的中間產物

重跑腳本時，以下檔案只作為除錯用途，預設不納入版控：

- `moodle-dashboard.html`
- `flow-log.md`
- `timeline-items.json`
- `login-timeout.html`
