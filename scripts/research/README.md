# Research Scripts

這個資料夾保存可手動重跑的資料抓取腳本，用來更新 `tests/fixtures/` 的代表性輸出。

這些腳本：

- 不屬於前後端 runtime。
- 不會在 `npm run backend:check` 或一般測試 gate 中自動執行。
- 需要使用者明確提供 `NTUST_USERNAME` 與 `NTUST_PASSWORD` 才能登入學校系統。
- 預設只把輸出寫回對應的 `tests/fixtures/*/` 目錄。

目前保留的 research scripts：

- `course_selection/fetch_course_schedule.py`
- `edu_need_history/fetch_edu_need_history.py`
- `moodle_timeline/fetch_moodle_timeline.py`
