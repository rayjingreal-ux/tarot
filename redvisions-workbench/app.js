(() => {
  "use strict";

  const ASSET_ROOT = "../assets/redvisions/";
  const VERSION = "20260824-redvisions-01";
  const EXPECTED_COUNT = 78;
  const EXPECTED_THUMBNAIL = [240, 420];

  const grid = document.querySelector("#cardGrid");
  const template = document.querySelector("#cardTemplate");
  const totalCount = document.querySelector("#totalCount");
  const loadedCount = document.querySelector("#loadedCount");
  const errorCount = document.querySelector("#errorCount");
  const statusMessage = document.querySelector("#statusMessage");
  const viewer = document.querySelector("#viewer");
  const viewerImage = document.querySelector("#viewerImage");
  const viewerIndex = document.querySelector("#viewerIndex");
  const viewerTitle = document.querySelector("#viewerTitle");
  const viewerSubtitle = document.querySelector("#viewerSubtitle");
  const viewerClose = document.querySelector("#viewerClose");

  const state = { loaded: 0, errors: 0, settled: 0, manifest: [] };

  function suitKey(suit) {
    const normalized = String(suit).toLowerCase();
    if (normalized.includes("major")) return "major";
    if (normalized.includes("wand")) return "wands";
    if (normalized.includes("cup")) return "cups";
    if (normalized.includes("sword")) return "swords";
    return "coins";
  }

  function assetUrl(path) {
    return `${ASSET_ROOT}${path}?v=${VERSION}`;
  }

  function updateStatus() {
    loadedCount.textContent = String(state.loaded);
    errorCount.textContent = String(state.errors);

    if (state.settled < state.manifest.length) {
      statusMessage.textContent = `正在核對 ${state.settled} / ${state.manifest.length} 張…`;
      return;
    }

    const countOK = state.manifest.length === EXPECTED_COUNT;
    const allOK = countOK && state.errors === 0 && state.loaded === EXPECTED_COUNT;
    statusMessage.classList.toggle("is-good", allOK);
    statusMessage.classList.toggle("is-bad", !allOK);
    statusMessage.textContent = allOK
      ? "78 張縮圖均已載入，尺寸與 4:7 比例一致"
      : `核對完成：${state.loaded} 張正常、${state.errors} 張需處理`;
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
      const sizeOK = image.naturalWidth === EXPECTED_THUMBNAIL[0]
        && image.naturalHeight === EXPECTED_THUMBNAIL[1];
      state.settled += 1;
      if (sizeOK) {
        state.loaded += 1;
        article.classList.add("is-loaded");
        cardState.textContent = "正常";
      } else {
        state.errors += 1;
        article.classList.add("is-error");
        cardState.textContent = `${image.naturalWidth}×${image.naturalHeight}`;
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
      subtitle: `${card.nameZh} · ${card.suit}`
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
    title: "Red Visions 卡牌背面",
    subtitle: "透視拉正與布面移除成果"
  }));

  viewerClose.addEventListener("click", () => viewer.close());
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });

  initialize();
})();
