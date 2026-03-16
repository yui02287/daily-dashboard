# 每日任務板

一個部署在 GitHub Pages 的每日儀表板，整合天氣、新聞、代辦事項與自媒體內容規劃，並透過積分與成就機制提升使用動力。

---

## 功能一覽

- 🌤 **今日天氣**：自動偵測位置，顯示溫度、體感、濕度
- 📰 **今日新聞**：RSS 訂閱，每天早上自動更新
- 📋 **代辦事項**：整合 Google 日曆 + Notion + 手動輸入，可勾選完成
- 🎬 **影片題材**：追蹤自媒體拍片計劃與發布狀態
- ✅ **完成區**：已完成代辦獨立顯示
- ⭐ **遊戲化**：XP 積分、Lv 1-10 等級系統、連續天數、七種成就徽章

---

## 設定步驟

### 第一步：建立 GitHub Repository 並啟用 Pages

1. 在 GitHub 新增一個 **公開** repository（名稱自訂，例如 `daily-dashboard`）
2. 將此資料夾所有檔案 push 到 `main` 分支
3. 到 repo → **Settings → Pages → Source** → 選 `main` 分支，根目錄 `/`
4. 記下你的 Pages 網址：`https://你的帳號.github.io/daily-dashboard/`

---

### 第二步：OpenWeatherMap API Key（天氣）

