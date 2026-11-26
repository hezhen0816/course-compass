# iOS 本機建置

使用 Xcode 開啟 `App/App.xcodeproj`，選擇 `App` scheme。這個專案包含 App 與 `CourseCompassWidgets` extension。

以下從儲存庫根目錄執行，先依根目錄的 `.env.example` 建立 `.env`：

```sh
set -a
. ./.env
set +a
xcodebuild build-for-testing \
  -project ios/App/App.xcodeproj -scheme App \
  -destination 'generic/platform=iOS' \
  -derivedDataPath ../dd-course-compass \
  CODE_SIGNING_ALLOWED=NO \
  SUPABASE_URL="$SUPABASE_URL" \
  SUPABASE_ANON_KEY="$SUPABASE_ANON_KEY" \
  BACKEND_SERVICE_BASE_URL="$BACKEND_SERVICE_BASE_URL"
```

實機建置時，在本機 Xcode 設定自己的簽署團隊與 App、Widget bundle identifiers。Widget identifier 以前者為前綴。以 Xcode GUI 建置時，可在本機設定同名 build settings。裝置須能連到 `BACKEND_SERVICE_BASE_URL`；校務整合需由可透過 HTTPS 存取的後端提供。
