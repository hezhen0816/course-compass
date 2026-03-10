# 修課羅盤 iOS

`ios/` 是原生 SwiftUI App，負責：

- 首頁摘要
- 每週課表
- 手機版學分規劃
- 設定與同步入口

## 啟動

```bash
cd /Users/hezhen/Project/course_planner
npm run ios:open
```

## 驗證編譯

```bash
cd /Users/hezhen/Project/course_planner
npm run ios:build
```

## 資料流

- 使用雲端帳號登入
- 規劃資料讀寫 `public.user_data`
- 課表與歷史修課紀錄透過根目錄 `backend/` 的同步服務抓取
- 同步結果由後端寫入快照表，再回傳給 iOS

## 注意事項

- `school_password` 目前依產品需求保存在 `user_data.content.settings`
- 課表同步服務網址預設為 `http://127.0.0.1:8000`
- 真機測試時需改成 Mac 的區網 IP
