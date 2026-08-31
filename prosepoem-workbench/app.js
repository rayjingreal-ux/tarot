(() => {
  "use strict";

  const ASSET_ROOT = "../assets/prosepoem/";
  const MANIFEST_URL = `${ASSET_ROOT}cards-manifest.json`;
  const CARD_BACK_URL = `${ASSET_ROOT}card-back.webp`;
  const VERSION = "20260831-prosepoem-01";
  const EXPECTED_COUNT = 80;
  const EXPECTED_THUMBNAIL = Object.freeze([240, 420]);
  const TRANSPARENT_ALPHA_MAX = 8;
  const OPAQUE_ALPHA_MIN = 239;
  const EDGE_SAMPLE_INSET = 1;

  const CATEGORY_DEFINITIONS = Object.freeze([
    { key: "major", label: "大阿爾克那", tokens: ["major", "大阿爾克那", "大牌"] },
    { key: "wands", label: "權杖", tokens: ["wand", "權杖"] },
    { key: "cups", label: "聖杯", tokens: ["cup", "chalice", "聖杯"] },
    { key: "swords", label: "寶劍", tokens: ["sword", "寶劍"] },
    { key: "pentacles", label: "錢幣", tokens: ["pentacle", "coin", "disk", "disc", "錢幣", "星幣"] },
  ]);

  const elements = {
    grid: document.querySelector("#cardGrid"),
    template: document.querySelector("#cardTemplate"),
    filters: document.querySelector("#filters"),
    totalCount: document.querySelector("#totalCount"),
    sizeCount: document.querySelector("#sizeCount"),
    ratioCount: document.querySelector("#ratioCount"),
    alphaCount: document.querySelector("#alphaCount"),
    errorCount: document.querySelector("#errorCount"),
    resultCount: document.querySelector("#resultCount"),
    statusMessage: document.querySelector("#statusMessage"),
    variantStatus: document.querySelector("#variantStatus"),
    emptyState: document.querySelector("#emptyState"),
    backPreview: document.querySelector("#backPreview"),
    viewer: document.querySelector("#viewer"),
    viewerImage: document.querySelector("#viewerImage"),
    viewerIndex: document.querySelector("#viewerIndex"),
    viewerCounter: document.querySelector("#viewerCounter"),
    viewerTitle: document.querySelector("#viewerTitle"),
    viewerSubtitle: document.querySelector("#viewerSubtitle"),
    viewerSuit: document.querySelector("#viewerSuit"),
    viewerChecks: document.querySelector("#viewerChecks"),
    viewerClose: document.querySelector("#viewerClose"),
    viewerPrevious: document.querySelector("#viewerPrevious"),
    viewerNext: document.querySelector("#viewerNext"),
  };

  const state = {
    manifest: [],
    categoryMeta: new Map(),
    inspections: new Map(),
    activeFilter: "all",
    viewerPosition: null,
    viewerIsCard: false,
    settled: 0,
    sizePassed: 0,
    ratioPassed: 0,
    alphaPassed: 0,
    passed: 0,
    errors: 0,
  };

  function assetUrl(path) {
    if (!path) return "";
    const normalized = String(path).replace(/^\.\//, "");
    return `${ASSET_ROOT}${normalized}?v=${VERSION}`;
  }

  function normalizeManifest(payload) {
    const cards = Array.isArray(payload) ? payload : payload && Array.isArray(payload.cards) ? payload.cards : null;
    if (!cards) throw new Error("牌面清單格式不正確");

    return cards.map((card, position) => ({
      ...card,
      _position: position,
      _category: categoryFor(card),
    }));
  }

  function categoryFor(card) {
    const source = String(card.suit || card.category || card.group || "其他").toLowerCase();
    const known = CATEGORY_DEFINITIONS.find((definition) => definition.tokens.some((token) => source.includes(token)));
    if (known) return { key: known.key, label: known.label, order: CATEGORY_DEFINITIONS.indexOf(known) };

    const fallbackLabel = String(card.suit || card.category || card.group || "其他").trim() || "其他";
    const fallbackKey = `category-${fallbackLabel.toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")}`;
    return { key: fallbackKey, label: fallbackLabel, order: CATEGORY_DEFINITIONS.length };
  }

  function buildCategoryMeta(cards) {
    const categoryMeta = new Map();
    cards.forEach((card) => {
      const current = categoryMeta.get(card._category.key);
      if (current) current.count += 1;
      else categoryMeta.set(card._category.key, { ...card._category, count: 1 });
    });

    return new Map([...categoryMeta.entries()].sort(([, left], [, right]) => {
      if (left.order !== right.order) return left.order - right.order;
      return left.label.localeCompare(right.label, "zh-Hant");
    }));
  }

  function createFilter(key, label, count, active = false) {
    const button = document.createElement("button");
    const countElement = document.createElement("span");
    button.type = "button";
    button.className = "filter";
    button.dataset.filter = key;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
    button.append(document.createTextNode(label));
    countElement.textContent = String(count);
    button.append(countElement);
    button.addEventListener("click", () => setFilter(key));
    return button;
  }

  function renderFilters() {
    elements.filters.replaceChildren();
    elements.filters.append(createFilter("all", "全部", state.manifest.length, true));
    state.categoryMeta.forEach((category) => {
      elements.filters.append(createFilter(category.key, category.label, category.count));
    });
  }

  function filteredCards() {
    return state.activeFilter === "all"
      ? state.manifest
      : state.manifest.filter((card) => card._category.key === state.activeFilter);
  }

  function setFilter(key) {
    state.activeFilter = key;
    elements.filters.querySelectorAll(".filter").forEach((filter) => {
      const isActive = filter.dataset.filter === key;
      filter.classList.toggle("is-active", isActive);
      filter.setAttribute("aria-pressed", String(isActive));
    });

    elements.grid.querySelectorAll(".card-item").forEach((article) => {
      article.hidden = key !== "all" && article.dataset.category !== key;
    });

    const visible = filteredCards();
    const label = key === "all" ? "全部牌面" : state.categoryMeta.get(key)?.label || "此分類";
    elements.resultCount.textContent = `${label} · ${visible.length} 張`;
    elements.emptyState.hidden = visible.length !== 0;
  }

  function sampleAlpha(context, x, y) {
    return context.getImageData(x, y, 1, 1).data[3];
  }

  function inspectThumbnail(image) {
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const sizeOK = width === EXPECTED_THUMBNAIL[0] && height === EXPECTED_THUMBNAIL[1];
    const ratioOK = width > 0 && height > 0 && width * 7 === height * 4;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("瀏覽器無法建立透明度檢查環境");
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
    const cornersOK = [alpha.topLeft, alpha.topRight, alpha.bottomRight, alpha.bottomLeft]
      .every((value) => value <= TRANSPARENT_ALPHA_MAX);
    const solidOK = [alpha.center, alpha.top, alpha.right, alpha.bottom, alpha.left]
      .every((value) => value >= OPAQUE_ALPHA_MIN);
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

  function resultDetails(result) {
    const corners = [result.alpha.topLeft, result.alpha.topRight, result.alpha.bottomRight, result.alpha.bottomLeft].join("/");
    const solids = [result.alpha.center, result.alpha.top, result.alpha.right, result.alpha.bottom, result.alpha.left].join("/");
    return `${result.width}×${result.height}；角 Alpha ${corners}；中央與四邊 Alpha ${solids}`;
  }

  function settleInspection(position, result) {
    state.settled += 1;
    state.inspections.set(position, result);
    if (result.sizeOK) state.sizePassed += 1;
    if (result.ratioOK) state.ratioPassed += 1;
    if (result.alphaOK) state.alphaPassed += 1;
    if (result.passed) state.passed += 1;
    else state.errors += 1;
    updateStatus();

    if (state.viewerIsCard && state.viewerPosition === position) renderViewerChecks(result);
  }

  function failInspection(position, message) {
    state.settled += 1;
    state.errors += 1;
    const result = { failedToInspect: true, message, passed: false };
    state.inspections.set(position, result);
    updateStatus();
    if (state.viewerIsCard && state.viewerPosition === position) renderViewerChecks(result);
  }

  function updateStatus() {
    elements.sizeCount.textContent = String(state.sizePassed);
    elements.ratioCount.textContent = String(state.ratioPassed);
    elements.alphaCount.textContent = String(state.alphaPassed);
    elements.errorCount.textContent = String(state.errors);

    if (state.settled < state.manifest.length) {
      elements.statusMessage.classList.remove("is-good", "is-bad");
      elements.statusMessage.textContent = `正在核對 ${state.settled} / ${state.manifest.length} 張：尺寸、4:7 與透明圓角…`;
      return;
    }

    const countOK = state.manifest.length === EXPECTED_COUNT;
    const allOK = countOK && state.passed === EXPECTED_COUNT && state.errors === 0;
    elements.statusMessage.classList.toggle("is-good", allOK);
    elements.statusMessage.classList.toggle("is-bad", !allOK);
    elements.statusMessage.textContent = allOK
      ? "80 / 80 全部通過：240 × 420、4:7、四角透明，中央與四邊保持實心。"
      : `檢查完成：清單 ${state.manifest.length} / ${EXPECTED_COUNT}；${state.passed} 張完整通過，${state.errors} 張需處理。`;
  }

  function indexLabel(card) {
    const value = Number.isFinite(Number(card.index)) ? Number(card.index) : card._position;
    return String(value).padStart(2, "0");
  }

  function cardTitle(card) {
    return String(card.name || card.title || `Card ${card._position + 1}`);
  }

  function cardTitleZh(card) {
    return String(card.nameZh || card.titleZh || card.chineseName || "");
  }

  function cardFile(card) {
    return card.file || card.image || card.src || card.thumbnail;
  }

  function thumbnailFile(card) {
    return card.thumbnail || card.thumb || card.file || card.image || card.src;
  }

  function renderCard(card) {
    const fragment = elements.template.content.cloneNode(true);
    const article = fragment.querySelector(".card-item");
    const button = fragment.querySelector(".card-button");
    const image = fragment.querySelector("img");
    const number = fragment.querySelector(".card-number");
    const english = fragment.querySelector("strong");
    const chinese = fragment.querySelector("small");
    const cardState = fragment.querySelector(".card-state");
    const title = cardTitle(card);
    const titleZh = cardTitleZh(card);
    const index = indexLabel(card);

    article.dataset.category = card._category.key;
    article.dataset.position = String(card._position);
    number.textContent = index;
    english.textContent = title;
    chinese.textContent = titleZh || card._category.label;
    image.alt = `${index} ${title}${titleZh ? ` ${titleZh}` : ""}`;

    image.addEventListener("load", () => {
      try {
        const result = inspectThumbnail(image);
        const details = resultDetails(result);
        settleInspection(card._position, result);
        cardState.title = details;
        if (result.passed) {
          article.classList.add("is-loaded");
          cardState.textContent = "4:7 · 尺寸 · 圓角透明";
          cardState.setAttribute("aria-label", "尺寸、4 比 7 比例與透明圓角均通過");
        } else {
          const issues = [];
          if (!result.sizeOK) issues.push(`${result.width}×${result.height}`);
          if (!result.ratioOK) issues.push("非 4:7");
          if (!result.cornersOK) issues.push("四角未透明");
          if (!result.solidOK) issues.push("中心或邊緣非實心");
          article.classList.add("is-error");
          cardState.textContent = issues.join(" · ");
          cardState.setAttribute("aria-label", `需處理：${issues.join("、")}`);
        }
      } catch (error) {
        article.classList.add("is-error");
        cardState.textContent = "無法檢查 Alpha";
        cardState.title = error.message;
        failInspection(card._position, error.message);
      }
    }, { once: true });

    image.addEventListener("error", () => {
      article.classList.add("is-error");
      cardState.textContent = "縮圖載入失敗";
      cardState.setAttribute("aria-label", "縮圖載入失敗");
      failInspection(card._position, "縮圖載入失敗");
    }, { once: true });

    button.addEventListener("click", () => openCard(card._position));
    image.src = assetUrl(thumbnailFile(card));
    elements.grid.append(fragment);
  }

  function canonicalVariantName(card) {
    return cardTitle(card)
      .toLowerCase()
      .replace(/[（(\[\s_-]+[ab][）)\]\s]*$/i, "")
      .replace(/^the\s+/, "")
      .replace(/^ten\s+of\s+swords$/, "10 of swords")
      .trim();
  }

  function variantLabel(card, order, total) {
    const explicit = String(card.variant || card.version || "").trim().toUpperCase();
    if (explicit === "A" || explicit === "B") return explicit;
    const match = cardTitle(card).match(/(?:^|[\s_\-(（])([AB])(?:[\s)）\]]*)$/i);
    if (match) return match[1].toUpperCase();
    if (total === 2) return order === 0 ? "A" : "B";
    return "";
  }

  function inspectRequiredVariants() {
    const targets = [
      { key: "hierophant", label: "The Hierophant" },
      { key: "10 of swords", label: "Ten of Swords" },
    ];
    const reports = targets.map((target) => {
      const cards = state.manifest.filter((card) => canonicalVariantName(card) === target.key);
      const variants = new Set(cards.map((card, index) => variantLabel(card, index, cards.length)).filter(Boolean));
      return { ...target, cards, variants, passed: cards.length === 2 && variants.has("A") && variants.has("B") };
    });
    const allPassed = reports.every((report) => report.passed);
    elements.variantStatus.classList.toggle("is-good", allPassed);
    elements.variantStatus.classList.toggle("is-bad", !allPassed);
    elements.variantStatus.textContent = allPassed
      ? "雙版本已保留：The Hierophant A／B · Ten of Swords A／B。"
      : reports.map((report) => `${report.label} ${report.cards.length} 張`).join(" · ");
  }

  function ensureViewerOpen() {
    if (elements.viewer.open) return;
    if (typeof elements.viewer.showModal === "function") elements.viewer.showModal();
    else elements.viewer.setAttribute("open", "");
  }

  function openCard(position) {
    const card = state.manifest[position];
    if (!card) return;
    state.viewerPosition = position;
    state.viewerIsCard = true;
    renderViewerCard(card);
    ensureViewerOpen();
  }

  function renderViewerCard(card) {
    const visible = filteredCards();
    const visibleIndex = visible.findIndex((item) => item._position === card._position);
    const title = cardTitle(card);
    const titleZh = cardTitleZh(card);
    elements.viewerImage.src = assetUrl(cardFile(card));
    elements.viewerImage.alt = `${title}${titleZh ? ` ${titleZh}` : ""}`;
    elements.viewerIndex.textContent = indexLabel(card);
    elements.viewerCounter.textContent = `${visibleIndex + 1} / ${visible.length}`;
    elements.viewerTitle.textContent = title;
    elements.viewerSubtitle.textContent = titleZh || "散文詩塔羅";
    elements.viewerSuit.textContent = `${card._category.label}${card.rank ? ` · ${card.rank}` : ""}`;
    elements.viewerPrevious.disabled = visibleIndex <= 0;
    elements.viewerNext.disabled = visibleIndex < 0 || visibleIndex >= visible.length - 1;
    renderViewerChecks(state.inspections.get(card._position));
  }

  function renderViewerChecks(result) {
    elements.viewerChecks.replaceChildren();
    if (!result) {
      elements.viewerChecks.append(createCheckPill("牌面檢查中", null));
      return;
    }
    if (result.failedToInspect) {
      elements.viewerChecks.append(createCheckPill(result.message || "無法檢查", false));
      return;
    }
    elements.viewerChecks.append(
      createCheckPill(`${result.width} × ${result.height}`, result.sizeOK),
      createCheckPill("4:7", result.ratioOK),
      createCheckPill("透明圓角", result.alphaOK),
    );
  }

  function createCheckPill(text, passed) {
    const element = document.createElement("span");
    element.className = "check-pill";
    if (passed === true) element.classList.add("is-good");
    if (passed === false) element.classList.add("is-bad");
    element.textContent = text;
    return element;
  }

  function navigateViewer(direction) {
    if (!state.viewerIsCard || state.viewerPosition === null) return;
    const visible = filteredCards();
    const current = visible.findIndex((card) => card._position === state.viewerPosition);
    const next = visible[current + direction];
    if (next) openCard(next._position);
  }

  function jumpViewer(toEnd) {
    if (!state.viewerIsCard) return;
    const visible = filteredCards();
    const card = toEnd ? visible.at(-1) : visible[0];
    if (card) openCard(card._position);
  }

  function openCardBack() {
    state.viewerIsCard = false;
    state.viewerPosition = null;
    elements.viewerImage.src = `${CARD_BACK_URL}?v=${VERSION}`;
    elements.viewerImage.alt = "散文詩塔羅牌背";
    elements.viewerIndex.textContent = "BACK";
    elements.viewerCounter.textContent = "牌背";
    elements.viewerTitle.textContent = "PROSE POEM TAROT";
    elements.viewerSubtitle.textContent = "散文詩塔羅 · 牌背";
    elements.viewerSuit.textContent = "CARD BACK";
    elements.viewerPrevious.disabled = true;
    elements.viewerNext.disabled = true;
    elements.viewerChecks.replaceChildren(createCheckPill("4:7 顯示比例", true));
    ensureViewerOpen();
  }

  function closeViewer() {
    if (typeof elements.viewer.close === "function") elements.viewer.close();
    else elements.viewer.removeAttribute("open");
  }

  async function initialize() {
    try {
      const response = await fetch(`${MANIFEST_URL}?v=${VERSION}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.manifest = normalizeManifest(await response.json());
      state.categoryMeta = buildCategoryMeta(state.manifest);
      elements.totalCount.textContent = String(state.manifest.length);
      renderFilters();
      state.manifest.forEach(renderCard);
      inspectRequiredVariants();
      setFilter("all");
      updateStatus();
      elements.grid.setAttribute("aria-busy", "false");
    } catch (error) {
      elements.grid.setAttribute("aria-busy", "false");
      elements.statusMessage.classList.add("is-bad");
      elements.statusMessage.textContent = `無法載入牌面清單：${error.message}`;
      elements.resultCount.textContent = "清單載入失敗";
      elements.emptyState.hidden = false;
      elements.emptyState.querySelector("strong").textContent = "無法顯示牌面";
      elements.emptyState.querySelector("span").textContent = "請確認 cards-manifest.json 已建立。";
    }
  }

  elements.backPreview.addEventListener("click", openCardBack);
  elements.viewerClose.addEventListener("click", closeViewer);
  elements.viewerPrevious.addEventListener("click", () => navigateViewer(-1));
  elements.viewerNext.addEventListener("click", () => navigateViewer(1));
  elements.viewer.addEventListener("click", (event) => {
    if (event.target === elements.viewer) closeViewer();
  });

  document.addEventListener("keydown", (event) => {
    if (!elements.viewer.open) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      navigateViewer(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      navigateViewer(1);
    } else if (event.key === "Home") {
      event.preventDefault();
      jumpViewer(false);
    } else if (event.key === "End") {
      event.preventDefault();
      jumpViewer(true);
    }
  });

  initialize();
})();
