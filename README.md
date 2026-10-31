# 廚房 SOP 食譜及倍數計算系統

同一套介面，兩種版本：

| 版本 | 位置 | 資料存放 |
|---|---|---|
| PWA 網頁版（手機／平板／電腦） | `web/` | 瀏覽器 IndexedDB（各裝置各自一份） |
| Windows 版 | `dist/廚房SOP.exe` | `%APPDATA%\KitchenSOP\data.json`，每日自動備份到 `backups\`（保留 30 份） |

兩版可用「設定 → 匯出／匯入備份」互相搬移資料（JSON）。

## 功能
- 食譜：分類、照片、食材（可分組）、SOP 步驟（計時、重點標示）、備註；支援批次貼上食材／步驟
- 倍數計算：輸入倍數或目標份量；點食材旁的 ⚖ 輸入現有量（可用不同單位，如「5 台斤」）自動反推倍數
- 單位：g/kg/台斤/兩/lb/oz、ml/L/大匙/小匙/杯；顯示模式可選自動、原單位、公制、台制
- 成本：單價表（可用台斤、kg、顆…計價，自動換算），顯示每道菜總成本與每份成本
- 備料單：多道菜各自設倍數，合併相同食材的總量與成本，可列印
- 計時器：多個同時進行，時間到會響鈴、震動；手機可開「螢幕恆亮」

## PWA 部署
把 `web/` 整個資料夾放到任何 HTTPS 靜態網站（GitHub Pages、Netlify…）。手機開啟後「加入主畫面」即可離線使用。
本機測試：`cd web && python -m http.server 8765` 後開 http://127.0.0.1:8765 。
修改 JS/CSS 後請同步調整 `index.html` 的 `?v=` 與 `sw.js` 的 `CACHE` 版本。

## Windows 版打包
需要 Python、pywebview、PyInstaller、PySide6（只用來產生圖示）。

```
python build.py
```

測試用環境變數：`KITCHENSOP_DATA=<資料夾>`（改用獨立資料夾、略過單一執行個體限制）、`KITCHENSOP_SELFTEST=<結果.json>`（自動操作後寫出結果並關閉）。
