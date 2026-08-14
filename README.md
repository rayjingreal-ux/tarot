# Tarot｜沉浸式塔羅藏書室

以 Three.js 製作的互動式塔羅展示頁，收錄 Woodland Fairy Tale Tarot 牌盒、說明書、第二層牌盒與完整 78 張牌。

## 線上檢閱

GitHub Pages：<https://rayjingreal-ux.github.io/tarot/>

## 目前功能

- 沉浸式藏書室入口與 3D 鑑賞舞台
- 牌盒、說明書、第二層牌盒的分段互動
- 78 張修正版牌面與透明邊緣
- 展開牌陣預設顯示牌背
- 選牌、上一張／下一張與正反面翻牌
- 預設收合的 78 張牌組目錄
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
- `assets/unveiled/`：另一副牌盒展示材質
- `vendor/three/`：網站所需的 Three.js 瀏覽器模組與授權

## 素材與授權

第三方程式授權請見 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。牌圖、產品照片衍生材質及專案視覺素材未另行授權再利用。
