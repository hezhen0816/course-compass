# Course Compass 修課羅盤 iOS

`ios/` 是原生 SwiftUI App，負責：

- 首頁摘要
- 每週課表
- 手機版學分規劃
- 設定與同步入口

## 啟動

```bash
# 從 repo 根目錄
npm run ios:open
```

## 驗證編譯

```bash
# 從 repo 根目錄
npm run ios:build
```

## 資料流

- 使用雲端帳號登入
- 規劃資料讀寫 `public.user_data`
- 課表與歷史修課紀錄透過根目錄 `backend/` 的同步服務抓取
- 同步結果由後端寫入快照表，再回傳給 iOS
- 同步服務網址由 `Info.plist` 的 `BackendServiceBaseURL` 提供，預設為家用 Windows 主機上的後端（`https://hezhen.taile9e4a0.ts.net`，經 tailscale serve 提供 HTTPS，手機需連上同一個 tailnet）

## 程式結構

- `AppSessionStore.swift` 保留 shared state、初始化與簡單 planner mutation
- `AppSessionStore+Auth.swift`、`+PlannerCloud.swift`、`+ScheduleSync.swift`、`+HistoryImport.swift`、`+MoodleAssignments.swift`、`+LocalCache.swift`、`+Notifications.swift`、`+Networking.swift` 依責任拆分同步、登入、快取與網路 helper
- `NativeModels.swift` 保留 app tab 與共用基礎型別；planner、schedule、API DTO、cloud DTO 已拆到獨立模型檔

## 注意事項

- iOS 不再把校務密碼寫入 `user_data.content.settings.school_password`
- 校務密碼會在同步成功後交給後端 credential API 加密保存於 `app_private.school_credentials`；官方選課 session 由後端加密保存於 `app_private.school_sessions`，後續同步可只輸入校務帳號，由後端重用 session 或使用已保存帳密重新登入
- iOS 端透過 `BackendServiceBaseURL` 使用 Windows 主機（Tailscale）上的同步服務，不需要手動輸入 IP；Railway 部署已於 2026-09-06 移除
