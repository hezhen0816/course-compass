# Course Compass 修課羅盤

Course Compass is an unofficial NTUST course and credit planner with a React web app, a SwiftUI iOS app, and a FastAPI backend. It accesses NTUST systems on the user's behalf and is not affiliated with NTUST.

修課羅盤用來規劃國立臺灣科技大學（台科大）的課表、學分與畢業門檻。校務整合會在使用者操作時，代表使用者存取台科大系統。本專案由個人開發，與台科大無隸屬或合作關係。

## 功能

- Web 可搜尋課程、編排單學期與多學期課表、檢查時段衝突與學分進度，並匯入支援格式的應修科目表 PDF。
- 以校務帳密同步目前課表及歷年修課資料。Web 可讀取初選志願並在使用者確認後送出選課操作。校務連線到期後需重新登入。
- iOS 可看課表、查詢空教室、同步 Moodle 待繳事項，以及使用課程通知與即時動態。
- 背景 Worker 可查詢課程名額變動並依設定寄送通知。公開版的名額監聽只查詢名額。
- 可選用自己的 myNTUST API 金鑰取得歷年 GPA。多學期排課求解使用歷年開課資料及 OR-Tools CP-SAT。

## 架構

```text
React / Vite（Web） ─────┬── Supabase Auth + PostgreSQL
SwiftUI（iOS） ──────────┘           ↑
Web / iOS ─── FastAPI ───────────────┘
                 ├── 台科大課程查詢、選課、成績、Moodle
                 └── myNTUST GPA API
Python Worker ─── Supabase、台科大公開課程查詢、選用的寄信服務
```

Web 使用 TypeScript、React、Vite 與 Tailwind CSS，可從 `web/` 建置至 Vercel。iOS 使用 SwiftUI、ActivityKit 與 Xcode 專案。FastAPI 提供校務同步、PDF 解析與排課求解，Supabase 提供驗證與資料庫。

## 本機執行

準備 Node.js 22.12 以上（22.x 系列）與 npm、Python 3.13，以及支援目標 SDK 的 Xcode（已以 Xcode 27.2 建置，專案最低部署版本為 iOS 17）。雲端登入及資料同步需要自己的 Supabase 專案。

1. 在新的 Supabase 專案依檔名前綴順序套用 `supabase/migrations/`。若採用電郵登入，請設定 Supabase Auth 的電郵提供者及站台網址。這組 migration 以新資料庫為起點。
2. 從根目錄複製 `.env.example` 為 `.env`，依範本填入設定值。Web 及 iOS 使用 Supabase 的公開金鑰，後端的 service-role 金鑰與加密密鑰由後端環境提供。無 Supabase 設定時可從 Web 登入頁選「略過登入」使用示範模式。
3. 在根目錄開啟兩個終端。第一個終端啟動 API。

   ```sh
   python3.13 -m venv ../venv-course-compass
   . ../venv-course-compass/bin/activate
   python -m pip install -r backend/requirements-dev.txt
   set -a
   . ./.env
   set +a
   python -m uvicorn backend.app:app --host 127.0.0.1 --port 8001 --no-access-log
   ```

   API 啟動後，可讀取 `http://127.0.0.1:8001/healthz` 與 `http://127.0.0.1:8001/docs`。第二個終端啟動 Web。

   ```sh
   set -a
   . ./.env
   set +a
   npm --prefix web ci
   npm --prefix web run dev
   ```

4. 若需要名額監聽，在已設定 Supabase 的後端環境另外執行 `python -m backend.monitor.worker`。寄信可選填 SMTP 或 Resend 設定。

Web 與 API 分開部署時，在前端設定 `VITE_BACKEND_URL`，在後端將 Web 的 HTTPS origin 加入 `CORS_ORIGINS`。Vercel 的 Root Directory 設為 `web`，建置指令為 `npm run build`，輸出目錄為 `dist`。

## iOS

Xcode 專案在 `ios/App/App.xcodeproj`，使用 `App` scheme。將 Supabase URL、公開金鑰與可從裝置存取的 HTTPS API URL 以 Xcode build settings 注入。實機簽署需使用自己的 Apple 開發團隊及 App／Widget bundle identifiers。設定與免簽署建置指令見 [iOS 說明](ios/README.md)。

## 測試與建置

```sh
. ../venv-course-compass/bin/activate
TR_COURSE_PREWARM=0 python -m pytest tests/backend
npm --prefix web run lint
npm --prefix web run build
```

## 資料與限制

- 後端在使用者發起同步時接收校務帳密，並透過台科大系統登入。校務密碼用於當次登入。官方選課的 session cookie 留在後端程序記憶體，到期或程序重啟後需重新同步。
- Supabase 可保存雲端課表、修課規劃與選擇同步的快照。快照依 Supabase 使用者及校務帳號區分，可能包含學號、課程或成績。iOS 會在裝置上快取課表及 Moodle 待繳事項。
- myNTUST 功能使用個人 API 金鑰。後端使用 `COURSE_COMPASS_ENCRYPTION_SECRET` 加密後才將金鑰寫入 Supabase。
- 選課監控的通知設定（`user_settings`）：SMTP 密碼與 Resend 金鑰由前端以明文寫入，背景 worker 處理後才加密；代理密碼與 LINE Notify 權杖目前以明文存放。自架時請限制資料表存取，或自行改成加密存放。
- 台科大的系統畫面、登入流程、選課階段與欄位可能變動。能否選課及是否符合畢業門檻，以學校與各系所規定為準。多學期求解採用歷年資料，實際開課仍以該學期公告為準。

[API 與資料庫文件](docs/README.md)

## 開發方式

以 Claude Code、Codex 等 AI 代理協作開發：需求、架構與技術選擇由作者與 AI 討論後決定，程式碼主要由 AI 撰寫。

本專案採用 [MIT 授權](LICENSE)。
