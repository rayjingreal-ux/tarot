(() => {
  "use strict";

  const ASSET_ROOT = "../assets/unveiled/";
  const VERSION = "20260830-unveiled-02";
  const EXPECTED_COUNT = 80;
  const EXPECTED_THUMBNAIL = [240, 420];
  const TRANSPARENT_ALPHA_MAX = 8;
  const OPAQUE_ALPHA_MIN = 239;
  const EDGE_SAMPLE_INSET = 1;

  const grid = document.querySelector("#cardGrid");
  const template = document.querySelector("#cardTemplate");
  const totalCount = document.querySelector("#totalCount");
  const loadedCount = document.querySelector("#loadedCount");
  const errorCount = document.querySelector("#errorCount");
  const alphaCount = document.querySelector("#alphaCount");
  const statusMessage = document.querySelector("#statusMessage");
  const viewer = document.querySelector("#viewer");
  const viewerImage = document.querySelector("#viewerImage");
  const viewerIndex = document.querySelector("#viewerIndex");
  const viewerTitle = document.querySelector("#viewerTitle");
  const viewerSubtitle = document.querySelector("#viewerSubtitle");
  const viewerClose = document.querySelector("#viewerClose");

  const state = { passed: 0, alphaPassed: 0, errors: 0, settled: 0, manifest: [] };

  function suitKey(suit) {
    const normalized = String(suit).toLowerCase();
    if (normalized.includes("major")) return "major";
    if (normalized.includes("wand")) return "wands";
    if (normalized.includes("cup")) return "cups";
    if (normalized.includes("sword")) return "swords";
    return "pentacles";
  }

  function assetUrl(path) {
    return `${ASSET_ROOT}${path}?v=${VERSION}`;
  }

  function sampleAlpha(context, x, y) {
    return context.getImageData(x, y, 1, 1).data[3];
  }

  function inspectThumbnail(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const sizeOK = width === EXPECTED_THUMBNAIL[0]
      && height === EXPECTED_THUMBNAIL[1];
    const ratioOK = width > 0 && height > 0 && width * 7 === height * 4;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("瀏覽器無法建立 Canvas 2D 檢查環境");
    context.drawImage(image, 0, 0);

    const lastX = width - 1;
    const lastY = height - 1;
    const middleX = Math.floor(width / 2);
    const middleY = Math.floor(height / 2);
    const alpha = {
      topLeft: sampleAlpha(context, 0, 0),
      topRight: sampleAlpha(context, lastX, 0),
      bottomRight: sampleAlpha(context, lastX, lastY),
      bottomLeft: sampleAlpha(context, 0, lastY),
      center: sampleAlpha(context, middleX, middleY),
      top: sampleAlpha(context, middleX, EDGE_SAMPLE_INSET),
      right: sampleAlpha(context, lastX - EDGE_SAMPLE_INSET, middleY),
      bottom: sampleAlpha(context, middleX, lastY - EDGE_SAMPLE_INSET),
      left: sampleAlpha(context, EDGE_SAMPLE_INSET, middleY),
    };
    const cornerAlpha = [alpha.topLeft, alpha.topRight, alpha.bottomRight, alpha.bottomLeft];
    const solidAlpha = [alpha.center, alpha.top, alpha.right, alpha.bottom, alpha.left];
    const cornersOK = cornerAlpha.every((value) => value <= TRANSPARENT_ALPHA_MAX);
    const solidOK = solidAlpha.every((value) => value >= OPAQUE_ALPHA_MIN);
    const alphaOK = cornersOK && solidOK;

    return {
      width,
      height,
      sizeOK,
      ratioOK,
      cornersOK,
      solidOK,
      alphaOK,
      alpha,
      passed: sizeOK && ratioOK && alphaOK,
    };
  }

  function inspectionDescription(result) {
    const cornerValues = [
      result.alpha.topLeft,
      result.alpha.topRight,
      result.alpha.bottomRight,
      result.alpha.bottomLeft,
    ].join("/");
    const solidValues = [
      result.alpha.center,
      result.alpha.top,
      result.alpha.right,
      result.alpha.bottom,
      result.alpha.left,
    ].join("/");
    return `${result.width}×${result.height}；角 Alpha ${cornerValues}；中央/上/右/下/左（邊緣內縮 1px）Alpha ${solidValues}`;
  }

  function updateStatus() {
    loadedCount.textContent = String(state.passed);
    errorCount.textContent = String(state.errors);
    alphaCount.textContent = String(state.alphaPassed);
    if (state.settled < state.manifest.length) {
      statusMessage.classList.remove("is-good", "is-bad");
      statusMessage.textContent = `正在核對 ${state.settled} / ${state.manifest.length} 張：尺寸、4:7、四角透明與中心實心…`;
      return;
    }
    const countOK = state.manifest.length === EXPECTED_COUNT;
    const allOK = countOK && state.errors === 0 && state.passed === EXPECTED_COUNT;
    statusMessage.classList.toggle("is-good", allOK);
    statusMessage.classList.toggle("is-bad", !allOK);
    statusMessage.textContent = allOK
      ? "80 / 80 全部通過：240×420、4:7、四角透明，中央與四邊中心（內縮 1px）均為實心。"
      : `核對完成：清單 ${state.manifest.length} / ${EXPECTED_COUNT}；${state.passed} 張全部通過，${state.errors} 張需處理。`;
  }

  function openViewer({ src, index = "", title, subtitle = "" }) {
    viewerImage.src = src;
    viewerImage.alt = title;
    viewerIndex.textContent = index;
    viewerTitle.textContent = title;
    viewerSubtitle.textContent = subtitle;
    if (typeof viewer.showModal === "function") viewer.showModal();
    else viewer.setAttribute("open", "");
  }

  function renderCard(card) {
    const fragment = template.content.cloneNode(true);
    const article = fragment.querySelector(".card-item");
    const button = fragment.querySelector(".card-button");
    const image = fragment.querySelector("img");
    const number = fragment.querySelector(".card-number");
    const english = fragment.querySelector("strong");
    const chinese = fragment.querySelector("small");
    const cardState = fragment.querySelector(".card-state");

    const index = String(card.index).padStart(2, "0");
    article.dataset.suit = suitKey(card.suit);
    number.textContent = index;
    english.textContent = card.name;
    chinese.textContent = card.nameZh;
    image.alt = `${index} ${card.name} ${card.nameZh}`;
    image.src = assetUrl(card.thumbnail);

    image.addEventListener("load", () => {
      state.settled += 1;
      try {
        const result = inspectThumbnail(image);
        const details = inspectionDescription(result);
        if (result.alphaOK) state.alphaPassed += 1;
        if (result.passed) {
          state.passed += 1;
          article.classList.add("is-loaded");
          cardState.textContent = "尺寸／比例／Alpha 通過";
          cardState.title = details;
        } else {
          const issues = [];
          if (!result.sizeOK) issues.push(`尺寸 ${result.width}×${result.height}`);
          if (!result.ratioOK) issues.push("比例非 4:7");
          if (!result.cornersOK) issues.push("四角未透明");
          if (!result.solidOK) issues.push("中心或邊緣非實心");
          state.errors += 1;
          article.classList.add("is-error");
          cardState.textContent = issues.join("、");
          cardState.title = details;
        }
      } catch (error) {
        state.errors += 1;
        article.classList.add("is-error");
        cardState.textContent = "Alpha 無法驗證";
        cardState.title = error.message;
      }
      updateStatus();
    }, { once: true });

    image.addEventListener("error", () => {
      state.settled += 1;
      state.errors += 1;
      article.classList.add("is-error");
      cardState.textContent = "失敗";
      updateStatus();
    }, { once: true });

    button.addEventListener("click", () => openViewer({
      src: assetUrl(card.file),
      index,
      title: card.name,
      subtitle: `${card.nameZh} · ${card.suit}`,
    }));
    grid.append(fragment);
  }

  async function initialize() {
    try {
      const response = await fetch(`${ASSET_ROOT}cards-manifest.json?v=${VERSION}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const manifest = await response.json();
      if (!Array.isArray(manifest)) throw new Error("manifest 格式不是陣列");
      state.manifest = manifest;
      totalCount.textContent = String(manifest.length);
      manifest.forEach(renderCard);
      updateStatus();
    } catch (error) {
      statusMessage.classList.add("is-bad");
      statusMessage.textContent = `無法載入卡牌清單：${error.message}`;
    }
  }

  document.querySelectorAll(".filter").forEach((filter) => {
    filter.addEventListener("click", () => {
      const selected = filter.dataset.filter;
      document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("is-active", item === filter));
      document.querySelectorAll(".card-item").forEach((card) => {
        card.hidden = selected !== "all" && card.dataset.suit !== selected;
      });
    });
  });

  document.querySelector("#backPreview").addEventListener("click", () => openViewer({
    src: `${ASSET_ROOT}card-back.webp?v=${VERSION}`,
    title: "The Unveiled Tarot 卡牌背面",
    subtitle: "實體牌背 · 透視拉正與布面移除成果",
  }));

  viewerClose.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });

  initialize();
})();
