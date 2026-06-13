# 測試資料總覽

這個資料夾保留三類可重跑的測試素材：

- `course_selection/`
  台科大選課清單抓取流程，保留腳本、README 與代表性 CSV/摘要。
- `edu_need_history/`
  台科大歷史修課紀錄抓取流程，保留腳本、README 與代表性 CSV/摘要。
- `moodle_timeline/`
  Moodle 時間軸與待繳事項抓取流程，保留腳本、README 與代表性 CSV/摘要。

整理原則：

- 保留可重跑腳本與必要依賴說明。
- 保留少量代表性輸出，方便人工比對與回歸測試。
- 不追蹤大型 HTML、flow log、暫時 JSON 或登入失敗頁等中間產物。

如果要重跑：

1. 進入對應子資料夾。
2. 建立 `.venv` 並安裝 `requirements.txt`。
3. 設定 `NTUST_USERNAME`、`NTUST_PASSWORD`。
4. 執行對應的 Python 腳本。