1. 前往 [openweathermap.org/api](https://openweathermap.org/api) 免費註冊
2. 在帳號 Dashboard 取得 **API Key**
3. 開啟 [js/app.js](js/app.js)，找到第一行設定，填入 Key：
   ```javascript
   const CONFIG = {
     OPENWEATHER_API_KEY: '填入你的_API_Key',  // ← 改這裡
     ...
   };
   ```

---

### 第三步：Notion 整合

#### 3-1 建立 Notion Integration

1. 前往 [notion.so/my-integrations](https://www.notion.so/my-integrations)
2. 點「+ New integration」
3. 名稱填 `Daily Dashboard`，選你的工作區，能力選「Read content」
4. 建立後複製 **Internal Integration Secret**（格式：`secret_xxx...`）

#### 3-2 建立「每日代辦」資料庫

在 Notion 新增一個全頁資料庫，欄位如下：

| 欄位名稱 | 類型 | 選項設定 |
|---------|------|---------|
| 名稱 | 標題（預設） | — |
| 狀態 | 單選 | `待處理` / `進行中` / `已完成` |
| 截止日期 | 日期 | — |
| 優先級 | 單選 | `Low` / `Medium` / `High` |
| 分類 | 單選 | `個人` / `工作` / `學習` / `健康` / `其他` |
| 積分 | 數字 | — |
| 備注 | 文字 | — |

完成後：
- 點右上角 **Share** → **Invite** → 選「Daily Dashboard」integration
- 複製資料庫網址中的 ID（`notion.so/工作區/這串ID?v=...`，32 位英數字元）

#### 3-3 建立「影片題材」資料庫

| 欄位名稱 | 類型 | 選項設定 |
|---------|------|---------|
| 題材 | 標題（預設） | — |
| 狀態 | 單選 | `構思中` / `準備中` / `拍攝中` / `剪輯中` / `已發布` |
| 預計拍片日期 | 日期 | — |
| 平台 | 單選 | `YouTube` / `TikTok` / `Instagram` / `Blog` / `其他` |
| 標籤 | 多選 | 自訂 |
| 備注 | 文字 | — |

同樣 Share 給 integration，複製資料庫 ID。

---

### 第四步：設定 GitHub Secrets

到 repo → **Settings → Secrets and variables → Actions → New repository secret**，依序新增：

| Secret 名稱 | 填入內容 |
|------------|---------|
| `NOTION_API_KEY` | 第三步的 Internal Integration Secret |
| `NOTION_TODO_DB_ID` | 每日代辦資料庫 ID |
| `NOTION_CONTENT_DB_ID` | 影片題材資料庫 ID |
| `RSS_FEED_URLS` | 每行一個 RSS 連結（見下方範例） |

**RSS_FEED_URLS 範例**（每行一個，填自己想追蹤的）：
```
https://www.cna.com.tw/rss/aall.aspx
https://feeds.feedburner.com/Inside-Line
https://www.bnext.com.tw/rss
```

---

### 第五步：Google 日曆 OAuth

1. 前往 [Google Cloud Console](https://console.cloud.google.com)，建立新專案
2. 左側選「APIs & Services → Library」→ 搜尋「Google Calendar API」→ 啟用
3. 左側選「APIs & Services → Credentials」→「Create Credentials → OAuth client ID」
   - 應用程式類型：**Web application**
   - 授權的 JavaScript 來源：填入你的 GitHub Pages 網址（例如 `https://你的帳號.github.io`）
4. 複製 **Client ID**（格式：`xxx.apps.googleusercontent.com`）
5. 開啟 [js/app.js](js/app.js)，填入 Client ID：
   ```javascript
   const CONFIG = {
     GOOGLE_CLIENT_ID: '填入你的_Client_ID',  // ← 改這裡
     ...
   };
   ```
6. 在 Google Cloud Console → **OAuth consent screen** → 新增你的 Gmail 為「Test user」

---

### 第六步：觸發第一次更新

1. 推送所有檔案到 GitHub repo
2. 前往 repo → **Actions** 頁面
3. 選左側「每日資料更新」→ 右側「Run workflow」→ 確認執行
4. 等待約 60 秒執行完成
5. 確認 `data/daily.json` 已被更新
6. 開啟你的 GitHub Pages 網址，檢查是否正常顯示

---

## 自動排程

GitHub Actions 已設定每天 **台灣時間早上 9:00**（UTC 01:00）自動執行。

> GitHub Actions cron 可能延遲最多 15 分鐘，屬正常現象。

---

## 遊戲化系統說明

| 動作 | 獲得 XP |
|------|--------|
| 完成低優先度代辦 | +10 XP |
| 完成中優先度代辦 | +15 XP |
| 完成高優先度代辦 | +20 XP |
| 連續天數獎勵 | +5 XP（每天疊加）|

| 等級 | 所需累積 XP |
|------|------------|
| Lv 1 | 0 |
| Lv 2 | 100 |
| Lv 3 | 300 |
| Lv 4 | 600 |
| Lv 5 | 1,000 |
| Lv 6 | 1,500 |
| Lv 7 | 2,100 |
| Lv 8 | 2,800 |
| Lv 9 | 3,600 |
| Lv 10 | 4,500+ |

### 成就徽章

| 圖示 | 名稱 | 解鎖條件 |
|------|------|---------|
| 🌱 | 第一步 | 完成第一個代辦 |
| 🐦 | 早起鳥 | 中午前完成任一代辦 |
| 🔥 | 週連勝 | 連續七天有完成代辦 |
| ⚡ | 無法阻擋 | 連續三十天有完成代辦 |
| 💯 | 完美一天 | 當日代辦全部完成 |
| 🎬 | 內容創作者 | 影片題材累計完成五支 |
| 🏆 | 頻道主力 | 影片題材累計完成二十支 |

---

## 檔案結構

```
每日通知/
├── index.html                    # 主頁面
├── css/style.css                 # 樣式
├── js/app.js                     # 前端邏輯（修改 OPENWEATHER_API_KEY 與 GOOGLE_CLIENT_ID）
├── data/daily.json               # 每日資料（由 GitHub Actions 自動更新）
├── scripts/fetch_daily.py        # 資料抓取腳本
└── .github/workflows/
    └── daily-update.yml          # 每日排程工作流程
```

---

## 常見問題

**Q：天氣顯示「請在 js/app.js 設定 OPENWEATHER_API_KEY」**
A：開啟 `js/app.js`，將 `YOUR_OPENWEATHER_API_KEY` 換成你的 Key，推送到 GitHub。

**Q：Google 日曆按下後沒有反應或顯示錯誤**
A：確認 Google Cloud Console 的「授權 JavaScript 來源」是否包含你的 Pages 網址，且 Gmail 帳號已加入 Test users。

**Q：Notion 資料沒有更新**
A：確認 GitHub Secrets 的三個值都填正確，且資料庫已 Share 給 integration（每個資料庫都要分別 Share）。

**Q：手動觸發 Actions 後 daily.json 沒有改變**
A：到 Actions → 點開那次執行 → 查看 log 確認哪個步驟失敗，通常是 Secret 設定問題。

**Q：資料都存在哪裡？**
A：天氣、新聞、Notion 資料存在 `data/daily.json`。代辦完成狀態、手動代辦、積分等存在你的瀏覽器 `localStorage`，不同裝置不會同步。
