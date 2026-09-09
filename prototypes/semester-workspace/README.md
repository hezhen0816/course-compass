# 本學期工作區原型

獨立的 UI／UX 第一階段原型：課表、找課側欄與預排。所有課程、教師、名額均為模擬資料；不讀取正式帳號或呼叫學校、Supabase、監控服務。

## 啟動

在 repository 根目錄執行（沿用 `web/node_modules` 的既有 React、Lucide 與 Vite；尚未安裝時先 `npm ci --prefix web`）：

```sh
npm --prefix prototypes/semester-workspace run dev
```

開啟 http://127.0.0.1:4317/ 。服務只綁定本機。

## 試用

1. 在「加退選」模式點「資料庫系統」查看時段預覽，再「加入預排」；已選學分維持 18，預排學分由 3 變 6。
2. 「加退選」模式會阻擋新增衝堂課；切到「初選志願登記」後，可把「行銷管理」與同時段的「成本會計」一起加入，課表會並排顯示。切回加退選保留草稿並提示重疊。
3. 搜尋課名、課碼或教師，搭配課程類別與「只顯示不衝堂課程」篩選。
4. 點預排課程可移除；點「重設示範」回到初始預排。僅修改此原型的瀏覽器儲存。
5. 桌面以週課表開啟；手機以清單開啟，找課為全螢幕面板。可切換週課表。

預排使用獨立 localStorage key `course-compass:semester-prototype:v1`，重整後保留。模式另存於同一 key 加上 `:mode`。初選顯示「志願總量」，不是可同時修讀或已取得學分。模式切換不會刪課。沒有正式選課、志願排序／抽選、待加簽、畢業規劃或名額追蹤整合。

模式是手動情境預覽，不代表目前官方入口已開放。初選登記與抽選後繼續選課的差異見 [學校系統契約](../../docs/data-contracts/ntust-systems.md#5-選課階段以教務處時程表為準)。

## 驗證

```sh
npm --prefix prototypes/semester-workspace run build
node --test prototypes/semester-workspace/model.test.js
```

瀏覽器驗證紀錄見 [design-qa.md](design-qa.md)。本原型不納入正式 Web 的入口、建置或部署。
