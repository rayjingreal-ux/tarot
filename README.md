# Tarot｜沉浸式塔羅藏書室

以 Three.js 製作的互動式塔羅展示頁，收錄 The Unveiled、Woodland Fairy Tale、Red Visions 與 Prose Poem 四副牌組。

## 線上檢閱

GitHub Pages：<https://rayjingreal-ux.github.io/tarot/>

## 目前功能

- 沉浸式藏書室入口與 3D 鑑賞舞台
- 由牌組 manifest 動態建立的 3D 牌盒輪播，中央藏品自動旋轉並帶有光輝，支援觸控、滑鼠滾輪、方向鍵與未來新增牌組
- 牌盒、說明書、第二層牌盒／直接牌堆的分段互動
- The Unveiled 完整 80 張校正版牌面與實體牌背（以 07 號為透視基準，保留四角圓角透明去背）
- Woodland、Red Visions 各 78 張完整牌面
- Prose Poem 80 張校正版牌面（完整 78 張，加上教皇與寶劍十替代圖稿各一張；盒面標示 83 張，現有素材缺 3 張）
- 無彈窗的抽牌儀式：先選十四種張數／牌陣之一，再提問、按住洗牌／星光選牌，全部在原有 3D 舞台進行
- 實體牌背雙環流動、金色與青綠星塵光軌；按住加速、放開減速，展牌後可直接拖曳／點選 3D 牌背
- 洗牌後先切牌，再抽主牌；切牌另留在牌陣總覽左下角，不計入主牌張數，也不會與主牌重複
- 主牌保留亂數抽取順序，逐張獨立隨機正逆位，不湊固定比例；翻牌與重試不會重抽結果
- 支援逐張／全部翻開、牌位選取與放大檢視；翻至正面前隱藏牌名與編號，可重新抽牌或收回牌盒
- Prose Poem 的教皇與寶劍十 A/B 圖稿以同一牌義等機率抽取，一般瀏覽仍保留全部 80 張
- 四副牌組的一般瀏覽／管理模式
- The Unveiled、Red Visions 與 Prose Poem 的獨立校正工作檯
- 依大阿爾克那與四個牌組分類篩選、逐張放大檢視
- 桌面與行動裝置響應式介面

## 本機預覽

在專案目錄執行：

```powershell
python -m http.server 8877
```

接著開啟 <http://127.0.0.1:8877/>。

## 專案結構

- `index.html`：頁面結構與模組入口
- `styles.css`：場景及操作介面樣式
- `app.js`：Three.js 場景、牌盒與卡牌互動
- `draw-ritual.js` / `draw-ritual.css`：抽牌儀式控制與響應式介面
- `draw-session.js`：獨立洗牌、變體分組、切牌排除、依序抽牌與逐張正逆位鎖定
- `draw-spreads.js`：十四種抽牌設定、牌位名稱與主牌／切牌的響應式舞台座標
- `ritual-layout.js`：原舞台上的洗牌、扇形選牌與飛入中央座標
- `ritual-effects.js`：可獨立回收的 Three.js 星塵、光軌、光環與低動態模式
- `tests/*.test.mjs`：四副牌組、抽牌規則、舞台排版與光效測試（`node --test tests/*.test.mjs`）
- `RELEASE-20260909.md`：新版驗收路徑與備份／回退方式
- `RELEASE-20260912.md`：原舞台洗牌改版的驗收與回退方式
- `RELEASE-20260913.md`：多張牌陣、隨機正逆位與切牌的驗收及回退方式
- `assets/cards/`：78 張透明 WebP 發佈牌圖
- `assets/woodland/`：Woodland 牌盒與說明書材質
- `assets/unveiled/`：The Unveiled 牌盒材質、80 張牌面、縮圖、清單與實體牌背
- `assets/prosepoem/`：Prose Poem 牌盒材質、80 張牌面、縮圖、清單與實體牌背
- `unveiled-workbench/`：The Unveiled 80 張卡牌校正工作檯
- `redvisions-workbench/`：Red Visions 78 張卡牌校正工作檯
- `prosepoem-workbench/`：Prose Poem 80 張卡牌校正工作檯
- `scripts/process_unveiled_assets.py`：The Unveiled 實拍牌面與牌背校正流程
- `scripts/validate_unveiled_assets.py`：檢查 80 張牌面、縮圖、牌背、圓角 Alpha 與 07 號投影比例
- `scripts/process_prosepoem_assets.py`：Prose Poem 牌面與牌背的逐張外框偵測、透視校正與圓角去背
- `scripts/process_prosepoem_box_assets.py`：Prose Poem 牌盒、牌托、說明書與牌背的確定性透視材質切圖
- `scripts/validate_prosepoem_assets.py`：檢查 80 張牌面、縮圖、牌背、統一 Alpha 與投影比例
- `vendor/three/`：網站所需的 Three.js 瀏覽器模組與授權

## 素材與授權

第三方程式授權請見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。牌圖、產品照片衍生材質及專案視覺素材未另行授權再利用。
