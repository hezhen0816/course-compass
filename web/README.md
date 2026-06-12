# Course Compass 修課羅盤 Web

`web/` 是桌面優先的課程規劃產品，負責：

- 八學期課程編排
- 課程查詢與選課工作台
- HTML 匯入
- 學分門檻設定與進度統計
- 課程詳細資訊與成績試算
- 校務同步入口與使用者確認式官方初選操作

不承擔首頁摘要、手機原生提醒或 iOS 專屬快取流程。

## 啟動

```bash
# 從 repo 根目錄
cd web
npm install
npm run dev
```

也可以從 repo 根目錄執行：

```bash
# 從 repo 根目錄
npm run web:dev
```

## 建置與檢查

```bash
npm run build
npm run lint
npm audit --audit-level=moderate
```

## 環境變數

Web 會透過 `envDir` 讀取 repo 根目錄的 `.env`：

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 資料邊界

- 直接使用雲端帳號登入
- 規劃資料保存到 `public.user_data`
- 與 iOS 共用學分規劃資料模型，但不共用 UI 狀態
- 校務密碼不寫入前端狀態或 `public.user_data`；保存與解密只透過 backend credential API
- 官方初選 join、待選、移除與排序都必須由使用者確認後才呼叫 backend
