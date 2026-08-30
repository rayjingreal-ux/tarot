# Tarot｜沉浸式塔羅藏書室

以 Three.js 製作的互動式塔羅展示頁，收錄 The Unveiled、Woodland Fairy Tale 與 Red Visions 三副完整牌組。

## 線上檢閱

GitHub Pages：<https://rayjingreal-ux.github.io/tarot/>

## 目前功能

- 沉浸式藏書室入口與 3D 鑑賞舞台
- 牌盒、說明書、第二層牌盒的分段互動
- The Unveiled 完整 80 張校正版牌面與實體牌背
- Woodland、Red Visions 各 78 張完整牌面
- 展開牌陣預設顯示牌背
- 抽牌模式在翻至正面前隱藏牌名與編號
- 選牌、上一張／下一張與正反面翻牌
- 三副完整牌組的一般瀏覽／管理模式
- The Unveiled 與 Red Visions 的獨立校正工作檯
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
- `assets/cards/`：78 張透明 WebP 發佈牌圖
- `assets/woodland/`：Woodland 牌盒與說明書材質
- `assets/unveiled/`：The Unveiled 牌盒材質、80 張牌面、縮圖、清單與實體牌背
- `unveiled-workbench/`：The Unveiled 80 張卡牌校正工作檯
- `redvisions-workbench/`：Red Visions 78 張卡牌校正工作檯
- `scripts/process_unveiled_assets.py`：The Unveiled 實拍牌面與牌背校正流程
- `vendor/three/`：網站所需的 Three.js 瀏覽器模組與授權

## 素材與授權

第三方程式授權請見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。牌圖、產品照片衍生材質及專案視覺素材未另行授權再利用。
