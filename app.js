import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createDrawRitual } from "./draw-ritual.js?v=20260914-01";
import { markDrawRevealed, availableDrawPositions } from "./draw-session.js?v=20260913-01";
import { createRitualEffects } from "./ritual-effects.js?v=20260913-06";
import { getRitualCardPose } from "./ritual-layout.js?v=20260913-06";
import { getDrawSpread, getReadingCardPose } from "./draw-spreads.js?v=20260913-01";
import { createDeckTexturePlan, createDeckTextureCache, getTextureUrl } from "./texture-loading.js?v=20260913-02";
import { fitReadingLayout, readingNameWidth, readingLayoutMetrics } from "./reading-layout.js?v=20260914-01";
import { getCardDisplayName } from "./card-names.js?v=20260913-04";
import { createRingSelection } from "./ring-selection.js?v=20260913-05";
import { getCardFlipPose } from "./card-flip.js?v=20260913-05";
import { createReadingExportModel, renderReadingExport, readingExportBlob } from "./reading-export.js?v=20260914-01";
import { createReadingImageShare } from "./reading-share.js?v=20260914-01";
import { calculateDeckCarouselCameraFit } from "./deck-carousel-fit.js?v=20260913-06";


const MAJOR_ARCANA = [
  ["0", "THE FOOL", "fool"], ["I", "THE MAGICIAN", "magician"],
  ["II", "THE HIGH PRIESTESS", "high-priestess"], ["III", "THE EMPRESS", "empress"],
  ["IV", "THE EMPEROR", "emperor"], ["V", "THE HIEROPHANT", "hierophant"],
  ["VI", "THE LOVERS", "lovers"], ["VII", "THE CHARIOT", "chariot"],
  ["VIII", "STRENGTH", "strength"], ["IX", "THE HERMIT", "hermit"],
  ["X", "WHEEL OF FORTUNE", "wheel-of-fortune"], ["XI", "JUSTICE", "justice"],
  ["XII", "THE HANGED MAN", "hanged-man"], ["XIII", "DEATH", "death"],
  ["XIV", "TEMPERANCE", "temperance"], ["XV", "THE DEVIL", "devil"],
  ["XVI", "THE TOWER", "tower"], ["XVII", "THE STAR", "star"],
  ["XVIII", "THE MOON", "moon"], ["XIX", "THE SUN", "sun"],
  ["XX", "JUDGEMENT", "judgement"], ["XXI", "THE WORLD", "world"],
];
const MINOR_RANKS = ["ACE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE", "TEN", "PAGE", "KNIGHT", "QUEEN", "KING"];
const MINOR_SUITS = ["WANDS", "CUPS", "SWORDS", "PENTACLES"];
const DECK_INDEX_URL = "./assets/decks-manifest.json";
const LEGACY_CARD_MANIFEST_CANDIDATES = [
  "./assets/woodland/cards-manifest.json",
  "./assets/woodland/cards/cards-manifest.json",
  "./assets/woodland/textures/cards-manifest.json",
  "./assets/cards-manifest.json",
  "./cards-manifest.json",
];
const CARD_ASSET_VERSION = "manifest-pool-20260831-01";

function escapeSvgText(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  }[character]));
}

function createFallbackCardSource(card) {
  const title = escapeSvgText(card.name);
  const numeral = escapeSvgText(card.numeral);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="1000" viewBox="0 0 600 1000">
    <defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#e9d7a7"/><stop offset="1" stop-color="#9eb7a2"/></linearGradient></defs>
    <rect width="600" height="1000" rx="34" fill="#294b47"/><rect x="24" y="24" width="552" height="952" rx="24" fill="url(#paper)" stroke="#d8b465" stroke-width="8"/>
    <circle cx="300" cy="410" r="154" fill="none" stroke="#426d63" stroke-width="8"/><path d="M300 220L336 374L490 410L336 446L300 600L264 446L110 410L264 374Z" fill="#d6ad61" opacity=".72"/>
    <text x="300" y="104" text-anchor="middle" font-family="Georgia,serif" font-size="34" fill="#294b47">${numeral}</text>
    <text x="300" y="760" text-anchor="middle" font-family="Georgia,serif" font-size="30" font-weight="700" fill="#233c39">${title}</text>
    <text x="300" y="820" text-anchor="middle" font-family="Georgia,serif" font-size="19" fill="#4d645e">WOODLAND TAROT · CATALOG FALLBACK</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function createFallbackCatalog() {
  const cards = MAJOR_ARCANA.map(([numeral, name, slug], index) => ({
    id: `major-${String(index).padStart(2, "0")}-${slug}`,
    index,
    numeral,
    name,
    nameZh: "",
    suit: "Major Arcana",
    rank: numeral,
    file: index < 6 ? `card-${String(index).padStart(2, "0")}-${slug}.png` : null,
  }));
  MINOR_SUITS.forEach((suit) => {
    MINOR_RANKS.forEach((rank, rankIndex) => {
      cards.push({
        id: `${suit.toLowerCase()}-${String(rankIndex + 1).padStart(2, "0")}`,
        index: cards.length,
        numeral: `${suit} / ${rank}`,
        name: `${rank} OF ${suit}`,
        nameZh: "",
        suit,
        rank,
        file: null,
      });
    });
  });
  return cards;
}

function resolveCardSource(file, manifestUrl = null, basePath = null, deckKey = "woodland") {
  if (!file) return null;
  const value = String(file).replace(/\\/g, "/");
  if (/^(?:data:|blob:|https?:|file:)/i.test(value)) return value;
  if (basePath && manifestUrl) {
    const directory = String(basePath).endsWith("/") ? String(basePath) : `${basePath}/`;
    return new URL(value, new URL(directory, manifestUrl)).href;
  }
  if (manifestUrl && (value.startsWith(".") || value.includes("/"))) return new URL(value, manifestUrl).href;
  return new URL(`./assets/${deckKey}/textures/${value}`, window.location.href).href;
}

function versionCardSource(source) {
  if (!source || /^(?:data:|blob:)/i.test(source)) return source;
  const url = new URL(source, window.location.href);
  url.searchParams.set("v", CARD_ASSET_VERSION);
  return url.href;
}

function normalizeCardCatalog(payload, manifestUrl = null, deckKey = "woodland") {
  const sourceCards = Array.isArray(payload) ? payload : payload?.cards;
  if (!Array.isArray(sourceCards) || sourceCards.length < 78) return null;
  const fallbackCards = createFallbackCatalog();
  const basePath = Array.isArray(payload) ? null : payload.basePath ?? payload.base_path ?? null;
  return sourceCards
    .map((card, originalIndex) => ({ card, originalIndex }))
    .sort((a, b) => Number(a.card.index ?? a.card.order ?? a.originalIndex) - Number(b.card.index ?? b.card.order ?? b.originalIndex))
    .map(({ card }, index) => {
      const fallback = fallbackCards[index] ?? {
        id: `${deckKey}-${String(index).padStart(2, "0")}`,
        index,
        numeral: String(index),
        name: `CARD ${String(index).padStart(2, "0")}`,
        nameZh: "",
        suit: "",
        rank: "",
      };
      const file = card.file ?? card.filename ?? card.path ?? card.front_file ?? card.front ?? card.texturePath ?? card.texture ?? card.image?.front ?? card.image ?? null;
      const thumbnailFile = card.thumbnail ?? card.thumb ?? card.preview ?? card.image?.thumbnail ?? null;
      const normalized = {
        id: String(card.id ?? card.slug ?? `${deckKey}:${typeof file === "string" ? file : card.name ?? fallback.id}`),
        index: Number(card.index ?? card.order ?? index),
        numeral: String(card.numeral ?? card.roman ?? card.arcana ?? card.number ?? card.rank ?? fallback.numeral),
        name: String(card.name ?? card.title ?? card.name_en ?? card.label ?? fallback.name).toUpperCase(),
        nameZh: String(card.nameZh ?? card.name_zh ?? card.title_zh ?? card.label_zh ?? fallback.nameZh ?? ""),
        suit: String(card.suit ?? card.arcana_group ?? fallback.suit ?? ""),
        rank: String(card.rank ?? fallback.rank ?? ""),
        file: typeof file === "string" ? file : null,
        thumbnailFile: typeof thumbnailFile === "string" ? thumbnailFile : null,
      };
      normalized.src = versionCardSource(resolveCardSource(normalized.file, manifestUrl, basePath, deckKey)) ?? createFallbackCardSource(normalized);
      normalized.thumbnailSrc = versionCardSource(resolveCardSource(normalized.thumbnailFile, manifestUrl, basePath, deckKey)) ?? normalized.src;
      normalized.fallbackSrc = createFallbackCardSource(normalized);
      return normalized;
    });
}

async function loadCardCatalog(deckKey) {
  const deck = DECKS[deckKey];
  if (!deck?.hasCards) return [];
  const injected = deckKey === "woodland"
    ? normalizeCardCatalog(globalThis.WOODLAND_CARDS_MANIFEST, null, deckKey)
    : null;
  if (injected) return injected;
  if (window.location.protocol !== "file:") {
    const legacyCandidates = deckKey === "woodland" ? LEGACY_CARD_MANIFEST_CANDIDATES : [];
    const candidates = [deck.cardManifest, ...legacyCandidates].filter(Boolean);
    for (const candidate of [...new Set(candidates)]) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) continue;
        const catalog = normalizeCardCatalog(await response.json(), response.url, deckKey);
        if (catalog) {
          console.info(`[arcana] loaded ${catalog.length} cards from ${response.url}`);
          return catalog;
        }
      } catch (error) {
        console.warn(`[arcana] unable to load ${candidate}`, error);
      }
    }
  }
  throw new Error(`The card catalog for ${deckKey} is unavailable`);
}

const DEFAULT_DECKS = {
  unveiled: {
    number: "01",
    header: "THE UNVEILED TAROT",
    selectorCover: "front.jpg",
    selectorMeta: "COLLECTION 01 · 80 CARDS",
    selector3D: {
      width: 1,
      height: 1.54,
      depth: 0.54,
      edgeColor: "#c7b39f",
      faces: { front: "front.jpg", back: "back.jpg", left: "left.jpg", right: "right.jpg", top: "top.jpg" },
    },
    kicker: "DREAM, SYMBOL & REVELATION",
    title: "THE UNVEILED<br /><em>Tarot</em>",
    description: "硬紙盒外套、可滑出的內抽屜與完整八十張已校正牌面，包含 The Mob 與 The Puppeteer 兩張獨有大牌。",
    structure: "SLIPCASE + DRAWER",
    cards: "LXXX / LXXX",
    basis: "86 PHOTOS",
    hasCards: true,
    model: "slipcase",
    openLabel: "拉出內盒",
    closeLabel: "收回內盒",
    textureRoot: "./assets/unveiled/textures/",
    cardManifest: "./assets/unveiled/cards-manifest.json",
    workbench: "./unveiled-workbench/",
    textureVersion: "20260830-02",
    textureFiles: ["front.jpg", "back.jpg", "left.jpg", "right.jpg", "top.jpg", "drawer.jpg", "../card-back.webp"],
    cardBack: "../card-back.webp",
  },
  woodland: {
    number: "02",
    header: "WOODLAND FAIRY TALE TAROT",
    selectorCover: "outer-front.jpg",
    selectorMeta: "COLLECTION 02 · 78 CARDS",
    selector3D: {
      width: 1.18,
      height: 1.55,
      depth: 0.34,
      coverDepth: 0.055,
      edgeColor: "#335853",
      faces: { front: "outer-front.jpg", back: "outer-back.jpg", inside: "outer-inside.jpg", left: "outer-left.jpg", right: "outer-right.jpg", top: "outer-top.jpg", bottom: "outer-bottom.jpg" },
    },
    kicker: "MAGIC, FOLKLORE & PLANTS",
    title: "WOODLAND<br /><em>Fairy Tale</em> TAROT",
    description: "磁吸書型外盒、可取出的說明書、內卡盒與完整七十八張牌面，依照 411495–411497 的拆件狀態重建。",
    structure: "OUTER BOX + GUIDE + INNER BOX",
    cards: "LXXVIII / LXXVIII",
    basis: "29 PHOTOS",
    hasCards: true,
    model: "book",
    packageType: "inner-box",
    openLabel: "打開磁吸書型盒",
    closeLabel: "闔上磁吸書型盒",
    cardManifest: "./assets/cards-manifest.json",
    textureRoot: "./assets/woodland/textures/",
    textureVersion: "20260814-10",
    textureVariants: { "guidebook-front.png": "guidebook-front.webp", "guidebook-back.png": "guidebook-back.webp", "card-back.png": "card-back.webp" },
    textureFiles: [
      "outer-front.jpg", "outer-back.jpg", "outer-inside.jpg", "outer-left.jpg", "outer-right.jpg", "outer-top.jpg", "outer-bottom.jpg",
      "inner-front.jpg", "inner-back.jpg", "inner-front-upright.jpg", "inner-back-upright.jpg", "inner-left.jpg", "inner-right.jpg", "inner-top.jpg", "inner-bottom.jpg",
      "guidebook-front.png", "guidebook-back.png", "card-back.png",
    ],
    cardBack: "card-back.png",
  },
  redvisions: {
    number: "03",
    header: "RED VISIONS TAROT",
    selectorCover: "outer-front.jpg",
    selectorMeta: "COLLECTION 03 · 78 CARDS",
    selector3D: {
      width: 1.18,
      height: 1.55,
      depth: 0.34,
      coverDepth: 0.055,
      edgeColor: "#5b1719",
      faces: { front: "outer-front.jpg", back: "outer-back.jpg", inside: "outer-inside.jpg", left: "outer-left.jpg", right: "outer-right.jpg", top: "outer-top.jpg", bottom: "outer-bottom.jpg" },
    },
    kicker: "LIBER SOMNIA · DREAM VISIONS",
    title: "RED VISIONS<br /><em>Tarot</em>",
    description: "深紅磁吸書型牌盒、說明書、內卡盒與完整七十八張已校正牌面，依實拍素材重建。",
    structure: "OUTER BOX + GUIDE + INNER BOX",
    cards: "LXXVIII / LXXVIII",
    basis: "90 PHOTOS",
    hasCards: true,
    model: "book",
    packageType: "inner-box",
    openLabel: "打開磁吸書型盒",
    closeLabel: "闔上磁吸書型盒",
    cardManifest: "./assets/redvisions/cards-manifest.json",
    workbench: "./redvisions-workbench/",
    textureRoot: "./assets/redvisions/textures/",
    textureVersion: "20260825-01",
    textureVariants: { "guidebook-front.png": "guidebook-front.webp", "guidebook-back.png": "guidebook-back.webp", "card-back.png": "card-back.webp" },
    textureFiles: [
      "outer-front.jpg", "outer-back.jpg", "outer-inside.jpg", "outer-left.jpg", "outer-right.jpg", "outer-top.jpg", "outer-bottom.jpg",
      "inner-front.jpg", "inner-back.jpg", "inner-front-upright.jpg", "inner-back-upright.jpg", "inner-left.jpg", "inner-right.jpg", "inner-top.jpg", "inner-bottom.jpg",
      "guidebook-front.png", "guidebook-back.png", "card-back.png",
    ],
    cardBack: "card-back.png",
  },
  prosepoem: {
    number: "04",
    header: "PROSE POEM TAROT",
    selectorCover: "outer-front.jpg",
    selectorMeta: "COLLECTION 04 · 80 / 83",
    selector3D: {
      width: 1.18,
      height: 1.55,
      depth: 0.34,
      coverDepth: 0.055,
      edgeColor: "#b77716",
      faces: { front: "outer-front.jpg", back: "outer-back.jpg", inside: "outer-inside.jpg", left: "outer-left.jpg", right: "outer-right.jpg", top: "outer-top.jpg", bottom: "outer-bottom.jpg" },
    },
    kicker: "LIGHT, FLIGHT & POETIC IMAGE",
    title: "PROSE POEM<br /><em>Tarot</em>",
    description: "暖金磁吸書型盒、可取出的說明書與直置牌托；牌盒標示 83 張，現有素材提供 80 張校正版牌面，並保留教皇與寶劍十各一張替代圖稿。",
    structure: "HINGED BOOK BOX + GUIDE + CARD STACK",
    cards: "LXXX / LXXXIII",
    availableCardCount: 80,
    printedCardCount: 83,
    basis: "98 PHOTOS",
    hasCards: true,
    model: "book",
    packageType: "card-stack",
    packageAspectRatio: 4 / 7,
    packageFaceTexture: "../card-back.webp",
    edgeColor: "#b77716",
    paperColor: "#d39a2c",
    openLabel: "打開暖金書型盒",
    closeLabel: "闔上暖金書型盒",
    cardManifest: "./assets/prosepoem/cards-manifest.json",
    workbench: "./prosepoem-workbench/",
    textureRoot: "./assets/prosepoem/textures/",
    textureVersion: "20260831-01",
    textureVariants: { "guidebook-front.png": "guidebook-front.webp", "guidebook-back.png": "guidebook-back.webp" },
    textureFiles: [
      "outer-front.jpg", "outer-back.jpg", "outer-inside.jpg", "outer-left.jpg", "outer-right.jpg", "outer-top.jpg", "outer-bottom.jpg",
      "inner-front.jpg", "inner-back.jpg", "inner-front-upright.jpg", "inner-back-upright.jpg", "inner-left.jpg", "inner-right.jpg", "inner-top.jpg", "inner-bottom.jpg",
      "guidebook-front.png", "guidebook-back.png", "../card-back.webp",
    ],
    cardBack: "../card-back.webp",
  },
};

function resolveManifestUrl(value, manifestUrl = null) {
  if (!value) return null;
  return new URL(value, manifestUrl ?? window.location.href).href;
}

function normalizeDeckIndex(payload, manifestUrl = null) {
  const source = payload?.decks ?? payload;
  const entries = Array.isArray(source)
    ? source.map((deck) => [deck.id, deck])
    : Object.entries(source ?? {});
  const normalized = {};
  entries.forEach(([id, deck]) => {
    if (!id || !deck || typeof deck !== "object") return;
    const fallback = DEFAULT_DECKS[id] ?? {};
    const fallbackSelector = fallback.selector3D ?? {};
    const suppliedSelector = deck.selector3D && typeof deck.selector3D === "object" ? deck.selector3D : {};
    const merged = {
      ...fallback,
      ...deck,
      id,
      selector3D: {
        ...fallbackSelector,
        ...suppliedSelector,
        faces: {
          ...(fallbackSelector.faces ?? {}),
          ...(suppliedSelector.faces ?? {}),
        },
      },
    };
    merged.cardManifest = resolveManifestUrl(merged.cardManifest, manifestUrl);
    merged.workbench = resolveManifestUrl(merged.workbench, manifestUrl);
    merged.textureRoot = resolveManifestUrl(merged.textureRoot, manifestUrl);
    merged.textureFiles = Array.isArray(merged.textureFiles) ? merged.textureFiles : fallback.textureFiles ?? [];
    normalized[id] = merged;
  });
  Object.entries(DEFAULT_DECKS).forEach(([id, deck]) => {
    if (normalized[id]) return;
    normalized[id] = {
      ...deck,
      id,
      cardManifest: resolveManifestUrl(deck.cardManifest),
      workbench: resolveManifestUrl(deck.workbench),
      textureRoot: resolveManifestUrl(deck.textureRoot),
    };
  });
  return normalized;
}

async function loadDeckIndex() {
  const injected = globalThis.ARCANA_DECKS_MANIFEST;
  if (injected) return normalizeDeckIndex(injected);
  if (window.location.protocol !== "file:") {
    try {
      const response = await fetch(DECK_INDEX_URL, { cache: "no-store" });
      if (response.ok) {
        const decks = normalizeDeckIndex(await response.json(), response.url);
        console.info(`[arcana] loaded ${Object.keys(decks).length} deck manifests from ${response.url}`);
        return decks;
      }
    } catch (error) {
      console.warn(`[arcana] unable to load ${DECK_INDEX_URL}`, error);
    }
  }
  console.info("[arcana] using the embedded deck index fallback");
  return normalizeDeckIndex(DEFAULT_DECKS);
}

const DECKS = await loadDeckIndex();
let CARDS = [];

const archive = document.querySelector("#archive");
const cabinet = document.querySelector("#cabinet-scene");
const sceneImage = cabinet.querySelector(".scene-image");
const sceneResetButton = document.querySelector("#scene-reset-view");
const inspection = document.querySelector("#inspection");
const stage = document.querySelector("#three-stage");
const loading = document.querySelector("#model-loading");
const flash = document.querySelector("#mystic-flash");
const boxControls = document.querySelector("#box-controls");
const cardControls = document.querySelector("#card-controls");
const cardsModeTab = document.querySelector("#cards-mode-tab");
const browseModeTab = document.querySelector("#browse-mode-tab");
const browsePanel = document.querySelector("#browse-panel");
const browseCardGrid = document.querySelector("#browse-card-grid");
const browseDeckTitle = document.querySelector("#browse-deck-title");
const browseLoadedCount = document.querySelector("#browse-loaded-count");
const browseTotalCount = document.querySelector("#browse-total-count");
const browseDedicatedWorkbench = document.querySelector("#browse-dedicated-workbench");
const browseViewer = document.querySelector("#browse-viewer");
const browseViewerImage = document.querySelector("#browse-viewer-image");
const browseViewerIndex = document.querySelector("#browse-viewer-index");
const browseViewerTitle = document.querySelector("#browse-viewer-title");
const browseViewerSubtitle = document.querySelector("#browse-viewer-subtitle");
const openButton = document.querySelector("#open-box");
const viewMenuToggle = document.querySelector("#view-menu-toggle");
const viewMenuPanel = document.querySelector("#view-menu-panel");
const currentViewLabel = document.querySelector("#current-view-label");
const cardRail = document.querySelector("#card-rail");
const cardCatalogToggle = document.querySelector("#card-catalog-toggle");
const cardCatalogCount = document.querySelector("#card-catalog-count");
const cardCatalogPanel = document.querySelector("#card-catalog-panel");
const cardIndex = document.querySelector("#card-index");
const cardName = document.querySelector("#card-name");
const flipCardButton = document.querySelector("#flip-card");
const redrawCardButton = document.querySelector("#redraw-card");
const returnDeckButton = document.querySelector("#return-deck");
const soundToggle = document.querySelector("#sound-toggle");
const boxSequenceHint = document.querySelector(".box-sequence-hint");
const approachButton = document.querySelector("#approach-button");
const retreatButton = document.querySelector("#retreat-button");
const closeInspectionButton = document.querySelector("#close-inspection");
const deckCarousel = document.querySelector("#deck-carousel");
const deckCarouselTrack = document.querySelector("#deck-carousel-track");
const deckCarouselPrevious = document.querySelector("#deck-carousel-previous");
const deckCarouselNext = document.querySelector("#deck-carousel-next");
const deckCarouselCounter = document.querySelector("#deck-carousel-counter");
const deckCarouselTitle = document.querySelector("#deck-carousel-title");
const deckCarouselProgress = document.querySelector("#deck-carousel-progress");
const deckCarouselStatus = document.querySelector("#deck-carousel-status");
const deckWorkbenchNav = document.querySelector("#deck-workbench-nav");
const deckWorkbenchLink = document.querySelector("#deck-workbench-link");
const deckWorkbenchNumber = document.querySelector("#deck-workbench-number");
const deckWorkbenchTitle = document.querySelector("#deck-workbench-title");
const deckEntries = Object.entries(DECKS);
const deckCarouselReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let deckCarouselCurrentIndex = 0;
let deckCarouselAnnouncementTimer = null;
let deckCarouselMotionActive = false;
let deckCarouselScrollTargetIndex = null;
let deckCarouselScrollTargetStartedAt = 0;
let deckCarousel3DReady = false;
let deckCarousel3DRenderer = null;
let deckCarousel3DCanvas = null;
let deckCarousel3DEntries = [];
let deckCarousel3DGlowTexture = null;
let deckCarousel3DSparkTexture = null;
const deckCarousel3DFailedIndices = new Set();
let deckCarousel3DActiveIndex = -1;
let deckCarousel3DWidth = 0;
let deckCarousel3DHeight = 0;
let inspectionVisible = false;
let artifactStageReady = false;
let inspectionReturnFocus = null;
let feedbackResetTimer = null;

function getDeckCarouselSlides() {
  return [...deckCarouselTrack.querySelectorAll(".tabletop-deck[data-deck]")];
}

function getDeckSelectorCover(deckKey, deck) {
  const selectorCover = deck.selectorCover ?? (deck.model === "slipcase" ? "front.jpg" : "outer-front.jpg");
  return getDeckTextureUrl(deckKey, selectorCover);
}

function buildDeckCarousel() {
  const fragment = document.createDocumentFragment();
  deckEntries.forEach(([deckKey, deck], index) => {
    const button = document.createElement("button");
    const safeDeckKey = deckKey.replace(/[^a-z0-9_-]/gi, "-");
    button.id = `deck-carousel-slide-${index + 1}-${safeDeckKey}`;
    button.className = `tabletop-deck deck-${safeDeckKey}`;
    button.type = "button";
    button.dataset.deck = deckKey;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("aria-label", `第 ${index + 1} 副，共 ${deckEntries.length} 副：召喚 ${deck.header}`);
    button.style.setProperty("--deck-cover", `url(${JSON.stringify(getDeckSelectorCover(deckKey, deck))})`);

    const aura = document.createElement("i");
    aura.className = "deck-aura";
    aura.setAttribute("aria-hidden", "true");
    const object = document.createElement("span");
    object.className = "deck-object";
    object.setAttribute("aria-hidden", "true");
    const name = document.createElement("span");
    name.className = "deck-name";
    const meta = document.createElement("small");
    meta.textContent = deck.selectorMeta ?? `COLLECTION ${deck.number} · ${deck.cards}`;
    const title = document.createElement("b");
    title.textContent = deck.header;
    const action = document.createElement("em");
    action.textContent = "點擊召喚";
    name.append(meta, title, action);
    button.append(aura, object, name);
    fragment.append(button);
  });
  deckCarouselTrack.replaceChildren(fragment);

  const deckCount = String(deckEntries.length).padStart(2, "0");
  document.querySelector("#archive-deck-count").textContent = `${deckCount} DECKS · LOCAL ARCHIVE`;
  document.querySelector("#archive-deck-summary").textContent = `${deckEntries.length} 副牌 · 本機素材重建`;
}

function updateDeckWorkbench(deckKey) {
  const deck = DECKS[deckKey];
  if (!deck) return;
  deckWorkbenchNumber.textContent = deck.number;
  deckWorkbenchTitle.textContent = deck.header;
  deckWorkbenchLink.dataset.browseDeck = deckKey;
  if (deck.hasCards) {
    deckWorkbenchLink.href = `./?deck=${encodeURIComponent(deckKey)}&mode=browse`;
    deckWorkbenchLink.setAttribute("aria-disabled", String(!artifactStageReady));
    deckWorkbenchLink.tabIndex = artifactStageReady ? 0 : -1;
    deckWorkbenchLink.setAttribute("aria-label", `一般瀏覽 ${deck.header}`);
  } else {
    deckWorkbenchLink.removeAttribute("href");
    deckWorkbenchLink.setAttribute("aria-disabled", "true");
    deckWorkbenchLink.tabIndex = -1;
    deckWorkbenchLink.setAttribute("aria-label", `${deck.header} 尚無可瀏覽牌面`);
  }
}

function getDeckCarouselBehavior() {
  return deckCarouselReducedMotion.matches ? "auto" : "smooth";
}

function resetCabinetScroll() {
  cabinet.scrollTo({ left: 0, top: 0, behavior: "auto" });
}

function focusWhenVisible(target, timeout = 5000) {
  const startedAt = performance.now();
  const attemptFocus = () => {
    const element = typeof target === "function" ? target() : target;
    if (!element?.isConnected) return;
    const style = getComputedStyle(element);
    const focusable = style.visibility !== "hidden"
      && style.display !== "none"
      && !element.disabled
      && !element.closest("[inert]");
    if (focusable) {
      element.focus({ preventScroll: true });
      if (document.activeElement === element) {
        resetCabinetScroll();
        return;
      }
    }
    if (performance.now() - startedAt < timeout) requestAnimationFrame(attemptFocus);
  };
  requestAnimationFrame(attemptFocus);
}

function getDeckCarouselTargetLeft(slide) {
  const rawLeft = slide.offsetLeft - (deckCarouselTrack.clientWidth - slide.offsetWidth) / 2;
  const maximumLeft = Math.max(0, deckCarouselTrack.scrollWidth - deckCarouselTrack.clientWidth);
  return Math.max(0, Math.min(rawLeft, maximumLeft));
}

function isDeckCarouselSlideCentered(index, tolerance = 2) {
  const slide = getDeckCarouselSlides()[index];
  if (!slide) return false;
  const trackRect = deckCarouselTrack.getBoundingClientRect();
  const slideRect = slide.getBoundingClientRect();
  return Math.abs((slideRect.left + slideRect.width / 2) - (trackRect.left + trackRect.width / 2)) <= tolerance;
}

function centerDeckCarouselSlide(slide) {
  const index = getDeckCarouselSlides().indexOf(slide);
  if (index < 0) return;
  deckCarouselScrollTargetIndex = index;
  deckCarouselScrollTargetStartedAt = performance.now();
  setDeckCarouselMotionActive(true);
  deckCarouselTrack.scrollTo({ left: getDeckCarouselTargetLeft(slide), behavior: getDeckCarouselBehavior() });
  resetCabinetScroll();
  queueDeckCarouselSync();
}

function setDeckCarouselCurrent(index, { scroll = false, focus = false, announce = false } = {}) {
  const slides = getDeckCarouselSlides();
  if (!slides.length) return;
  const nextIndex = Math.max(0, Math.min(index, slides.length - 1));
  if (nextIndex !== deckCarouselCurrentIndex) cancelPendingInspection();
  deckCarouselCurrentIndex = nextIndex;
  slides.forEach((slide, slideIndex) => {
    const current = slideIndex === nextIndex;
    slide.classList.toggle("is-carousel-current", current);
    slide.tabIndex = current ? 0 : -1;
    if (current) slide.setAttribute("aria-current", "true");
    else slide.removeAttribute("aria-current");
  });

  const currentSlide = slides[nextIndex];
  const deck = DECKS[currentSlide.dataset.deck];
  deckCarouselCounter.textContent = `${String(nextIndex + 1).padStart(2, "0")} / ${String(slides.length).padStart(2, "0")}`;
  deckCarouselTitle.textContent = deck.header;
  deckCarouselProgress.style.width = `${((nextIndex + 1) / slides.length) * 100}%`;
  deckCarouselPrevious.disabled = nextIndex === 0;
  deckCarouselNext.disabled = nextIndex === slides.length - 1;
  updateDeckWorkbench(currentSlide.dataset.deck);

  if (focus) currentSlide.focus({ preventScroll: true });
  if (scroll) centerDeckCarouselSlide(currentSlide);
  if (announce) deckCarouselStatus.textContent = `第 ${nextIndex + 1} 副，共 ${slides.length} 副：${deck.header}`;
}

function findCenteredDeckIndex() {
  const slides = getDeckCarouselSlides();
  if (!slides.length) return 0;
  const trackRect = deckCarouselTrack.getBoundingClientRect();
  const trackCenter = trackRect.left + trackRect.width / 2;
  return slides.reduce((closestIndex, slide, index) => {
    const rect = slide.getBoundingClientRect();
    const distance = Math.abs(rect.left + rect.width / 2 - trackCenter);
    const closestRect = slides[closestIndex].getBoundingClientRect();
    const closestDistance = Math.abs(closestRect.left + closestRect.width / 2 - trackCenter);
    return distance < closestDistance ? index : closestIndex;
  }, 0);
}

function syncDeckCarousel({ announce = false, reconcileFocus = false, settle = false } = {}) {
  if (settle && deckCarouselScrollTargetIndex !== null
    && !isDeckCarouselSlideCentered(deckCarouselScrollTargetIndex)) {
    if (performance.now() - deckCarouselScrollTargetStartedAt >= 2600) {
      const targetIndex = deckCarouselScrollTargetIndex;
      const targetSlide = getDeckCarouselSlides()[targetIndex];
      if (targetSlide) deckCarouselTrack.scrollTo({ left: getDeckCarouselTargetLeft(targetSlide), behavior: "auto" });
      requestAnimationFrame(() => {
        if (deckCarouselScrollTargetIndex === targetIndex) {
          syncDeckCarousel({ announce, reconcileFocus, settle: true });
        }
      });
    } else {
      queueDeckCarouselSync();
    }
    return;
  }

  const nextIndex = deckCarouselScrollTargetIndex ?? findCenteredDeckIndex();
  setDeckCarouselCurrent(nextIndex, { announce });
  if (settle) {
    deckCarouselScrollTargetIndex = null;
    deckCarouselScrollTargetStartedAt = 0;
    setDeckCarouselMotionActive(false);
  }
  if (!reconcileFocus || !deckCarouselTrack.contains(document.activeElement)) return;
  const currentSlide = getDeckCarouselSlides()[nextIndex];
  if (document.activeElement !== currentSlide) currentSlide.focus({ preventScroll: true });
}

function setDeckCarouselMotionActive(active) {
  deckCarouselMotionActive = active;
  deckCarousel.classList.toggle("is-carousel-scrolling", active);
  deckCarousel.classList.toggle("is-carousel-settled", !active);
  refreshDeckCarousel3DPreview();
}

function queueDeckCarouselSync() {
  window.clearTimeout(deckCarouselAnnouncementTimer);
  deckCarouselAnnouncementTimer = window.setTimeout(() => {
    syncDeckCarousel({ announce: true, reconcileFocus: true, settle: true });
  }, 160);
}

function moveDeckCarousel(step, { focus = false } = {}) {
  setDeckCarouselCurrent(deckCarouselCurrentIndex + step, { scroll: true, focus, announce: true });
}

function setDeckPickerInteractive(interactive) {
  deckCarousel.inert = !interactive;
  deckWorkbenchNav.inert = !interactive;
}

buildDeckCarousel();
setDeckCarouselCurrent(0);
setDeckCarouselMotionActive(false);
setDeckPickerInteractive(false);

let activeDeckKey = "woodland";
function isBookDeck(deckKey = activeDeckKey) {
  return DECKS[deckKey]?.model === "book";
}

function isDirectCardStackDeck(deckKey = activeDeckKey) {
  return isBookDeck(deckKey) && DECKS[deckKey]?.packageType === "card-stack";
}

function packageLabel(deckKey = activeDeckKey) {
  return isDirectCardStackDeck(deckKey) ? "牌堆" : "內卡盒";
}
let activeMode = "box";
let selectedCard = 0;
let selectedFlipped = false;
let drawRitual = null;
let readingResult = null;
let pendingInspection = null;
let inspectionEntryGeneration = 0;
let revealingResult = null;
let drawRestoreState = null;
const ritualMotion = { energy: 0, clock: 0, focus: 0, hover: -1 };
let ritualPointer = null;
const ritualPose = {};
const ritualPoseOptions = {};
const readingLabelPoint = new THREE.Vector3();
const readingProjectionPoint = new THREE.Vector3();
let readingLayoutDirty = true;
let readingScreenLayout = null;
let readingScrollOffset = 0;
let readingLayoutSession = null;
let readingPan = null;
const readingScroll = document.querySelector("#reading-scroll");
const readingFlips = new Map();
let exportingReading = false;
let readingExportUrl = null;
const readingFlipPose = {};
let ringSelection = null;
let ringRotation = 0;
let ringFocusedPosition = -1;
let ringViewport = null;
const ringConfirm = document.querySelector("#draw-ring-confirm");
let cameraTween = null;
let invokeAge = 99;
let shakeTrauma = 0;
let lastFrameTime = performance.now();
let woodlandOpenTarget = 0;
let woodlandOpenCurrent = 0;
let guidebookExtractedTarget = 0;
let guidebookExtractedCurrent = 0;
let guidebookFlippedTarget = 0;
let guidebookFlippedCurrent = 0;
let pendingGuidebookExtraction = false;
let innerBoxExtractedTarget = 0;
let innerBoxExtractedCurrent = 0;
const WOODLAND_PHASE = Object.freeze({
  CLOSED: "closed",
  COVER_OPEN: "cover-open",
  GUIDE_EXTRACTED: "guide-extracted",
  INNER_FLOATING: "inner-floating",
  INNER_READY: "inner-ready",
  SUMMONING: "summoning",
  CARDS: "cards",
  RETURNING: "returning",
});
let woodlandPhase = WOODLAND_PHASE.CLOSED;
let cardRevealComplete = false;
let innerBoxGlowTarget = 0;
let innerBoxGlowCurrent = 0;
let cardSummonStartedAt = 0;
let cardSummonProgress = 0;
let cardRailAssetsReady = false;
let cardWebGLAssetsReady = false;
let cardCatalogDeckKey = null;
const cardCatalogLoads = new Map();
let cardRailObserver = null;
let browseRenderedDeckKey = null;
let activeBrowseFilter = "all";
let pendingSummonCardIndex = null;
let cardSummonAssetsReady = false;
const CARD_SUMMON_RAY_EXPAND_MS = 2200;
const CARD_SUMMON_MIN_DURATION_MS = 4200;
const CARD_REDRAW_DURATION_MS = 3000;
const CARD_RETURN_BEAM_DURATION_MS = 1500;
const CARD_TEXTURE_POOL_LIMIT = 5;
const SCENE_TAP_MAX_DURATION_MS = 520;
const SCENE_TAP_MAX_MOVE_PX = 9;
let cardRedrawStartedAt = 0;
let cardRedrawProgress = 0;
let deckReturnStartedAt = 0;
let deckReturnStageStartedAt = 0;
let deckReturnStage = null;
let deckReturnProgress = 0;
let returnCardOrigins = [];
let returnBeams = null;
let returnBeamMaterial = null;
let activeView = "front";
let artifactBrightnessTarget = 1;
let artifactBrightnessCurrent = 1;
let unveiledOpenTarget = 0;
let unveiledOpenCurrent = 0;
let artifactTargetScale = 1;
const artifactTargetPosition = new THREE.Vector3();
let soundEnabled = true;
let audioContext = null;
const candleWash = document.querySelector(".candle-wash");

buildDomParticles(document.querySelector("#dust"), 52, false);
buildDomParticles(document.querySelector("#inspection-particles"), 82, true);
cardCatalogToggle.disabled = true;

approachButton.addEventListener("click", () => {
  resetCabinetScroll();
  archive.dataset.phase = "choose";
  setDeckPickerInteractive(true);
  setDeckCarouselMotionActive(false);
  scheduleSceneViewUpdate();
  focusWhenVisible(() => {
    if (archive.dataset.phase !== "choose" || inspectionVisible) return null;
    const currentSlide = getDeckCarouselSlides()[deckCarouselCurrentIndex];
    return currentSlide?.disabled ? deckCarouselTrack : currentSlide;
  });
});

retreatButton.addEventListener("click", () => {
  cancelPendingInspection();
  archive.dataset.phase = "entrance";
  setDeckPickerInteractive(false);
  refreshDeckCarousel3DPreview();
  scheduleSceneViewUpdate();
  focusWhenVisible(approachButton);
});

deckCarouselTrack.addEventListener("click", (event) => {
  const button = event.target.closest(".tabletop-deck[data-deck]");
  if (!button || button.disabled) return;
  const index = getDeckCarouselSlides().indexOf(button);
  if (index !== deckCarouselCurrentIndex || deckCarouselMotionActive) {
    setDeckCarouselCurrent(index, { scroll: true, focus: true, announce: true });
    return;
  }
  enterInspection(button.dataset.deck);
});

deckCarouselTrack.addEventListener("focusin", (event) => {
  const button = event.target.closest(".tabletop-deck[data-deck]");
  if (!button) return;
  const index = getDeckCarouselSlides().indexOf(button);
  if (index >= 0) setDeckCarouselCurrent(index, { scroll: button.getAttribute("aria-current") !== "true" });
});

deckCarouselTrack.addEventListener("keydown", (event) => {
  if (archive.dataset.phase !== "choose" || inspectionVisible) return;
  const focusedSlide = event.target.closest(".tabletop-deck[data-deck]");
  if ((event.key === "Enter" || event.key === " ") && focusedSlide && !focusedSlide.disabled) {
    event.preventDefault();
    event.stopPropagation();
    const slides = getDeckCarouselSlides();
    const focusedIndex = slides.indexOf(focusedSlide);
    if (focusedIndex !== deckCarouselCurrentIndex || deckCarouselMotionActive) {
      setDeckCarouselCurrent(focusedIndex, { scroll: true, focus: true, announce: true });
      return;
    }
    const currentSlide = slides[deckCarouselCurrentIndex] ?? focusedSlide;
    enterInspection(currentSlide.dataset.deck);
    return;
  }
  let nextIndex = null;
  if (event.key === "ArrowLeft") nextIndex = deckCarouselCurrentIndex - 1;
  if (event.key === "ArrowRight") nextIndex = deckCarouselCurrentIndex + 1;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = getDeckCarouselSlides().length - 1;
  if (nextIndex === null) return;
  event.preventDefault();
  event.stopPropagation();
  setDeckCarouselCurrent(nextIndex, { scroll: true, focus: true, announce: true });
});

deckCarouselTrack.addEventListener("scroll", () => {
  setDeckCarouselMotionActive(true);
  queueDeckCarouselSync();
}, { passive: true });
deckCarouselTrack.addEventListener("scrollend", () => {
  window.clearTimeout(deckCarouselAnnouncementTimer);
  syncDeckCarousel({ announce: true, reconcileFocus: true, settle: true });
});
deckCarouselTrack.addEventListener("pointerdown", () => {
  cancelPendingInspection();
  deckCarouselScrollTargetIndex = null;
  deckCarouselScrollTargetStartedAt = 0;
}, { passive: true });
deckCarouselTrack.addEventListener("wheel", (event) => {
  cancelPendingInspection();
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  event.stopPropagation();
  deckCarouselScrollTargetIndex = null;
  deckCarouselScrollTargetStartedAt = 0;
  deckCarouselTrack.scrollBy({ left: event.deltaY, behavior: "auto" });
}, { passive: false });

deckCarouselPrevious.addEventListener("click", () => {
  moveDeckCarousel(-1);
  if (deckCarouselPrevious.disabled) getDeckCarouselSlides()[deckCarouselCurrentIndex]?.focus({ preventScroll: true });
});
deckCarouselNext.addEventListener("click", () => {
  moveDeckCarousel(1);
  if (deckCarouselNext.disabled) getDeckCarouselSlides()[deckCarouselCurrentIndex]?.focus({ preventScroll: true });
});

deckWorkbenchLink.addEventListener("click", (event) => {
  event.preventDefault();
  if (deckWorkbenchLink.getAttribute("aria-disabled") === "true") return;
  enterInspection(deckWorkbenchLink.dataset.browseDeck, "browse");
});

closeInspectionButton.addEventListener("click", leaveInspection);

document.querySelectorAll(".mode-tab").forEach((button) => {
  button.addEventListener("click", () => setMode(button.dataset.mode, true));
});

document.querySelectorAll(".view-button").forEach((button) => {
  button.addEventListener("click", () => {
    activateView(button.dataset.view);
    setViewMenuOpen(false);
  });
});

viewMenuToggle.addEventListener("click", () => {
  setViewMenuOpen(viewMenuToggle.getAttribute("aria-expanded") !== "true");
});

openButton.addEventListener("click", () => {
  if (woodlandPhase === WOODLAND_PHASE.SUMMONING || isCardTransitionActive()) return;
  const open = getActiveOpenTarget() < 0.5;
  setBoxOpen(open ? 1 : 0, { sound: true });
  triggerMysticEffect(0.28);
});

soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggle.innerHTML = `<i>${soundEnabled ? "◉" : "○"}</i> SOUND ${soundEnabled ? "ON" : "OFF"}`;
  if (soundEnabled) playCardSlide(0);
});

document.querySelector("#previous-card").addEventListener("click", () => {
  if (!isCardTransitionActive()) selectCard(selectedCard - 1);
});
document.querySelector("#next-card").addEventListener("click", () => {
  if (!isCardTransitionActive()) selectCard(selectedCard + 1);
});
flipCardButton.addEventListener("click", () => {
  if (!isCardTransitionActive()) flipSelectedCard();
});
redrawCardButton.addEventListener("click", beginCardRedraw);
returnDeckButton.addEventListener("click", beginDeckReturn);
cardCatalogToggle.addEventListener("click", () => {
  if (isCardTransitionActive()) return;
  setCardCatalogOpen(cardCatalogToggle.getAttribute("aria-expanded") !== "true");
});
document.querySelector("#reveal-reading").addEventListener("click", revealReading);
document.querySelector("#export-reading").addEventListener("click", exportReadingImage);
const readingImageShare = createReadingImageShare({
  button: document.querySelector("#reading-export-share"),
  status: document.querySelector("#reading-export-status"),
});
document.querySelector("#reading-export-close").addEventListener("click", () => document.querySelector("#reading-export-dialog").close());
document.querySelector("#reading-export-dialog").addEventListener("keydown", (event) => event.stopPropagation());
document.querySelector("#reading-export-dialog").addEventListener("close", () => {
  readingImageShare.clear();
  const oldUrl = readingExportUrl;
  readingExportUrl = null;
  document.querySelector("#reading-export-image").removeAttribute("src");
  // Allow an already-started download to finish before releasing its local URL.
  if (oldUrl) window.setTimeout(() => URL.revokeObjectURL(oldUrl), 60000);
});
document.querySelector("#spread-result-labels").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-reading-index]");
  if (button) activateReadingCard(Number(button.dataset.readingIndex));
});

document.querySelectorAll("[data-browse-filter]").forEach((button) => {
  button.addEventListener("click", () => setBrowseFilter(button.dataset.browseFilter));
});

document.querySelector("#browse-viewer-close").addEventListener("click", () => browseViewer.close());
browseViewer.addEventListener("click", (event) => {
  if (event.target === browseViewer) browseViewer.close();
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && pendingInspection) {
    event.preventDefault();
    cancelPendingInspection();
    return;
  }
  if (!inspectionVisible) return;
  if (event.defaultPrevented) return;
  if (drawRitual?.isOpen) {
    if (event.key === "Escape") { event.preventDefault(); drawRitual.cancel(); }
    return;
  }
  if (event.key === "Escape" && !browseViewer.open) {
    if (readingResult?.detail != null) { event.preventDefault(); showReadingOverview(); }
    else leaveInspection();
    return;
  }
  if (event.target === readingScroll) return;
  if (event.target.closest?.("#reading-question")) return;
  if (event.target.closest?.('input, textarea, select, button, a, [contenteditable="true"]')) return;
  if (activeMode === "cards" && !isCardTransitionActive()) {
    if (!readingResult && event.key === "ArrowLeft") selectCard(selectedCard - 1);
    if (!readingResult && event.key === "ArrowRight") selectCard(selectedCard + 1);
    if (event.key === " " || event.key === "Enter") { event.preventDefault(); flipSelectedCard(); }
  }
});

const SCENE_YAW_LIMIT = 7;
const SCENE_PITCH_LIMIT = 4.5;
const SCENE_ZOOM_LIMIT = 0.24;
const sceneView = {
  yaw: 0,
  pitch: 0,
  zoom: 0,
  baseScale: 1.1,
  targetYaw: 0,
  targetPitch: 0,
  targetZoom: 0,
};
const scenePointers = new Map();
let sceneDragAnchor = null;
let scenePinchAnchor = null;
let sceneViewFrame = 0;

function clampSceneValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isSceneControlTarget(target) {
  return target instanceof Element && Boolean(target.closest("button, a, .deck-carousel, .deck-workbench-nav"));
}

function resetSceneDragAnchor(pointerId) {
  const point = scenePointers.get(pointerId);
  if (!point) return;
  sceneDragAnchor = {
    pointerId,
    x: point.x,
    y: point.y,
    yaw: sceneView.targetYaw,
    pitch: sceneView.targetPitch,
  };
}

function scheduleSceneViewUpdate() {
  if (sceneViewFrame) return;
  sceneViewFrame = requestAnimationFrame(updateSceneView);
}

function updateSceneView() {
  sceneViewFrame = 0;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const smoothing = reducedMotion ? 1 : 0.16;
  const phaseScale = archive.dataset.phase === "choose" ? 1.46 : 1.1;
  sceneView.yaw += (sceneView.targetYaw - sceneView.yaw) * smoothing;
  sceneView.pitch += (sceneView.targetPitch - sceneView.pitch) * smoothing;
  sceneView.zoom += (sceneView.targetZoom - sceneView.zoom) * smoothing;
  sceneView.baseScale += (phaseScale - sceneView.baseScale) * (reducedMotion ? 1 : 0.08);

  const chooseOffset = archive.dataset.phase === "choose" ? window.innerHeight * 0.035 : 0;
  const panX = sceneView.yaw * -1.65;
  const panY = chooseOffset + sceneView.pitch * 1.35;
  const scale = sceneView.baseScale + sceneView.zoom;
  sceneImage.style.transform = `perspective(1200px) translate3d(${panX.toFixed(2)}px, ${panY.toFixed(2)}px, 0) rotateX(${sceneView.pitch.toFixed(3)}deg) rotateY(${sceneView.yaw.toFixed(3)}deg) scale(${scale.toFixed(4)})`;
  cabinet.style.setProperty("--scene-x", `${(-sceneView.yaw * 2.4).toFixed(2)}px`);
  cabinet.style.setProperty("--scene-y", `${(sceneView.pitch * 2).toFixed(2)}px`);
  cabinet.style.setProperty("--depth-x", `${(sceneView.yaw * 1.2).toFixed(2)}px`);
  cabinet.style.setProperty("--depth-y", `${(-sceneView.pitch).toFixed(2)}px`);

  const unsettled = Math.abs(sceneView.targetYaw - sceneView.yaw) > 0.003
    || Math.abs(sceneView.targetPitch - sceneView.pitch) > 0.003
    || Math.abs(sceneView.targetZoom - sceneView.zoom) > 0.0003
    || Math.abs(phaseScale - sceneView.baseScale) > 0.0003;
  if (unsettled) scheduleSceneViewUpdate();
}

function resetSceneView() {
  sceneView.targetYaw = 0;
  sceneView.targetPitch = 0;
  sceneView.targetZoom = 0;
  scheduleSceneViewUpdate();
}

sceneResetButton.addEventListener("click", resetSceneView);

cabinet.addEventListener("pointerdown", (event) => {
  if (isSceneControlTarget(event.target) || inspectionVisible) return;
  scenePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  cabinet.setPointerCapture?.(event.pointerId);
  cabinet.classList.add("is-scene-dragging");
  if (scenePointers.size === 1) {
    resetSceneDragAnchor(event.pointerId);
  } else if (scenePointers.size === 2) {
    const [first, second] = [...scenePointers.values()];
    scenePinchAnchor = {
      distance: Math.hypot(second.x - first.x, second.y - first.y),
      zoom: sceneView.targetZoom,
    };
  }
});

cabinet.addEventListener("pointermove", (event) => {
  if (!scenePointers.has(event.pointerId)) return;
  scenePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
  if (scenePointers.size >= 2 && scenePinchAnchor) {
    const [first, second] = [...scenePointers.values()];
    const distance = Math.hypot(second.x - first.x, second.y - first.y);
    sceneView.targetZoom = clampSceneValue(scenePinchAnchor.zoom + (distance - scenePinchAnchor.distance) / 520, 0, SCENE_ZOOM_LIMIT);
  } else if (sceneDragAnchor?.pointerId === event.pointerId) {
    const dx = event.clientX - sceneDragAnchor.x;
    const dy = event.clientY - sceneDragAnchor.y;
    sceneView.targetYaw = clampSceneValue(sceneDragAnchor.yaw + dx * 0.028, -SCENE_YAW_LIMIT, SCENE_YAW_LIMIT);
    sceneView.targetPitch = clampSceneValue(sceneDragAnchor.pitch - dy * 0.024, -SCENE_PITCH_LIMIT, SCENE_PITCH_LIMIT);
  }
  scheduleSceneViewUpdate();
});

function endScenePointer(event) {
  if (!scenePointers.has(event.pointerId)) return;
  scenePointers.delete(event.pointerId);
  if (cabinet.hasPointerCapture?.(event.pointerId)) cabinet.releasePointerCapture(event.pointerId);
  scenePinchAnchor = null;
  if (scenePointers.size === 1) {
    resetSceneDragAnchor(scenePointers.keys().next().value);
  } else if (scenePointers.size === 0) {
    sceneDragAnchor = null;
    cabinet.classList.remove("is-scene-dragging");
  }
}

cabinet.addEventListener("pointerup", endScenePointer);
cabinet.addEventListener("pointercancel", endScenePointer);
cabinet.addEventListener("lostpointercapture", endScenePointer);

cabinet.addEventListener("wheel", (event) => {
  if (isSceneControlTarget(event.target) || inspectionVisible) return;
  event.preventDefault();
  sceneView.targetZoom = clampSceneValue(sceneView.targetZoom - event.deltaY * 0.00042, 0, SCENE_ZOOM_LIMIT);
  scheduleSceneViewUpdate();
}, { passive: false });

window.addEventListener("resize", () => {
  scheduleSceneViewUpdate();
  requestAnimationFrame(() => setDeckCarouselCurrent(deckCarouselCurrentIndex, { scroll: true }));
});
scheduleSceneViewUpdate();


function buildDomParticles(container, count, bright) {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    const mote = document.createElement("i");
    mote.style.left = `${Math.random() * 100}%`;
    mote.style.top = `${Math.random() * 110}%`;
    mote.style.setProperty("--duration", `${9 + Math.random() * 18}s`);
    mote.style.setProperty("--delay", `${-Math.random() * 20}s`);
    mote.style.setProperty("--drift", `${-55 + Math.random() * 110}px`);
    if (bright && Math.random() > 0.7) {
      mote.style.width = "3px";
      mote.style.height = "3px";
      mote.style.boxShadow = "0 0 9px #d3aa62";
    }
    fragment.append(mote);
  }
  container.append(fragment);
}


function buildCardRail() {
  cardRailObserver?.disconnect();
  cardRailObserver = null;
  cardRail.replaceChildren();
  cardRailAssetsReady = CARDS.length > 0;
  CARDS.forEach((card, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `rail-card${index === 0 ? " is-active" : ""}`;
    button.setAttribute("aria-label", card.name);
    const image = document.createElement("img");
    image.alt = card.name;
    image.width = 192;
    image.height = 336;
    image.loading = "lazy";
    image.decoding = "async";
    image.dataset.src = card.thumbnailSrc;
    image.dataset.fallbackSrc = card.fallbackSrc;
    image.addEventListener("load", () => button.classList.add("is-image-ready"));
    image.addEventListener("error", () => {
      if (image.dataset.fallbackAttempted !== "true") {
        image.dataset.fallbackAttempted = "true";
        image.src = card.fallbackSrc;
      }
      else button.classList.add("is-image-ready");
    });
    button.append(image);
    button.addEventListener("click", () => selectCard(index));
    cardRail.append(button);
  });
  cardCatalogToggle.disabled = !cardRailAssetsReady;
  cardCatalogCount.textContent = `${CARDS.length} 張`;
  updateCardAssetReadiness();
}

function getBrowseSuitKey(card) {
  const suit = String(card.suit ?? card.numeral ?? card.name).toLowerCase();
  if (suit.includes("major")) return "major";
  if (suit.includes("wand")) return "wands";
  if (suit.includes("cup")) return "cups";
  if (suit.includes("sword")) return "swords";
  return "pentacles";
}

function setBrowseFilter(filter) {
  activeBrowseFilter = filter || "all";
  document.querySelectorAll("[data-browse-filter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.browseFilter === activeBrowseFilter);
  });
  browseCardGrid.querySelectorAll(".browse-card").forEach((card) => {
    card.hidden = activeBrowseFilter !== "all" && card.dataset.suit !== activeBrowseFilter;
  });
}

function updateBrowseCounts() {
  const counts = { all: CARDS.length, major: 0, wands: 0, cups: 0, swords: 0, pentacles: 0 };
  CARDS.forEach((card) => {
    const key = getBrowseSuitKey(card);
    if (Object.hasOwn(counts, key)) counts[key] += 1;
  });
  document.querySelectorAll("[data-browse-filter]").forEach((button) => {
    const count = counts[button.dataset.browseFilter] ?? 0;
    const label = button.querySelector("span");
    if (label) label.textContent = String(count);
  });
  browseTotalCount.textContent = String(CARDS.length);
}

function updateDedicatedWorkbenchLink() {
  const workbench = DECKS[activeDeckKey]?.workbench;
  browseDedicatedWorkbench.hidden = !workbench;
  if (workbench) browseDedicatedWorkbench.href = workbench;
}

function openBrowseViewer(card) {
  const number = String(card.index ?? 0).padStart(2, "0");
  browseViewerImage.src = card.src;
  browseViewerImage.alt = `${number} ${card.name}${card.nameZh ? ` ${card.nameZh}` : ""}`;
  browseViewerIndex.textContent = `${number} · ${card.suit || "TAROT"}`;
  browseViewerTitle.textContent = card.name;
  browseViewerSubtitle.textContent = card.nameZh || card.numeral;
  if (typeof browseViewer.showModal === "function") browseViewer.showModal();
  else browseViewer.setAttribute("open", "");
}

function renderBrowseGrid() {
  if (!CARDS.length || cardCatalogDeckKey !== activeDeckKey) {
    browseCardGrid.innerHTML = '<p class="browse-loading">正在整理完整牌面…</p>';
    browseLoadedCount.textContent = "0";
    browseTotalCount.textContent = "—";
    return;
  }
  if (browseRenderedDeckKey === activeDeckKey && browseCardGrid.querySelector(".browse-card")) {
    setBrowseFilter(activeBrowseFilter);
    return;
  }

  browseRenderedDeckKey = activeDeckKey;
  const renderedDeckKey = activeDeckKey;
  browseLoadedCount.textContent = "0";
  updateBrowseCounts();
  browseCardGrid.replaceChildren();
  let loaded = 0;
  CARDS.forEach((card) => {
    const article = document.createElement("article");
    article.className = "browse-card";
    article.dataset.suit = getBrowseSuitKey(card);

    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", `檢視 ${card.name}${card.nameZh ? ` ${card.nameZh}` : ""}`);

    const frame = document.createElement("span");
    frame.className = "browse-card-frame";
    const image = document.createElement("img");
    image.loading = "lazy";
    image.decoding = "async";
    image.alt = "";
    image.src = card.thumbnailSrc;
    image.addEventListener("load", () => {
      article.classList.add("is-loaded");
      loaded += 1;
      if (browseRenderedDeckKey === renderedDeckKey && article.isConnected) {
        browseLoadedCount.textContent = String(loaded);
      }
    }, { once: true });
    image.addEventListener("error", () => {
      if (image.dataset.fallbackAttempted !== "true") {
        image.dataset.fallbackAttempted = "true";
        image.src = card.fallbackSrc;
      } else {
        article.classList.add("is-error");
      }
    });
    frame.append(image);

    const metadata = document.createElement("span");
    metadata.className = "browse-card-meta";
    const number = document.createElement("small");
    number.textContent = String(card.index ?? 0).padStart(2, "0");
    const names = document.createElement("span");
    const english = document.createElement("strong");
    english.textContent = card.name;
    const chinese = document.createElement("em");
    chinese.textContent = card.nameZh || card.numeral;
    names.append(english, chinese);
    metadata.append(number, names);
    button.append(frame, metadata);
    button.addEventListener("click", () => openBrowseViewer(card));
    article.append(button);
    browseCardGrid.append(article);
  });
  setBrowseFilter(activeBrowseFilter);
}

function loadCardRailImage(image) {
  if (!(image instanceof HTMLImageElement) || image.src || !image.dataset.src) return;
  image.src = image.dataset.src;
}

function beginLazyCardRailLoading() {
  const images = Array.from(cardRail.querySelectorAll("img[data-src]"));
  if (!("IntersectionObserver" in window)) {
    images.forEach(loadCardRailImage);
    return;
  }
  if (!cardRailObserver) {
    cardRailObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        loadCardRailImage(entry.target);
        cardRailObserver.unobserve(entry.target);
      });
    }, { root: cardCatalogPanel, rootMargin: "280px 0px" });
  }
  images.forEach((image) => {
    if (!image.src) cardRailObserver.observe(image);
  });
}


function areCardAssetsReady() {
  return cardRailAssetsReady && cardWebGLAssetsReady && cardSummonAssetsReady;
}


function updateCardAssetReadiness() {
  inspection.dataset.cardAssetsReady = String(areCardAssetsReady());
}


function updateArtifactCopy() {
  const deck = DECKS[activeDeckKey];
  document.querySelector("#artifact-number").textContent = `SELECTED ARTIFACT / ${deck.number}`;
  document.querySelector("#artifact-header-title").textContent = deck.header;
  document.querySelector("#artifact-kicker").textContent = deck.kicker;
  document.querySelector("#artifact-title").innerHTML = deck.title;
  document.querySelector("#artifact-description").textContent = deck.description;
  document.querySelector("#artifact-structure").textContent = deck.structure;
  document.querySelector("#artifact-cards").textContent = deck.cards;
  document.querySelector("#artifact-basis").textContent = deck.basis;
  cardsModeTab.disabled = !deck.hasCards;
  cardsModeTab.title = deck.hasCards ? "檢視已拍攝牌面" : "需要獨立牌面照片才能啟用";
  browseModeTab.disabled = !deck.hasCards;
  browseModeTab.title = deck.hasCards ? "一般瀏覽與管理完整牌組" : "需要完整牌面才能啟用";
  browseDeckTitle.textContent = deck.header;
  updateDedicatedWorkbenchLink();
  const sequenceHint = isBookDeck(activeDeckKey)
    ? `單擊外盒開啟 · 單擊說明書取出／翻面 · 單擊${packageLabel()}浮出 · 再單擊${packageLabel()}抽牌`
    : "單擊外盒拉出或收回內盒";
  boxSequenceHint.dataset.defaultText = sequenceHint;
  boxSequenceHint.textContent = sequenceHint;
}


function showBoxFeedback(message, tone = "active", duration = 1700) {
  if (feedbackResetTimer !== null) window.clearTimeout(feedbackResetTimer);
  boxSequenceHint.textContent = message;
  boxSequenceHint.dataset.feedback = tone;
  boxSequenceHint.classList.remove("is-feedback");
  void boxSequenceHint.offsetWidth;
  boxSequenceHint.classList.add("is-feedback");
  if (duration <= 0) {
    feedbackResetTimer = null;
    return;
  }
  feedbackResetTimer = window.setTimeout(() => {
    boxSequenceHint.classList.remove("is-feedback");
    delete boxSequenceHint.dataset.feedback;
    boxSequenceHint.textContent = boxSequenceHint.dataset.defaultText ?? "拖曳旋轉 · 點擊操作藏品";
    feedbackResetTimer = null;
  }, duration);
}


function resetWoodlandInteraction() {
  setViewMenuOpen(false);
  woodlandPhase = WOODLAND_PHASE.CLOSED;
  cardRevealComplete = false;
  cardSummonStartedAt = 0;
  cardSummonProgress = 0;
  pendingSummonCardIndex = null;
  cardSummonAssetsReady = false;
  innerBoxGlowTarget = 0;
  innerBoxGlowCurrent = 0;
  guidebookExtractedTarget = 0;
  guidebookExtractedCurrent = 0;
  guidebookFlippedTarget = 0;
  guidebookFlippedCurrent = 0;
  pendingGuidebookExtraction = false;
  innerBoxExtractedTarget = 0;
  innerBoxExtractedCurrent = 0;
  artifactBrightnessTarget = 1;
  artifactBrightnessCurrent = 1;
  cardsModeTab.disabled = true;
  cardsModeTab.title = isBookDeck(activeDeckKey)
    ? `依序單擊說明書與${packageLabel()}，再單擊抽牌`
    : "正在準備完整牌組…";
  inspection.removeAttribute("aria-busy");
  inspection.classList.remove("is-inner-box-ready", "is-card-summoning", "is-card-focus", "is-card-back", "is-card-side");
  delete inspection.dataset.woodlandPhase;
  resetCardTransitionState();
}


function cancelPendingInspection() {
  inspectionEntryGeneration += 1;
  pendingInspection = null;
  const feedback = document.querySelector("#deck-load-feedback");
  if (feedback) feedback.hidden = true;
  getDeckCarouselSlides().forEach((slide) => { slide.setAttribute("aria-busy", "false"); });
}

async function enterInspection(deckKey, initialMode = "box") {
  if (!artifactStageReady || !DECKS[deckKey]) return;
  initialMode = initialMode === "browse" ? "browse" : "box";
  if (pendingInspection?.deckKey === deckKey && pendingInspection.initialMode === initialMode) return;
  cancelPendingInspection();
  const token = inspectionEntryGeneration;
  const currentFocus = document.activeElement;
  const slide = getDeckCarouselSlides().find((item) => item.dataset.deck === deckKey);
  const feedback = document.querySelector("#deck-load-feedback");
  pendingInspection = { token, deckKey, initialMode };
  slide?.setAttribute("aria-busy", "true");
  feedback.textContent = "正在準備這副牌盒…　Esc 可取消";
  feedback.hidden = false;
  try {
    await deckTextureCache.ensureDeck(deckKey);
  } catch (error) {
    if (token !== inspectionEntryGeneration) return;
    pendingInspection = null;
    slide?.setAttribute("aria-busy", "false");
    feedback.textContent = "這副牌盒暫時無法載入，請再點牌盒重試。";
    console.warn(`[arcana] unable to prepare ${deckKey}`, error);
    return;
  }
  if (token !== inspectionEntryGeneration || archive.dataset.phase !== "choose") return;
  pendingInspection = null;
  slide?.setAttribute("aria-busy", "false");
  feedback.hidden = true;
  drawRitual?.cancel({ restore: false });
  readingResult = null;
  drawRestoreState = null;
  updateReadingResult();
  inspectionReturnFocus = currentFocus instanceof HTMLElement && cabinet.contains(currentFocus)
    ? currentFocus
    : getDeckCarouselSlides()[deckCarouselCurrentIndex] ?? approachButton;
  activeDeckKey = deckKey;
  inspection.dataset.packageType = DECKS[deckKey].packageType ?? DECKS[deckKey].model ?? "artifact";
  updateArtifactCopy();
  if (isBookDeck(deckKey)) {
    applyBookDeckAppearance(deckKey);
    cardsModeTab.disabled = true;
    cardsModeTab.title = `依序單擊說明書與${packageLabel(deckKey)}後開啟`;
  } else if (deckKey === "unveiled") {
    applyUnveiledDeckAppearance();
  }
  woodlandRoot.visible = isBookDeck(deckKey);
  unveiledRoot.visible = deckKey === "unveiled";
  inspectionVisible = true;
  refreshDeckCarousel3DPreview();
  inspection.inert = false;
  cabinet.inert = true;
  inspection.classList.add("is-visible", "is-summoning");
  inspection.setAttribute("aria-hidden", "false");
  invokeAge = 0;
  resetWoodlandInteraction();
  // Hidden stages no longer animate in the background; enter from a closed pose.
  woodlandOpenCurrent = 0;
  unveiledOpenCurrent = 0;
  innerBoxExtractedCurrent = 0;
  woodlandHinge.rotation.y = 0;
  unveiledDrawer.position.set(0, 0, 0);
  if (DECKS[deckKey].hasCards) {
    void ensureDeckCardExperience(deckKey).then((cards) => {
      if (activeDeckKey !== deckKey) return;
      if (!isBookDeck(deckKey)) {
        cardRevealComplete = cards.length > 0;
        cardsModeTab.disabled = cards.length === 0;
        cardsModeTab.title = cards.length > 0 ? `抽取完整 ${cards.length} 張牌組` : "牌組載入失敗";
      }
      if (activeMode === "browse") renderBrowseGrid();
    });
  }
  setBoxOpen(0);
  setMode(initialMode === "browse" ? "browse" : "box", false);
  activateView("front");
  triggerMysticEffect(0.42);
  playInvocationSound();
  focusWhenVisible(() => inspectionVisible ? closeInspectionButton : null);
  window.setTimeout(() => {
    if (token === inspectionEntryGeneration) inspection.classList.remove("is-summoning");
  }, 1900);
}


function leaveInspection() {
  cancelPendingInspection();
  drawRitual?.cancel({ restore: false });
  readingResult = null;
  drawRestoreState = null;
  updateReadingResult();
  setViewMenuOpen(false);
  const returnTarget = inspectionReturnFocus?.isConnected ? inspectionReturnFocus : approachButton;
  inspectionReturnFocus = null;
  if (woodlandPhase === WOODLAND_PHASE.SUMMONING) {
    woodlandPhase = WOODLAND_PHASE.INNER_READY;
    cardSummonStartedAt = 0;
    cardSummonProgress = 0;
  }
  inspectionVisible = false;
  inspection.classList.remove("is-visible", "is-summoning");
  inspection.classList.remove("is-card-summoning", "is-card-focus", "is-card-back", "is-card-side");
  resetCardTransitionState();
  inspection.removeAttribute("aria-busy");
  cabinet.inert = false;
  setDeckPickerInteractive(archive.dataset.phase === "choose");
  inspection.inert = true;
  inspection.setAttribute("aria-hidden", "true");
  focusWhenVisible(returnTarget);
  if (browseViewer.open) browseViewer.close();
  controls.autoRotate = false;
  controls.enabled = true;
  refreshDeckCarousel3DPreview();
}


function setMode(mode, userInitiated = false) {
  if (isCardTransitionActive()) return;
  if (userInitiated && drawRitual?.isOpen) return;
  if (mode === "cards" && !DECKS[activeDeckKey].hasCards) return;
  if (mode === "cards" && isBookDeck(activeDeckKey) && !cardRevealComplete) return;
  if (mode === "browse" && !DECKS[activeDeckKey].hasCards) return;
  if (mode === "cards" && userInitiated && !readingResult) {
    drawRitual?.open();
    return;
  }
  activeMode = mode;
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  const cardsActive = mode === "cards";
  const browseActive = mode === "browse";
  boxControls.classList.toggle("is-hidden", cardsActive || browseActive);
  cardControls.setAttribute("aria-hidden", cardsActive ? "false" : "true");
  browsePanel.setAttribute("aria-hidden", browseActive ? "false" : "true");
  inspection.classList.toggle("is-browse-mode", browseActive);
  cardsGroup.visible = cardsActive && DECKS[activeDeckKey].hasCards;
  controls.autoRotate = false;
  controls.enabled = !browseActive;

  if (browseActive) {
    setViewMenuOpen(false);
    setCardCatalogOpen(false);
    cardsGroup.visible = false;
    browseDeckTitle.textContent = DECKS[activeDeckKey].header;
    updateDedicatedWorkbenchLink();
    artifactBrightnessTarget = 0.16;
    renderBrowseGrid();
  } else if (cardsActive) {
    setViewMenuOpen(false);
    setCardCatalogOpen(false);
    setBoxOpen(1, { sound: userInitiated });
    guidebookExtractedTarget = 1;
    innerBoxExtractedTarget = 1;
    woodlandPhase = WOODLAND_PHASE.CARDS;
    innerBoxGlowTarget = 0.58;
    artifactBrightnessTarget = 0.32;
    woodlandRoot.rotation.y = 0;
    woodlandRoot.rotation.z = 0;
    artifactTargetScale = 0.76;
    artifactTargetPosition.set(0, 0.03, -0.34);
    activeView = "front";
    document.querySelectorAll(".view-button").forEach((button) => {
      button.classList.toggle("is-active", button.dataset.view === "front");
    });
    queueCamera([0, 0.18, 4.55], [0, 0.01, 0.4], 760);
    selectCard(readingResult?.index ?? selectedCard, false);
    if (readingResult) {
      controls.enabled = false;
      artifactTargetScale = 0.6;
      artifactTargetPosition.set(0, -1.12, -0.8);
      queueCamera([0, 0.25, 6.8], [0, 0.1, 0.4], deckCarouselReducedMotion.matches ? 1 : 760);
    }
    triggerMysticEffect(0.35);
  } else {
    setCardCatalogOpen(false);
    cardsGroup.visible = false;
    if (woodlandPhase === WOODLAND_PHASE.CARDS) {
      woodlandPhase = WOODLAND_PHASE.INNER_READY;
      inspection.classList.add("is-inner-box-ready");
      inspection.dataset.woodlandPhase = woodlandPhase;
    }
    innerBoxGlowTarget = innerBoxExtractedTarget > 0.5 ? 1 : 0;
    artifactBrightnessTarget = 1;
    inspection.classList.remove("is-card-focus", "is-card-back", "is-card-side");
    artifactTargetScale = 1;
    artifactTargetPosition.set(0, 0, 0);
    activateView("front");
  }
  updateReadingResult();
}


function setCardCatalogOpen(open) {
  if (open && readingResult) return;
  if (open && !cardRailAssetsReady) return;
  cardCatalogToggle.setAttribute("aria-expanded", String(open));
  cardCatalogPanel.hidden = !open;
  cardControls.classList.toggle("is-catalog-open", open);
  if (open) requestAnimationFrame(beginLazyCardRailLoading);
}


function isCardTransitionActive() {
  return cardRedrawStartedAt > 0 || deckReturnStartedAt > 0;
}


function setCardInteractionLocked(locked) {
  const buttons = [
    document.querySelector("#previous-card"),
    document.querySelector("#next-card"),
    flipCardButton,
    redrawCardButton,
    returnDeckButton,
    cardCatalogToggle,
  ];
  buttons.forEach((button) => {
    button.disabled = locked || Boolean(readingResult && ["previous-card", "next-card", "card-catalog-toggle"].includes(button.id));
  });
  Array.from(cardRail.children).forEach((button) => { button.disabled = locked; });
  const boxModeTab = document.querySelector('.mode-tab[data-mode="box"]');
  boxModeTab.disabled = locked;
  cardsModeTab.disabled = locked || (isBookDeck(activeDeckKey) && !cardRevealComplete);
  browseModeTab.disabled = locked || !DECKS[activeDeckKey].hasCards;
}


function resetCardTransitionState() {
  cardRedrawStartedAt = 0;
  cardRedrawProgress = 0;
  deckReturnStartedAt = 0;
  deckReturnStageStartedAt = 0;
  deckReturnStage = null;
  deckReturnProgress = 0;
  returnCardOrigins = [];
  inspection.classList.remove("is-card-redrawing", "is-deck-returning");
  delete inspection.dataset.cardTransition;
  delete inspection.dataset.returnStage;
  inspection.removeAttribute("aria-busy");
  if (returnBeams) {
    returnBeams.visible = false;
    returnBeamMaterial.opacity = 0;
  }
  setCardInteractionLocked(false);
}


function setViewMenuOpen(open) {
  viewMenuToggle.setAttribute("aria-expanded", String(open));
  viewMenuPanel.hidden = !open;
  boxControls.classList.toggle("is-view-menu-open", open);
}


function getActiveOpenTarget() {
  return isBookDeck(activeDeckKey) ? woodlandOpenTarget : unveiledOpenTarget;
}


function setBoxOpen(value, { sound = false } = {}) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  if (isBookDeck(activeDeckKey)) {
    woodlandOpenTarget = clamped;
    if (clamped < 0.5) {
      setViewMenuOpen(false);
      pendingGuidebookExtraction = false;
      guidebookExtractedTarget = 0;
      guidebookFlippedTarget = 0;
      innerBoxExtractedTarget = 0;
      innerBoxGlowTarget = 0;
      cardRevealComplete = false;
      cardSummonStartedAt = 0;
      cardSummonProgress = 0;
      woodlandPhase = WOODLAND_PHASE.CLOSED;
      cardsModeTab.disabled = true;
      cardsModeTab.title = `依序單擊說明書與${packageLabel()}，再單擊抽牌`;
      inspection.removeAttribute("aria-busy");
      inspection.classList.remove("is-inner-box-ready", "is-card-summoning", "is-card-focus", "is-card-back", "is-card-side");
      inspection.dataset.woodlandPhase = woodlandPhase;
    } else if (woodlandPhase === WOODLAND_PHASE.CLOSED) {
      woodlandPhase = WOODLAND_PHASE.COVER_OPEN;
      inspection.dataset.woodlandPhase = woodlandPhase;
    }
  }
  else unveiledOpenTarget = clamped;
  const open = clamped > 0.5;
  const deck = DECKS[activeDeckKey];
  openButton.querySelector("span").textContent = open ? deck.closeLabel : deck.openLabel;
  openButton.querySelector("i").textContent = open ? "↙" : "↗";
  if (sound) playBoxSound(open, activeDeckKey);
  if (sound) {
    const message = isBookDeck(activeDeckKey)
      ? (open ? "外盒正在開啟，完成後點擊說明書" : "外盒正在闔上")
      : (open ? "內抽屜正在滑出" : "內抽屜正在收回");
    showBoxFeedback(message, open ? "active" : "muted");
  }
}


function selectCard(index, effect = true) {
  if (!CARDS.length) return;
  const readingEntry = readingEntries().find((entry) => entry.index === index);
  if (readingResult && !readingEntry) return;
  const previousCard = selectedCard;
  selectedCard = (index + CARDS.length) % CARDS.length;
  if (readingResult) readingResult.index = selectedCard;
  selectedFlipped = readingEntry ? !readingEntry.faceUp : true;
  inspection.dataset.cardFace = selectedFlipped ? "back" : "front";
  flipCardButton.querySelector("span").textContent = selectedFlipped ? "翻至正面" : "翻至背面";
  CARDS.forEach((card, cardNumber) => {
    cardRail.children[cardNumber]?.classList.toggle("is-active", cardNumber === selectedCard);
  });
  updateSelectedCardInfo();
  if (effect) {
    triggerMysticEffect(0.22);
    const rawDirection = index - previousCard;
    playCardSlide(rawDirection === 0 ? 0 : Math.sign(rawDirection));
  }
  if (readingResult) void ensureCardTexture(selectedCard);
  else if (!drawRitual?.isOpen) requestCardTextureWindow(selectedCard);
}

function readingEntries(result = readingResult) {
  return result ? [...result.session.draws, ...(result.session.cut ? [result.session.cut] : [])] : [];
}

function focusReadingCard(index, detail = false) {
  if (!readingResult || drawRitual?.isOpen || isCardTransitionActive()) return;
  if (!readingEntries().some((entry) => entry.index === index)) return;
  selectCard(index, false);
  readingResult.detail = detail ? index : null;
  updateReadingResult();
}

function showReadingOverview() {
  if (!readingResult || readingResult.detail === null || drawRitual?.isOpen || isCardTransitionActive()) return;
  readingResult.detail = null;
  updateReadingResult();
}

function activateReadingCard(index) {
  if (!readingResult || drawRitual?.isOpen || isCardTransitionActive()) return;
  if (readingFlips.has(index)) return;
  const entry = readingEntries().find((item) => item.index === index);
  if (!entry) return;
  focusReadingCard(index, entry.faceUp);
  if (!entry.faceUp) void flipSelectedCard();
}

function beginReadingCardFlip(entry, delay = 0) {
  const card = cardMeshes[entry.index];
  if (!card) return;
  readingFlips.set(entry.index, { result: readingResult, entry,
    from: card.rotation.y, to: entry.faceUp ? 0 : Math.PI,
    startedAt: performance.now(), delay,
    duration: deckCarouselReducedMotion.matches ? 0 : 720 });
}

function syncReadingArtifactVisibility() {
  if (!artifactStageReady) return;
  const ritualActive = ["shuffling", "cutting", "selecting", "revealing"].includes(inspection.dataset.ritualPhase);
  const showArtifact = !ritualActive && !(readingResult && activeMode === "cards");
  woodlandRoot.visible = showArtifact && isBookDeck(activeDeckKey);
  unveiledRoot.visible = showArtifact && activeDeckKey === "unveiled";
  plinth.visible = showArtifact;
}

async function revealReading() {
  const result = readingResult;
  if (!result || revealingResult === result || drawRitual?.isOpen || isCardTransitionActive()) return;
  const button = document.querySelector("#reveal-reading");
  revealingResult = result;
  button.disabled = true;
  const entries = readingEntries(result);
  const prepared = await Promise.all(entries.map((entry) => ensureCardTexture(entry.index)));
  if (revealingResult === result) {
    revealingResult = null;
    button.disabled = false;
  }
  if (result !== readingResult || drawRitual?.isOpen || !inspectionVisible) return;
  if (prepared.some((texture) => !texture)) {
    document.querySelector("#reading-result-status").textContent = "部分牌面載入失敗，請再次翻開；本輪結果不會改變。";
    return;
  }
  entries.filter((entry) => !entry.faceUp).forEach((entry, order) => {
    markDrawRevealed(result.session, entry.index);
    entry.faceUp = true;
    assignCardFaceTexture(entry.index, cardTexturePool.get(entry.index).texture);
    beginReadingCardFlip(entry, deckCarouselReducedMotion.matches ? 0 : order * 55);
  });
  selectedFlipped = false;
  inspection.dataset.cardFace = "front";
  flipCardButton.querySelector("span").textContent = "翻至背面";
  updateSelectedCardInfo();
  updateReadingResult();
  playCardFlip(-1);
}

function updateSelectedCardInfo(loadingFace = false) {
  if (!CARDS.length) return;
  if (selectedFlipped) {
    cardIndex.textContent = loadingFace ? "牌面載入中" : "ARCANA ···";
    cardName.textContent = loadingFace ? "正在準備牌面…" : "尚未翻牌";
    return;
  }
  const entry = readingEntries().find((card) => card.index === selectedCard);
  cardIndex.textContent = `ARCANA ${CARDS[selectedCard].numeral}${entry ? ` · ${entry.reversed ? "逆位" : "正位"}` : ""}`;
  cardName.textContent = getCardDisplayName(CARDS[selectedCard]);
}

function updateReadingResult() {
  syncReadingArtifactVisibility();
  readingLayoutDirty = true;
  readingPan = null;
  inspection.dataset.readingDetail = String(readingResult?.detail != null);
  if (!readingResult) { readingScroll.hidden = true; readingFlips.clear(); }
  inspection.dataset.readingActive = String(Boolean(readingResult && activeMode === "cards"));
  const strip = document.querySelector("#reading-result-strip");
  if (!strip) return;
  strip.hidden = !readingResult;
  document.querySelector("#spread-result").hidden = !readingResult || activeMode !== "cards";
  document.querySelector("#reveal-reading").hidden = !readingResult;
  document.querySelector("#reveal-reading").disabled = Boolean(readingResult && revealingResult === readingResult);
  document.querySelector("#export-reading").hidden = !readingResult;
  document.querySelector("#export-reading").disabled = exportingReading || readingFlips.size > 0 || Boolean(revealingResult);
  const question = String(readingResult?.session.question ?? "").trim();
  const questionPanel = document.querySelector("#reading-question");
  const questionText = document.querySelector("#reading-question-text");
  questionPanel.hidden = !question;
  if (questionText.textContent !== question) {
    questionText.textContent = question;
    questionText.scrollTop = 0;
  }
  if (!readingResult) return;
  const { session } = readingResult;
  const spread = getDrawSpread(session.spreadId);
  inspection.dataset.readingSpread = spread.id;
  document.querySelector("#reading-method").textContent = `${session.method === "starlight" ? "迎接命運" : "手動選牌"} · ${spread.name}`;
  document.querySelector("#reading-result-status").textContent = `主牌已揭曉 ${session.draws.filter((entry) => entry.revealed).length} / ${session.drawCount} · 切牌${session.cut?.revealed ? "已揭曉" : "待翻開"}`;
  document.querySelector("#spread-result-title").textContent = spread.name;
  document.querySelector("#spread-result-summary").textContent = `${session.drawCount} 張主牌 ＋ 1 張切牌 · 點牌翻開／放大，點空白處回到全部牌面`;
  const labels = document.querySelector("#spread-result-labels");
  const focusedIndex = labels.contains(document.activeElement) ? document.activeElement.dataset.readingIndex : null;
  const focusedSide = focusedIndex !== null ? document.activeElement.dataset.labelSide : null;
  labels.replaceChildren();
  readingEntries().forEach((entry, slot) => {
    const cut = entry === session.cut;
    const position = cut ? "切牌" : `${slot + 1} · ${spread.slots[slot].label}`;
    const flipping = readingFlips.get(entry.index)?.result === readingResult;
    const visibleFace = entry.faceUp && !flipping;
    const displayName = getCardDisplayName(CARDS[entry.index]);
    const concealedName = flipping ? "翻牌中…" : "尚未翻牌";
    const identity = visibleFace ? `${displayName} · ${entry.reversed ? "逆位" : "正位"}` : concealedName;
    const positionLabel = document.createElement("button");
    positionLabel.type = "button";
    positionLabel.className = `spread-card-label is-position${cut ? " is-cut" : ""}`;
    positionLabel.dataset.readingIndex = String(entry.index);
    positionLabel.dataset.labelSide = "top";
    positionLabel.setAttribute("aria-label", `${position}，${entry.faceUp ? "放大檢視" : "翻開牌面"}`);
    const meaning = document.createElement("span"); meaning.className = "spread-card-position";
    meaning.textContent = cut ? "切牌" : spread.slots[slot].label;
    positionLabel.append(meaning);
    const label = document.createElement("button");
    label.type = "button";
    label.className = `spread-card-label is-identity${cut ? " is-cut" : ""}`;
    label.dataset.readingIndex = String(entry.index);
    label.dataset.labelSide = "bottom";
    label.title = `${position} · ${identity}${visibleFace && displayName !== CARDS[entry.index].name ? ` · ${CARDS[entry.index].name}` : ""}`;
    label.setAttribute("aria-label", `${position}，${identity}，${entry.faceUp ? "放大檢視" : "翻開牌面"}`);
    label.setAttribute("aria-expanded", String(readingResult.detail === entry.index));
    const title = document.createElement("strong"); title.textContent = visibleFace ? displayName : concealedName;
    const context = document.createElement("span"); context.className = "spread-card-context";
    const orientation = document.createElement("span"); orientation.className = "spread-card-orientation";
    orientation.hidden = !visibleFace;
    orientation.textContent = visibleFace ? (entry.reversed ? "逆位" : "正位") : "";
    if (visibleFace) orientation.dataset.orientation = entry.reversed ? "reversed" : "upright";
    context.append(orientation);
    label.append(title, context);
    labels.append(positionLabel, label);
  });
  if (focusedIndex !== null) labels.querySelector(`[data-reading-index="${focusedIndex}"][data-label-side="${focusedSide}"]`)?.focus({ preventScroll: true });
}

async function exportReadingImage() {
  const result = readingResult;
  if (!result || exportingReading || readingFlips.size || drawRitual?.isOpen) return;
  const button = document.querySelector("#export-reading"), dialog = document.querySelector("#reading-export-dialog");
  const status = document.querySelector("#reading-export-status"), preview = document.querySelector("#reading-export-image");
  const download = document.querySelector("#reading-export-download"), openImage = document.querySelector("#reading-export-open");
  const model = createReadingExportModel({ session: result.session, cards: CARDS,
    deckName: DECKS[activeDeckKey].header, displayName: getCardDisplayName });
  const backImage = textures[`${activeDeckKey}:${DECKS[activeDeckKey].cardBack}`]?.image;
  exportingReading = true; button.disabled = true;
  readingImageShare.clear();
  status.textContent = "正在建立完整牌陣圖片…";
  preview.hidden = download.hidden = openImage.hidden = true;
  dialog.showModal();
  const canvas = document.createElement("canvas");
  try {
    const entries = [...model.draws, ...(model.cut ? [model.cut] : [])];
    const images = new Map(await Promise.all(entries.map(async (entry) => [entry.index,
      entry.faceUp ? (await ensureCardTexture(entry.index))?.image : backImage])));
    if (readingResult !== result || !dialog.open) return;
    renderReadingExport(canvas, { model, spread: getDrawSpread(model.spreadId), images });
    const blob = await readingExportBlob(canvas);
    if (readingResult !== result || !dialog.open) return;
    const previousUrl = readingExportUrl;
    readingExportUrl = URL.createObjectURL(blob);
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    preview.src = readingExportUrl;
    download.href = openImage.href = readingExportUrl;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    download.download = `塔羅-${getDrawSpread(model.spreadId).name}-${stamp}.png`;
    preview.hidden = download.hidden = openImage.hidden = false;
    readingImageShare.prepare(blob, download.download);
  } catch (error) {
    if (dialog.open) status.textContent = "圖片暫時無法建立，請關閉後重試；本輪抽牌不會改變。";
    console.warn("[arcana] reading export failed", error);
  } finally {
    canvas.width = canvas.height = 1;
    exportingReading = false;
    button.disabled = readingFlips.size > 0 || Boolean(revealingResult);
  }
}

function updateDrawEntry() {
  const button = document.querySelector("#prepare-draw");
  if (!button) return;
  button.hidden = !inspectionVisible || activeMode !== "box" || !DECKS[activeDeckKey].hasCards
    || (isBookDeck() && woodlandOpenTarget < 0.5);
  if (button.hidden) return;
  let label = "開始抽牌";
  let disabled = Boolean(drawRitual?.isOpen || isCardTransitionActive() || woodlandPhase === WOODLAND_PHASE.SUMMONING);
  if (isBookDeck()) {
    if (guidebookExtractedTarget < 0.5) {
      label = "取出說明書";
      disabled ||= woodlandOpenCurrent < 0.98;
    } else if (innerBoxExtractedTarget < 0.5) {
      label = `取出${packageLabel()}`;
      disabled ||= guidebookExtractedCurrent < 0.86;
    } else {
      disabled ||= innerBoxExtractedCurrent < 0.92;
    }
  }
  if (button.textContent !== label) button.textContent = label;
  button.disabled = disabled;
}

function cancelDrawAnimation() {
  if (!drawRestoreState) return;
  const snapshot = drawRestoreState;
  drawRestoreState = null;
  cardSummonStartedAt = 0;
  cardSummonProgress = 0;
  cardSummonAssetsReady = false;
  pendingSummonCardIndex = null;
  inspection.classList.remove("is-card-summoning");
  resetCardTransitionState();
  readingResult = snapshot.result;
  controls.enabled = snapshot.mode !== "browse" && !(snapshot.mode === "cards" && readingResult);
  cardRevealComplete = snapshot.revealComplete;
  selectedCard = snapshot.index;
  if (activeMode !== snapshot.mode) setMode(snapshot.mode, false);
  setBoxOpen(snapshot.openTarget);
  guidebookExtractedTarget = snapshot.guideTarget;
  innerBoxExtractedTarget = snapshot.innerTarget;
  innerBoxGlowTarget = snapshot.glowTarget;
  cardRevealComplete = snapshot.revealComplete;
  activeView = snapshot.view;
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === snapshot.view);
  });
  currentViewLabel.textContent = VIEW_LABELS[snapshot.view] ?? snapshot.view;
  (isBookDeck() ? woodlandRoot : unveiledRoot).rotation.copy(snapshot.rotation);
  artifactTargetScale = snapshot.artifactScale;
  artifactTargetPosition.copy(snapshot.artifactPosition);
  queueCamera(snapshot.camera, snapshot.cameraTarget, deckCarouselReducedMotion.matches ? 1 : 400);
  woodlandPhase = snapshot.phase;
  inspection.dataset.woodlandPhase = woodlandPhase;
  if (snapshot.phase === WOODLAND_PHASE.INNER_READY) inspection.classList.add("is-inner-box-ready");
  selectedFlipped = snapshot.flipped;
  if (snapshot.result) readingEntries(snapshot.result).forEach((entry) => { void ensureCardTexture(entry.index); });
  else if (snapshot.mode === "cards") requestCardTextureWindow(selectedCard);
  inspection.dataset.cardFace = selectedFlipped ? "back" : "front";
  flipCardButton.querySelector("span").textContent = selectedFlipped ? "翻至正面" : "翻至背面";
  updateSelectedCardInfo();
  updateReadingResult();
  setCardInteractionLocked(false);
  openButton.disabled = false;
  showBoxFeedback("已返回；隨時可以重新開始抽牌", "active", 1800);
}

function initializeDrawRitual() {
  drawRitual = createDrawRitual({
    getContext: () => ({
      deckKey: activeDeckKey,
      name: DECKS[activeDeckKey].header,
      backUrl: getDeckTextureUrl(activeDeckKey, DECKS[activeDeckKey].cardBack),
    }),
    onOpen() {
      drawRestoreState = {
        mode: activeMode, index: selectedCard, flipped: selectedFlipped,
        phase: woodlandPhase, revealComplete: cardRevealComplete, result: readingResult,
        openTarget: getActiveOpenTarget(), guideTarget: guidebookExtractedTarget,
        innerTarget: innerBoxExtractedTarget, glowTarget: innerBoxGlowTarget,
        view: activeView, camera: camera.position.toArray(), cameraTarget: controls.target.toArray(),
        rotation: (isBookDeck() ? woodlandRoot : unveiledRoot).rotation.clone(), artifactScale: artifactTargetScale,
        artifactPosition: artifactTargetPosition.clone(),
      };
      setCardCatalogOpen(false);
      setViewMenuOpen(false);
      if (activeMode === "browse") setMode("box", false);
      controls.enabled = false;
    },
    phaseChanged(value) {
      const active = value !== "idle";
      if (ringSelection) ringSelection.group.visible = value === "selecting";
      ringConfirm.hidden = value !== "selecting";
      if (value === "selecting") { ringRotation = 0; ringFocusedPosition = -1; }
      if (active) inspection.dataset.ritualPhase = value;
      else delete inspection.dataset.ritualPhase;
      syncReadingArtifactVisibility();
      inspection.querySelectorAll(".artifact-copy, .mode-tabs, #box-controls, #card-controls, #spread-result").forEach((element) => { element.inert = active; });
      controls.enabled = !active && activeMode !== "browse" && !(activeMode === "cards" && readingResult);
      renderer.domElement.tabIndex = ["cutting", "selecting"].includes(value) ? 0 : -1;
      renderer.domElement.setAttribute("aria-label", ["cutting", "selecting"].includes(value) ? "立體牌背選擇：左右鍵移動，Enter 切牌或選牌" : "3D 牌盒與卡牌展示");
      if (!active) {
        ritualPointer = null;
        ritualMotion.hover = -1;
        cardMeshes.forEach((card) => { card.visible = !readingResult || readingEntries().some((entry) => entry.index === card.userData.cardIndex); card.rotation.x = 0; });
        renderer.domElement.style.cursor = "grab";
        ritualEffects.setState({ phase: "idle" });
      }
    },
    loadDeck: ensureDeckCardExperience,
    startAnimation(session) {
      readingResult = null;
      updateReadingResult();
      cardRevealComplete = true;
      cardSummonStartedAt = 0;
      resetCardTransitionState();
      setMode("cards", false);
      setCardInteractionLocked(true);
      controls.enabled = false;
      ritualMotion.clock = 0;
      ritualMotion.energy = 0;
      ritualMotion.focus = 0;
      ritualMotion.hover = -1;
      const positions = new Map(session.order.map((index, position) => [index, position]));
      cardMeshes.forEach((card, index) => {
        card.userData.ritualPosition = positions.get(index) ?? -1;
        card.rotation.set(0, Math.PI, 0);
        card.userData.frontSurface.rotation.z = 0;
        card.userData.frontReflection.rotation.z = 0;
        card.userData.frontMaterial.map = textures[`${activeDeckKey}:${DECKS[activeDeckKey].cardBack}`];
        card.userData.frontMaterial.needsUpdate = true;
      });
      artifactTargetScale = 0.6;
      artifactTargetPosition.set(0, -1.12, -0.8);
      artifactBrightnessTarget = 0.16;
      queueCamera([0, 0.25, 6.8], [0, 0.1, 0.4], deckCarouselReducedMotion.matches ? 1 : 900);
      playInvocationSound();
      drawRitual.animationComplete();
    },
    orderChanged(session) {
      const positions = new Map(session.order.map((index, position) => [index, position]));
      cardMeshes.forEach((card, index) => { card.userData.ritualPosition = positions.get(index) ?? -1; });
    },
    async prefetchSelection(indices, session) {
      if (activeDeckKey !== session.deckKey || drawRitual.session !== session) return;
      await Promise.allSettled(indices.map((index) => ensureCardTexture(index)));
    },
    async prepareSelection(indices, session) {
      if (!inspectionVisible || activeDeckKey !== session.deckKey || drawRitual.session !== session) throw new Error("Draw cancelled");
      const prepared = await Promise.all(indices.map((index) => ensureCardTexture(index)));
      if (prepared.some((texture) => !texture) || activeDeckKey !== session.deckKey || drawRitual.session !== session) throw new Error("Card unavailable");
    },
    commitSelection(index, session) {
      if (!inspectionVisible || activeDeckKey !== session.deckKey || drawRitual.session !== session) return;
      readingResult = { index, session, detail: null };
      cardRevealComplete = true;
      cardSummonAssetsReady = true;
      selectCard(index, false);
      setMode("cards", false);
      setCardInteractionLocked(false);
      updateCardAssetReadiness();
      updateReadingResult();
      drawRestoreState = null;
      playCardSlide(1);
    },
    cancelAnimation: cancelDrawAnimation,
    focusChoices() { renderer.domElement.focus({ preventScroll: true }); },
    focusResult() {
      const result = readingResult;
      focusWhenVisible(() => inspectionVisible && !drawRitual.isOpen && readingResult === result ? flipCardButton : null, 1000);
    },
  });
  document.querySelector("#prepare-draw").addEventListener("click", () => {
    if (isCardTransitionActive() || drawRitual.isOpen) return;
    if (!isBookDeck()) drawRitual.open();
    else if (guidebookExtractedTarget < 0.5) handleGuidebookClick();
    else handleInnerBoxClick();
  });
}


async function flipSelectedCard() {
  if (activeMode !== "cards" || !inspectionVisible || drawRitual?.isOpen || isCardTransitionActive() || flipCardButton.disabled) return;
  const deckAtRequest = activeDeckKey;
  const generationAtRequest = cardTextureGeneration;
  const resultAtRequest = readingResult;
  const revealingFront = selectedFlipped;
  if (revealingFront && !isCardTextureReady(selectedCard)) {
    const requestedIndex = selectedCard;
    flipCardButton.disabled = true;
    inspection.dataset.cardTextureLoading = "true";
    updateSelectedCardInfo(true);
    const prepared = await ensureCardTexture(requestedIndex);
    if (deckAtRequest !== activeDeckKey || generationAtRequest !== cardTextureGeneration || resultAtRequest !== readingResult || !inspectionVisible) return;
    delete inspection.dataset.cardTextureLoading;
    flipCardButton.disabled = false;
    if (requestedIndex !== selectedCard || activeMode !== "cards") return;
    if (!prepared) {
      updateSelectedCardInfo();
      document.querySelector("#reading-result-status").textContent = "牌面載入失敗，請再次翻牌重試；抽定的牌會保留。";
      return;
    }
  }
  selectedFlipped = !selectedFlipped;
  inspection.dataset.cardFace = selectedFlipped ? "back" : "front";
  flipCardButton.querySelector("span").textContent = selectedFlipped ? "翻至正面" : "翻至背面";
  updateSelectedCardInfo();
  if (readingResult) {
    const entry = readingEntries().find((item) => item.index === selectedCard);
    if (!selectedFlipped) markDrawRevealed(readingResult.session, selectedCard);
    entry.faceUp = !selectedFlipped;
    assignCardFaceTexture(selectedCard, cardTexturePool.get(selectedCard)?.texture);
    beginReadingCardFlip(entry);
  }
  updateReadingResult();
  triggerMysticEffect(0.12);
  playCardFlip(selectedFlipped ? 1 : -1);
}


function triggerMysticEffect(trauma = 0.2) {
  flash.classList.remove("is-active");
  void flash.offsetWidth;
  flash.classList.add("is-active");
  shakeTrauma = Math.min(1, shakeTrauma + trauma);
  invokeAge = 0;
  pooledLights.forEach((entry, index) => {
    entry.target = index === 0 ? 12 : 4.5;
  });
}


function getAudioContext() {
  if (!soundEnabled) return null;
  if (!audioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    audioContext = new AudioContextClass();
  }
  if (audioContext.state === "suspended") void audioContext.resume();
  return audioContext;
}


function createNoiseSource(context, duration) {
  const frameCount = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, frameCount, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < frameCount; index += 1) {
    const envelope = 1 - index / frameCount;
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = context.createBufferSource();
  source.buffer = buffer;
  return source;
}


function routeWithPan(context, input, panValue) {
  if (typeof context.createStereoPanner !== "function") {
    input.connect(context.destination);
    return;
  }
  const panner = context.createStereoPanner();
  panner.pan.value = THREE.MathUtils.clamp(panValue, -1, 1);
  input.connect(panner).connect(context.destination);
}


function playBoxSound(open, deckKey) {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const duration = 1;
  const noise = createNoiseSource(context, duration);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(isBookDeck(deckKey) ? 720 : 980, now);
  filter.frequency.exponentialRampToValueAtTime(open ? 430 : 560, now + duration);
  filter.Q.value = 0.72;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.065, now + 0.035);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  noise.connect(filter).connect(gain).connect(context.destination);
  noise.start(now);

  const click = context.createOscillator();
  const clickGain = context.createGain();
  click.type = "triangle";
  click.frequency.setValueAtTime(open ? 118 : 164, now + duration * 0.66);
  click.frequency.exponentialRampToValueAtTime(72, now + duration * 0.82);
  clickGain.gain.setValueAtTime(0.0001, now + duration * 0.63);
  clickGain.gain.exponentialRampToValueAtTime(0.035, now + duration * 0.68);
  clickGain.gain.exponentialRampToValueAtTime(0.0001, now + duration * 0.84);
  click.connect(clickGain).connect(context.destination);
  click.start(now + duration * 0.63);
  click.stop(now + duration * 0.86);
}


function playCardSlide(direction = 0, delay = 0) {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime + delay;
  const noise = createNoiseSource(context, 0.16);
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(1850, now);
  filter.frequency.exponentialRampToValueAtTime(920, now + 0.16);
  filter.Q.value = 0.58;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.038, now + 0.018);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
  noise.connect(filter).connect(gain);
  routeWithPan(context, gain, direction * 0.38);
  noise.start(now);
}


function playCardFlip(direction) {
  playCardSlide(direction, 0);
  playCardSlide(-direction * 0.45, 0.085);
}


function playInvocationSound() {
  const context = getAudioContext();
  if (!context) return;
  const now = context.currentTime;
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = "sine";
  oscillator.frequency.setValueAtTime(92, now);
  oscillator.frequency.exponentialRampToValueAtTime(138, now + 0.72);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.032, now + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(now);
  oscillator.stop(now + 0.92);
}


// ─────────────────────────────────────────────────────────────────────────────
// Three.js artifact stage
// ─────────────────────────────────────────────────────────────────────────────

const scene = new THREE.Scene();
const ritualEffects = createRitualEffects(scene, { reducedMotion: deckCarouselReducedMotion.matches });
const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 30);
camera.position.set(0.32, 0.18, 4.55);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setClearColor(0x000000, 0);
stage.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.enablePan = false;
controls.minDistance = 2.25;
controls.maxDistance = 7;
controls.target.set(0, 0, 0);

let scenePointerGesture = null;
let sceneClickAllowed = null;
renderer.domElement.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  scenePointerGesture = {
    pointerId: event.pointerId,
    startedAt: performance.now(),
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
  };
}, true);
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!scenePointerGesture || scenePointerGesture.pointerId !== event.pointerId) return;
  const distance = Math.hypot(event.clientX - scenePointerGesture.startX, event.clientY - scenePointerGesture.startY);
  if (distance > SCENE_TAP_MAX_MOVE_PX) scenePointerGesture.moved = true;
}, true);
renderer.domElement.addEventListener("pointerup", (event) => {
  if (!scenePointerGesture || scenePointerGesture.pointerId !== event.pointerId) return;
  const elapsed = performance.now() - scenePointerGesture.startedAt;
  sceneClickAllowed = !scenePointerGesture.moved && elapsed <= SCENE_TAP_MAX_DURATION_MS;
  renderer.domElement.dataset.lastGesture = sceneClickAllowed ? "tap" : "drag";
  scenePointerGesture = null;
}, true);
renderer.domElement.addEventListener("pointercancel", () => {
  scenePointerGesture = null;
  sceneClickAllowed = false;
}, true);
renderer.domElement.addEventListener("click", (event) => {
  const allowed = sceneClickAllowed !== false;
  sceneClickAllowed = null;
  if (allowed) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);
controls.autoRotate = false;

scene.add(new THREE.HemisphereLight(0xbfd3c9, 0x160f0b, 1.8));

const keyLight = new THREE.DirectionalLight(0xffe6b5, 4.4);
keyLight.position.set(3.8, 5.2, 4.7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -4;
keyLight.shadow.camera.right = 4;
keyLight.shadow.camera.top = 4;
keyLight.shadow.camera.bottom = -4;
keyLight.shadow.camera.near = 0.1;
keyLight.shadow.camera.far = 14;
scene.add(keyLight);

const rimLight = new THREE.DirectionalLight(0x4a8e82, 3.8);
rimLight.position.set(-4.5, 2.3, -3.6);
scene.add(rimLight);

const pooledLights = [
  { light: new THREE.PointLight(0xe7b862, 0, 5, 2), target: 0 },
  { light: new THREE.PointLight(0x4f9c8e, 0, 4, 2), target: 0 },
  { light: new THREE.PointLight(0x8c6eb0, 0, 3, 2), target: 0 },
];
pooledLights[0].light.position.set(0, 0.2, 2.2);
pooledLights[1].light.position.set(-1.4, 0.7, 1.1);
pooledLights[2].light.position.set(1.5, -0.5, 1.3);
pooledLights.forEach((entry) => scene.add(entry.light));

const textureLoader = new THREE.TextureLoader();

function getDeckTextureUrl(deckKey, name) {
  return getTextureUrl(DECKS[deckKey], name);
}

const staticTextureRequests = createDeckTexturePlan(DECKS);

async function loadColorTexture(path, fallbackPath = null) {
  let texture;
  try {
    texture = await textureLoader.loadAsync(path);
  } catch (error) {
    if (!fallbackPath || fallbackPath === path) throw error;
    console.warn(`[arcana] card texture failed, using catalog fallback: ${path}`, error);
    texture = await textureLoader.loadAsync(fallbackPath);
  }
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 8);
  return texture;
}

const deckTextureCache = createDeckTextureCache(staticTextureRequests, loadColorTexture);
const textures = deckTextureCache.textures;
const previewTextureResults = await deckTextureCache.preloadPreviews();
if (previewTextureResults.some((result) => result.status === "rejected")) {
  console.warn("[arcana] Some box previews are unavailable; selecting that deck retries its materials.");
}

function createPaperBumpTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 160;
  canvas.height = 160;
  const context = canvas.getContext("2d");
  const image = context.createImageData(canvas.width, canvas.height);
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const offset = (y * canvas.width + x) * 4;
      const fiber = Math.sin(x * 0.72 + Math.sin(y * 0.19) * 2.2) * 5;
      const crossFiber = Math.sin(y * 0.55 + x * 0.08) * 3;
      const noise = (Math.random() - 0.5) * 18;
      const value = THREE.MathUtils.clamp(128 + fiber + crossFiber + noise, 0, 255);
      image.data[offset] = value;
      image.data[offset + 1] = value;
      image.data[offset + 2] = value;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(5, 7);
  return texture;
}

const paperBumpTexture = createPaperBumpTexture();

const managedMaterials = [];
function createMaterial({ map = null, color = 0xffffff, roughness = 0.84, metalness = 0, transparent = false, alphaTest = 0, paper = true } = {}) {
  const material = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness,
    metalness,
    transparent,
    alphaTest,
    bumpMap: paper ? paperBumpTexture : null,
    bumpScale: paper ? 0.006 : 0,
  });
  managedMaterials.push(material);
  return material;
}


// A single lightweight WebGL stage is moved between carousel items. The
// centered deck gets the real closed-box model; every other item immediately
// falls back to its photographed front, so it stays still and faces forward.
function createDeckCarouselRadialTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d");
  context.globalCompositeOperation = "lighter";
  const wisps = [
    [76, 94, 70, 0.48],
    [121, 74, 61, 0.34],
    [112, 124, 58, 0.3],
    [57, 128, 43, 0.2],
  ];
  wisps.forEach(([x, y, radius, alpha]) => {
    const gradient = context.createRadialGradient(x, y, radius * 0.04, x, y, radius);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.28, `rgba(255,255,255,${alpha * 0.62})`);
    gradient.addColorStop(0.68, `rgba(255,255,255,${alpha * 0.16})`);
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createDeckCarouselSparkTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const core = context.createRadialGradient(32, 32, 0, 32, 32, 17);
  core.addColorStop(0, "rgba(255,255,255,1)");
  core.addColorStop(0.12, "rgba(255,246,211,.94)");
  core.addColorStop(0.42, "rgba(235,205,141,.34)");
  core.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = core;
  context.fillRect(0, 0, 64, 64);
  const horizontal = context.createLinearGradient(8, 32, 56, 32);
  horizontal.addColorStop(0, "rgba(255,255,255,0)");
  horizontal.addColorStop(0.5, "rgba(255,247,218,.58)");
  horizontal.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = horizontal;
  context.fillRect(8, 31.4, 48, 1.2);
  const vertical = context.createLinearGradient(32, 10, 32, 54);
  vertical.addColorStop(0, "rgba(255,255,255,0)");
  vertical.addColorStop(0.5, "rgba(255,247,218,.46)");
  vertical.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = vertical;
  context.fillRect(31.4, 10, 1.2, 44);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getDeckCarouselDimension(value, fallback, { allowZero = false } = {}) {
  const numericValue = Number(value);
  const valid = Number.isFinite(numericValue) && (numericValue > 0 || (allowZero && numericValue === 0));
  return valid ? numericValue : fallback;
}

function getDeckCarousel3DDefinition(deck) {
  const bookStyle = deck.model === "book";
  const configured = deck.selector3D ?? {};
  const defaultFaces = bookStyle
    ? {
        front: "outer-front.jpg",
        back: "outer-back.jpg",
        inside: "outer-inside.jpg",
        left: "outer-left.jpg",
        right: "outer-right.jpg",
        top: "outer-top.jpg",
        bottom: "outer-bottom.jpg",
      }
    : {
        front: deck.selectorCover ?? "front.jpg",
        back: "back.jpg",
        left: "left.jpg",
        right: "right.jpg",
        top: "top.jpg",
      };
  return {
    bookStyle,
    width: getDeckCarouselDimension(configured.width, bookStyle ? 1.18 : 1),
    height: getDeckCarouselDimension(configured.height, bookStyle ? 1.55 : 1.54),
    depth: getDeckCarouselDimension(configured.depth, bookStyle ? 0.34 : 0.54),
    coverDepth: getDeckCarouselDimension(configured.coverDepth, bookStyle ? 0.055 : 0, { allowZero: !bookStyle }),
    edgeColor: configured.edgeColor ?? deck.edgeColor ?? (bookStyle ? "#335853" : "#c7b39f"),
    faces: { ...defaultFaces, ...(configured.faces ?? {}) },
  };
}

function getDeckCarouselTexture(deckKey, file, fallbackFile = null) {
  if (file && textures[`${deckKey}:${file}`]) return textures[`${deckKey}:${file}`];
  if (fallbackFile && textures[`${deckKey}:${fallbackFile}`]) return textures[`${deckKey}:${fallbackFile}`];
  return null;
}

function createDeckCarouselMaterial(deckKey, file, color, fallbackFile = null) {
  const map = getDeckCarouselTexture(deckKey, file, fallbackFile);
  const material = new THREE.MeshPhysicalMaterial({
    map,
    color: map ? 0xffffff : color,
    roughness: map ? 0.58 : 0.8,
    metalness: 0,
    clearcoat: map ? 0.32 : 0.12,
    clearcoatRoughness: 0.48,
    sheen: map ? 0.2 : 0.08,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color(0xffe7b0),
    bumpMap: paperBumpTexture,
    bumpScale: 0.0035,
  });
  material.userData.deckTextureBinding = { deckKey, file, fallbackFile };
  managedMaterials.push(material);
  return material;
}

function addDeckCarouselEdges(mesh, color, edgeMaterials) {
  const material = new THREE.LineBasicMaterial({
    color,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), material);
  edges.scale.setScalar(1.004);
  edges.renderOrder = 3;
  mesh.add(edges);
  edgeMaterials.push(material);
}

function createDeckCarouselPreviewEntry([deckKey, deck], deckIndex, glowTexture, sparkleTexture) {
  const definition = getDeckCarousel3DDefinition(deck);
  const { faces, width, height, depth, coverDepth, edgeColor, bookStyle } = definition;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.05, 20);
  const root = new THREE.Group();
  root.name = `${deck.header} carousel preview`;
  root.rotation.order = "YXZ";
  scene.add(root);

  const edgeMaterials = [];
  if (bookStyle) {
    const bodyMaterials = [
      createDeckCarouselMaterial(deckKey, faces.right, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.left, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.top, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.bottom, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.inside, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.back, edgeColor),
    ];
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), bodyMaterials);
    root.add(body);
    addDeckCarouselEdges(body, edgeColor, edgeMaterials);

    const coverEdge = createDeckCarouselMaterial(deckKey, null, edgeColor);
    const coverMaterials = [
      coverEdge,
      coverEdge,
      coverEdge,
      coverEdge,
      createDeckCarouselMaterial(deckKey, faces.front, edgeColor, deck.selectorCover),
      createDeckCarouselMaterial(deckKey, faces.inside, edgeColor),
    ];
    const cover = new THREE.Mesh(new THREE.BoxGeometry(width, height, coverDepth), coverMaterials);
    cover.position.z = depth / 2 + coverDepth / 2 + 0.015;
    root.add(cover);
    addDeckCarouselEdges(cover, edgeColor, edgeMaterials);
  } else {
    const materials = [
      createDeckCarouselMaterial(deckKey, faces.right, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.left, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.top, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.bottom, edgeColor),
      createDeckCarouselMaterial(deckKey, faces.front, edgeColor, deck.selectorCover),
      createDeckCarouselMaterial(deckKey, faces.back, edgeColor),
    ];
    const box = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials);
    root.add(box);
    addDeckCarouselEdges(box, edgeColor, edgeMaterials);
  }

  const hemisphereLight = new THREE.HemisphereLight(0xfff0cf, 0x0b1210, 1.25);
  const keyLight = new THREE.DirectionalLight(0xffe2a4, 3.2);
  keyLight.position.set(2.8, 3.6, 4.2);
  const rimLight = new THREE.DirectionalLight(0x72b7a6, 2.45);
  rimLight.position.set(-3.4, 1.4, -2.6);
  const glintLight = new THREE.PointLight(0xffd782, 2.4, 7, 2);
  glintLight.position.set(-1.5, 1.1, 2.4);
  scene.add(hemisphereLight, keyLight, rimLight, glintLight);

  const glow = new THREE.Group();
  glow.name = "soft, non-geometric carousel aura";
  const glowMaterials = [];
  const glowLayers = [
    { color: edgeColor, x: -0.1, y: 0.02, z: -0.62, width: 2.42, height: 1.82, opacity: 0.14, phase: 0.2 },
    { color: 0xd8b76f, x: 0.18, y: -0.08, z: -0.66, width: 2.1, height: 1.66, opacity: 0.11, phase: 2.1 },
    { color: 0x79aa9c, x: -0.22, y: 0.15, z: -0.7, width: 1.94, height: 1.52, opacity: 0.09, phase: 4.3 },
  ];
  glowLayers.forEach((layer) => {
    const material = new THREE.SpriteMaterial({
      map: glowTexture,
      color: layer.color,
      transparent: true,
      opacity: layer.opacity,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      rotation: layer.phase * 0.17,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.set(layer.x * width, layer.y * height, layer.z);
    sprite.scale.set(width * layer.width, height * layer.height, 1);
    sprite.userData.carouselAura = layer;
    glow.add(sprite);
    glowMaterials.push(material);
  });
  scene.add(glow);

  const sparkleCount = 34;
  const sparklePositions = new Float32Array(sparkleCount * 3);
  for (let index = 0; index < sparkleCount; index += 1) {
    const seed = index + 1 + deckIndex * 41;
    const angle = ((seed * 0.61803398875) % 1) * Math.PI * 2;
    const radiusNoise = ((seed * 0.754877666) % 1);
    const radius = 0.34 + Math.pow(radiusNoise, 0.68) * 0.78;
    const horizontalWander = Math.sin(seed * 2.17) * 0.09;
    const verticalWander = Math.cos(seed * 1.73) * 0.07;
    sparklePositions[index * 3] = (Math.cos(angle) * radius + horizontalWander) * width;
    sparklePositions[index * 3 + 1] = (Math.sin(angle) * radius * 0.7 + verticalWander) * height;
    sparklePositions[index * 3 + 2] = 0.12 + ((seed * 0.438579) % 1) * 0.34;
  }
  const sparkleGeometry = new THREE.BufferGeometry();
  sparkleGeometry.setAttribute("position", new THREE.BufferAttribute(sparklePositions, 3));
  const sparkleMaterial = new THREE.PointsMaterial({
    map: sparkleTexture,
    color: 0xffe8b0,
    size: 0.052,
    transparent: true,
    opacity: 0.42,
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const sparkles = new THREE.Points(sparkleGeometry, sparkleMaterial);
  sparkles.renderOrder = 4;
  scene.add(sparkles);

  return {
    deckKey,
    scene,
    camera,
    root,
    definition,
    edgeMaterials,
    glow,
    glowMaterials,
    glintLight,
    sparkles,
    sparkleMaterial,
  };
}

function resetDeckCarousel3DEntry(entry) {
  if (!entry) return;
  entry.root.quaternion.identity();
  entry.root.position.set(0, 0, 0);
  entry.glow.children.forEach((sprite) => {
    const layer = sprite.userData.carouselAura;
    sprite.position.x = layer.x * entry.definition.width;
    sprite.position.y = layer.y * entry.definition.height;
    sprite.material.rotation = layer.phase * 0.17;
  });
  entry.glow.scale.setScalar(1);
  entry.sparkles.position.set(0, 0, 0);
  entry.sparkles.rotation.set(0, 0, 0);
}

function deactivateDeckCarousel3DPreview() {
  const slides = getDeckCarouselSlides();
  if (deckCarousel3DActiveIndex >= 0) {
    slides[deckCarousel3DActiveIndex]?.classList.remove("is-3d-preview-active");
    resetDeckCarousel3DEntry(deckCarousel3DEntries[deckCarousel3DActiveIndex]);
  }
  deckCarousel3DCanvas?.remove();
  deckCarousel3DActiveIndex = -1;
  deckCarousel3DWidth = 0;
  deckCarousel3DHeight = 0;
}

function activateDeckCarousel3DPreview(index) {
  if (!deckCarousel3DReady || !deckCarousel3DCanvas || deckCarousel3DFailedIndices.has(index)) return;
  if (!deckCarousel3DEntries[index]) {
    try {
      deckCarousel3DEntries[index] = createDeckCarouselPreviewEntry(
        deckEntries[index],
        index,
        deckCarousel3DGlowTexture,
        deckCarousel3DSparkTexture,
      );
    } catch (error) {
      deckCarousel3DFailedIndices.add(index);
      console.warn(`[arcana] 3D preview unavailable for ${deckEntries[index]?.[0] ?? `deck ${index + 1}`}; using its photographed cover.`, error);
      return;
    }
  }
  const slide = getDeckCarouselSlides()[index];
  const object = slide?.querySelector(".deck-object");
  if (!object) return;
  // A failed outer-face load can succeed when the selected deck is retried.
  // Repair its existing preview materials without recreating shared GPU textures.
  deckCarousel3DEntries[index].root.traverse((mesh) => {
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const binding = material?.userData.deckTextureBinding;
      if (!binding) continue;
      const map = getDeckCarouselTexture(binding.deckKey, binding.file, binding.fallbackFile);
      if (!map || material.map === map) continue;
      material.map = map;
      material.color.set(0xffffff);
      material.roughness = 0.58;
      material.clearcoat = 0.32;
      material.sheen = 0.2;
      material.needsUpdate = true;
    }
  });
  if (deckCarousel3DActiveIndex === index && deckCarousel3DCanvas.parentElement === object) return;
  deactivateDeckCarousel3DPreview();
  resetDeckCarousel3DEntry(deckCarousel3DEntries[index]);
  object.append(deckCarousel3DCanvas);
  slide.classList.add("is-3d-preview-active");
  deckCarousel3DActiveIndex = index;
  renderDeckCarousel3DPreview(0, performance.now() / 1000);
}

function refreshDeckCarousel3DPreview() {
  const canPresent = deckCarousel3DReady
    && archive.dataset.phase === "choose"
    && !inspectionVisible
    && !deckCarouselMotionActive
    && document.visibilityState === "visible";
  if (!canPresent) {
    deactivateDeckCarousel3DPreview();
    return;
  }
  activateDeckCarousel3DPreview(deckCarouselCurrentIndex);
}

function fitDeckCarousel3DCamera(entry, aspect) {
  const fit = calculateDeckCarouselCameraFit(entry.definition, aspect, {
    verticalFovDegrees: entry.camera.fov,
  });
  entry.camera.userData.carouselFit = fit;
  entry.camera.position.set(0, 0, fit.distance);
  entry.camera.lookAt(0, 0, 0);
}

function renderDeckCarousel3DPreview(dt, time) {
  if (!deckCarousel3DReady || deckCarousel3DActiveIndex < 0 || !deckCarousel3DCanvas?.isConnected) return;
  const entry = deckCarousel3DEntries[deckCarousel3DActiveIndex];
  const width = Math.max(1, Math.round(deckCarousel3DCanvas.clientWidth));
  const height = Math.max(1, Math.round(deckCarousel3DCanvas.clientHeight));
  if (width !== deckCarousel3DWidth || height !== deckCarousel3DHeight) {
    deckCarousel3DWidth = width;
    deckCarousel3DHeight = height;
    const maximumPixelRatio = window.matchMedia("(max-width: 680px)").matches ? 1.25 : 1.5;
    deckCarousel3DRenderer.setPixelRatio(Math.min(window.devicePixelRatio, maximumPixelRatio));
    deckCarousel3DRenderer.setSize(width, height, false);
    entry.camera.aspect = width / height;
    entry.camera.updateProjectionMatrix();
    fitDeckCarousel3DCamera(entry, entry.camera.aspect);
  }

  if (!deckCarouselReducedMotion.matches) {
    entry.root.rotation.y = (entry.root.rotation.y + dt * 0.56) % (Math.PI * 2);
    entry.root.rotation.x = -0.035 + Math.sin(time * 0.72) * 0.025;
    entry.root.position.y = Math.sin(time * 0.92) * 0.022;
    entry.sparkles.position.x = Math.sin(time * 0.31 + deckCarousel3DActiveIndex) * 0.018;
    entry.sparkles.position.y = Math.cos(time * 0.37 + deckCarousel3DActiveIndex * 0.7) * 0.014;
  } else {
    entry.root.rotation.set(0, 0, 0);
    entry.root.position.y = 0;
    entry.sparkles.position.set(0, 0, 0);
    entry.sparkles.rotation.set(0, 0, 0);
  }

  const reducedMotion = deckCarouselReducedMotion.matches;
  const shimmer = reducedMotion ? 0.5 : 0.5 + Math.sin(time * 3.1 + deckCarousel3DActiveIndex) * 0.5;
  if (reducedMotion) {
    entry.glintLight.position.set(-1.5, 1.1, 2.4);
  } else {
    entry.glintLight.position.x = Math.sin(time * 1.35) * 1.85;
    entry.glintLight.position.y = 0.78 + Math.cos(time * 1.08) * 0.62;
  }
  entry.glintLight.intensity = reducedMotion ? 1.6 : 2.1 + shimmer * 1.8;
  entry.glow.children.forEach((sprite, index) => {
    const layer = sprite.userData.carouselAura;
    const pulse = reducedMotion ? 0.74 : 0.72 + Math.sin(time * (0.48 + index * 0.07) + layer.phase) * 0.16;
    sprite.material.opacity = layer.opacity * pulse;
    sprite.material.rotation = layer.phase * 0.17 + (reducedMotion ? 0 : Math.sin(time * 0.19 + layer.phase) * 0.045);
    sprite.position.x = layer.x * entry.definition.width + (reducedMotion ? 0 : Math.sin(time * 0.23 + layer.phase) * 0.025);
    sprite.position.y = layer.y * entry.definition.height + (reducedMotion ? 0 : Math.cos(time * 0.27 + layer.phase) * 0.02);
  });
  entry.sparkleMaterial.opacity = reducedMotion ? 0.16 : 0.2 + shimmer * 0.24;
  entry.edgeMaterials.forEach((material) => {
    material.opacity = reducedMotion ? 0.22 : 0.28 + shimmer * 0.22;
  });
  const sparkleScale = reducedMotion ? 1 : 0.985 + shimmer * 0.025;
  entry.sparkles.scale.setScalar(sparkleScale);
  deckCarousel3DRenderer.render(entry.scene, entry.camera);
}

function initializeDeckCarousel3D() {
  try {
    deckCarousel3DCanvas = document.createElement("canvas");
    deckCarousel3DCanvas.className = "deck-carousel-3d";
    deckCarousel3DCanvas.setAttribute("aria-hidden", "true");
    deckCarousel3DRenderer = new THREE.WebGLRenderer({
      canvas: deckCarousel3DCanvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    deckCarousel3DRenderer.outputColorSpace = THREE.SRGBColorSpace;
    deckCarousel3DRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    deckCarousel3DRenderer.toneMappingExposure = 1.05;
    deckCarousel3DRenderer.setClearColor(0x000000, 0);
    deckCarousel3DGlowTexture = createDeckCarouselRadialTexture();
    deckCarousel3DSparkTexture = createDeckCarouselSparkTexture();
    deckCarousel3DEntries = new Array(deckEntries.length).fill(null);
    deckCarousel3DReady = true;
    deckCarousel.classList.add("has-3d-carousel");
    deckCarousel3DCanvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      deckCarousel3DReady = false;
      deckCarousel.classList.remove("has-3d-carousel");
      deactivateDeckCarousel3DPreview();
    });
    deckCarousel3DCanvas.addEventListener("webglcontextrestored", () => {
      deckCarousel3DReady = true;
      deckCarousel.classList.add("has-3d-carousel");
      refreshDeckCarousel3DPreview();
    });
    refreshDeckCarousel3DPreview();
  } catch (error) {
    deckCarousel3DReady = false;
    deckCarousel3DRenderer?.dispose();
    deckCarousel3DCanvas?.remove();
    deckCarousel3DRenderer = null;
    deckCarousel3DCanvas = null;
    console.warn("[arcana] 3D deck carousel unavailable; using photographed covers.", error);
  }
}

initializeDeckCarousel3D();

document.addEventListener("visibilitychange", refreshDeckCarousel3DPreview);
deckCarouselReducedMotion.addEventListener("change", () => {
  resetDeckCarousel3DEntry(deckCarousel3DEntries[deckCarousel3DActiveIndex]);
  refreshDeckCarousel3DPreview();
});

const greenEdge = createMaterial({ color: 0x335853, roughness: 0.95 });
const goldPaper = createMaterial({ color: 0xa87c40, roughness: 0.9 });
const diamondLining = createMaterial({ map: textures["woodland:outer-inside.jpg"], roughness: 0.93 });
const neutralPaper = createMaterial({ color: 0xc7b39f, roughness: 0.92 });
const darkPaper = createMaterial({ color: 0x242526, roughness: 0.9 });
const cardEdgeMaterial = new THREE.MeshPhysicalMaterial({
  color: 0xd7cfbf,
  roughness: 0.38,
  metalness: 0,
  clearcoat: 0.18,
  clearcoatRoughness: 0.58,
  sheen: 0.22,
  sheenColor: new THREE.Color(0xffedc9),
  bumpMap: paperBumpTexture,
  bumpScale: 0.0022,
});
managedMaterials.push(cardEdgeMaterial);


// Woodland book-style box. The inner package is recessed and only 0.04 scene
// units deep, so the 0.055 cover fully contains it when closed.
const woodlandRoot = new THREE.Group();
woodlandRoot.name = "Woodland Fairy Tale Tarot";
scene.add(woodlandRoot);

const WOODLAND_WIDTH = 1.18;
const WOODLAND_HEIGHT = 1.55;
const WOODLAND_DEPTH = 0.34;
const COVER_DEPTH = 0.055;
const woodlandBaseMaterials = [
  createMaterial({ map: textures["woodland:outer-right.jpg"] }),
  createMaterial({ map: textures["woodland:outer-left.jpg"] }),
  createMaterial({ map: textures["woodland:outer-top.jpg"] }),
  createMaterial({ map: textures["woodland:outer-bottom.jpg"] }),
  diamondLining,
  createMaterial({ map: textures["woodland:outer-back.jpg"] }),
];
const woodlandBase = new THREE.Mesh(new THREE.BoxGeometry(WOODLAND_WIDTH, WOODLAND_HEIGHT, WOODLAND_DEPTH), woodlandBaseMaterials);
woodlandBase.castShadow = true;
woodlandBase.receiveShadow = true;
woodlandRoot.add(woodlandBase);

const woodlandHinge = new THREE.Group();
woodlandHinge.position.set(-WOODLAND_WIDTH / 2, 0, WOODLAND_DEPTH / 2 + COVER_DEPTH / 2 + 0.015);
woodlandRoot.add(woodlandHinge);
const woodlandCoverMaterials = [greenEdge, greenEdge, greenEdge, greenEdge, createMaterial({ map: textures["woodland:outer-front.jpg"] }), diamondLining];
const woodlandCover = new THREE.Mesh(new THREE.BoxGeometry(WOODLAND_WIDTH, WOODLAND_HEIGHT, COVER_DEPTH), woodlandCoverMaterials);
woodlandCover.position.x = WOODLAND_WIDTH / 2;
woodlandCover.castShadow = true;
woodlandHinge.add(woodlandCover);

const woodlandTray = new THREE.Group();
woodlandTray.position.z = WOODLAND_DEPTH / 2 + 0.004;
woodlandRoot.add(woodlandTray);
const frameWidth = 0.055;
const frameDepth = 0.026;
// Measured from 411495_0.jpg: the visible gold recess is a tall rectangle,
// about 86% of the case width and 91% of its height. The earlier 55%-height
// frame made the second layer look like a wide landscape box.
const trayWidth = WOODLAND_WIDTH * 0.86;
const trayHeight = WOODLAND_HEIGHT * 0.91;
const frameTop = new THREE.Mesh(new THREE.BoxGeometry(trayWidth, frameWidth, frameDepth), goldPaper);
const frameBottom = frameTop.clone();
const frameLeft = new THREE.Mesh(new THREE.BoxGeometry(frameWidth, trayHeight, frameDepth), goldPaper);
const frameRight = frameLeft.clone();
frameTop.position.y = trayHeight / 2;
frameBottom.position.y = -trayHeight / 2;
frameLeft.position.x = -trayWidth / 2;
frameRight.position.x = trayWidth / 2;
[frameTop, frameBottom, frameLeft, frameRight].forEach((mesh) => { mesh.castShadow = true; woodlandTray.add(mesh); });

const woodlandInnerMaterials = [
  createMaterial({ map: textures["woodland:inner-right.jpg"] }),
  createMaterial({ map: textures["woodland:inner-left.jpg"] }),
  createMaterial({ map: textures["woodland:inner-top.jpg"] }),
  createMaterial({ map: textures["woodland:inner-bottom.jpg"] }),
  createMaterial({ map: textures["woodland:inner-front-upright.jpg"] }),
  createMaterial({ map: textures["woodland:inner-back-upright.jpg"] }),
];
// In the reference, the second-layer box occupies roughly 71% × 82% of the
// outer case and stays vertically seated inside an even gold border.
const INNER_BOX_WIDTH = WOODLAND_WIDTH * 0.71;
const INNER_BOX_HEIGHT = WOODLAND_HEIGHT * 0.82;
const woodlandInnerPackage = new THREE.Mesh(new THREE.BoxGeometry(INNER_BOX_WIDTH, INNER_BOX_HEIGHT, 0.07), woodlandInnerMaterials);
// The inner card box sits below the 128-page guidebook, matching the supplied
// open-box photographs instead of sharing the same visible layer.
woodlandInnerPackage.position.set(0, -0.025, -0.035);
woodlandInnerPackage.rotation.z = 0;
woodlandInnerPackage.castShadow = true;
woodlandInnerPackage.receiveShadow = true;
woodlandInnerPackage.userData.interaction = "inner-box";
woodlandTray.add(woodlandInnerPackage);

const innerBoxEdgeMaterial = new THREE.LineBasicMaterial({
  color: 0xf1c66f,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const innerBoxEdgeGlow = new THREE.LineSegments(new THREE.EdgesGeometry(woodlandInnerPackage.geometry), innerBoxEdgeMaterial);
innerBoxEdgeGlow.scale.setScalar(1.012);
innerBoxEdgeGlow.renderOrder = 8;
woodlandInnerPackage.add(innerBoxEdgeGlow);
const innerBoxGlowLight = new THREE.PointLight(0xe7bd68, 0, 3.4, 2);
innerBoxGlowLight.position.z = 0.16;
woodlandInnerPackage.add(innerBoxGlowLight);

const SUMMON_RAY_COUNT = 44;
const summonRaySeeds = Array.from({ length: SUMMON_RAY_COUNT }, (_, index) => ({
  angle: index / SUMMON_RAY_COUNT * Math.PI * 2 + (Math.random() - 0.5) * 0.1,
  length: 0.68 + Math.random() * 0.75,
  delay: Math.random() * 0.24,
}));
const summonRayPositions = new Float32Array(SUMMON_RAY_COUNT * 6);
const summonRayGeometry = new THREE.BufferGeometry();
summonRayGeometry.setAttribute("position", new THREE.BufferAttribute(summonRayPositions, 3));
const summonRayMaterial = new THREE.LineBasicMaterial({
  color: 0xf5d58b,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
});
const summonRays = new THREE.LineSegments(summonRayGeometry, summonRayMaterial);
summonRays.position.z = 0.075;
summonRays.renderOrder = 9;
woodlandInnerPackage.add(summonRays);

const guidebookMaterials = [
  neutralPaper,
  neutralPaper,
  neutralPaper,
  neutralPaper,
  createMaterial({ map: textures["woodland:guidebook-front.png"], roughness: 0.88, transparent: true, alphaTest: 0.08 }),
  createMaterial({ map: textures["woodland:guidebook-back.png"], roughness: 0.88, transparent: true, alphaTest: 0.08 }),
];
const GUIDE_WIDTH = WOODLAND_WIDTH * 0.95;
const GUIDE_HEIGHT = WOODLAND_HEIGHT * 0.91;
const woodlandGuidebook = new THREE.Mesh(new THREE.BoxGeometry(GUIDE_WIDTH, GUIDE_HEIGHT, 0.036), guidebookMaterials);
woodlandGuidebook.position.set(0, -0.015, 0.028);
// The photographed guidebook face was previously laid 90° counter-clockwise.
// Keep it rotated 90° to the right (clockwise) from that state so the cover is
// upright both in the tray and after extraction.
woodlandGuidebook.rotation.z = 0;
woodlandGuidebook.castShadow = true;
woodlandGuidebook.receiveShadow = true;
woodlandGuidebook.userData.interaction = "guidebook";
woodlandTray.add(woodlandGuidebook);

const woodlandDisplayMaterialState = new Map();
woodlandRoot.traverse((object) => {
  if (!object.isMesh) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  materials.forEach((material) => {
    if (!material?.color || woodlandDisplayMaterialState.has(material)) return;
    woodlandDisplayMaterialState.set(material, material.color.clone());
  });
});

const bookTextureBindings = [
  [diamondLining, "outer-inside.jpg"],
  [woodlandBaseMaterials[0], "outer-right.jpg"],
  [woodlandBaseMaterials[1], "outer-left.jpg"],
  [woodlandBaseMaterials[2], "outer-top.jpg"],
  [woodlandBaseMaterials[3], "outer-bottom.jpg"],
  [woodlandBaseMaterials[5], "outer-back.jpg"],
  [woodlandCoverMaterials[4], "outer-front.jpg"],
  [woodlandInnerMaterials[0], "inner-right.jpg"],
  [woodlandInnerMaterials[1], "inner-left.jpg"],
  [woodlandInnerMaterials[2], "inner-top.jpg"],
  [woodlandInnerMaterials[3], "inner-bottom.jpg"],
  [woodlandInnerMaterials[4], "inner-front-upright.jpg"],
  [woodlandInnerMaterials[5], "inner-back-upright.jpg"],
  [guidebookMaterials[4], "guidebook-front.png"],
  [guidebookMaterials[5], "guidebook-back.png"],
];

function applyBookDeckAppearance(deckKey) {
  if (!isBookDeck(deckKey)) return;
  for (const [material, file] of bookTextureBindings) {
    const texture = textures[`${deckKey}:${file}`];
    if (!texture) continue;
    material.map = texture;
    material.needsUpdate = true;
  }
  const deck = DECKS[deckKey];
  const directCardStack = isDirectCardStackDeck(deckKey);
  const packageFaceTexture = directCardStack && deck.packageFaceTexture
    ? textures[`${deckKey}:${deck.packageFaceTexture}`]
    : null;
  [
    [woodlandInnerMaterials[4], "inner-front-upright.jpg"],
    [woodlandInnerMaterials[5], "inner-back-upright.jpg"],
  ].forEach(([material, fallbackFile]) => {
    material.map = packageFaceTexture ?? textures[`${deckKey}:${fallbackFile}`] ?? null;
    material.transparent = directCardStack;
    material.alphaTest = directCardStack ? 0.08 : 0;
    material.needsUpdate = true;
  });
  const isRedVisions = deckKey === "redvisions";
  const fallbackEdgeColor = isRedVisions ? 0x5b1719 : 0x335853;
  const fallbackPaperColor = isRedVisions ? 0x6e2224 : 0xa87c40;
  const edgeColor = new THREE.Color(deck.edgeColor ?? fallbackEdgeColor);
  const paperColor = new THREE.Color(deck.paperColor ?? fallbackPaperColor);
  greenEdge.color.copy(edgeColor);
  goldPaper.color.copy(paperColor);
  woodlandDisplayMaterialState.set(greenEdge, edgeColor.clone());
  woodlandDisplayMaterialState.set(goldPaper, paperColor.clone());
  woodlandRoot.name = deck.header;
}


// First collection rebuilt into the same dark inspection stage and effects.
const unveiledRoot = new THREE.Group();
unveiledRoot.name = "The Unveiled Tarot";
unveiledRoot.visible = false;
scene.add(unveiledRoot);

const UNVEILED_WIDTH = 1;
const UNVEILED_HEIGHT = 1.54;
const UNVEILED_DEPTH = 0.54;
const unveiledMaterials = [
  createMaterial({ map: textures["unveiled:right.jpg"] }),
  createMaterial({ map: textures["unveiled:left.jpg"] }),
  createMaterial({ map: textures["unveiled:top.jpg"] }),
  neutralPaper,
  createMaterial({ map: textures["unveiled:front.jpg"] }),
  createMaterial({ map: textures["unveiled:back.jpg"] }),
];
const unveiledSleeve = new THREE.Mesh(new THREE.BoxGeometry(UNVEILED_WIDTH, UNVEILED_HEIGHT, UNVEILED_DEPTH), unveiledMaterials);
unveiledSleeve.castShadow = true;
unveiledSleeve.receiveShadow = true;
unveiledRoot.add(unveiledSleeve);

const unveiledDrawer = new THREE.Group();
unveiledRoot.add(unveiledDrawer);
const drawerMaterials = [neutralPaper, neutralPaper, neutralPaper, neutralPaper, createMaterial({ map: textures["unveiled:drawer.jpg"] }), darkPaper];
const drawerMesh = new THREE.Mesh(new THREE.BoxGeometry(0.92, 1.43, 0.48), drawerMaterials);
drawerMesh.castShadow = true;
unveiledDrawer.add(drawerMesh);

function applyUnveiledDeckAppearance() {
  ["right.jpg", "left.jpg", "top.jpg", null, "front.jpg", "back.jpg"].forEach((file, index) => {
    if (!file) return;
    unveiledMaterials[index].map = textures[`unveiled:${file}`];
    unveiledMaterials[index].needsUpdate = true;
  });
  drawerMaterials[4].map = textures["unveiled:drawer.jpg"];
  drawerMaterials[4].needsUpdate = true;
}

for (let index = 0; index < 8; index += 1) {
  const layer = new THREE.Mesh(new THREE.BoxGeometry(0.79, 1.15, 0.006), index % 2 ? neutralPaper : darkPaper);
  layer.position.set(0, -0.04 + index * 0.006, UNVEILED_DEPTH / 2 - 0.018 + index * 0.006);
  layer.castShadow = true;
  unveiledDrawer.add(layer);
}
unveiledRoot.traverse((object) => {
  if (!object.isMesh) return;
  const materials = Array.isArray(object.material) ? object.material : [object.material];
  materials.forEach((material) => {
    if (!material?.color || woodlandDisplayMaterialState.has(material)) return;
    woodlandDisplayMaterialState.set(material, material.color.clone());
  });
});


function roundedShape(width, height, radius) {
  const shape = new THREE.Shape();
  const x = -width / 2;
  const y = -height / 2;
  shape.moveTo(x + radius, y);
  shape.lineTo(x + width - radius, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + radius);
  shape.lineTo(x + width, y + height - radius);
  shape.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  shape.lineTo(x + radius, y + height);
  shape.quadraticCurveTo(x, y + height, x, y + height - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  return shape;
}


function normalizedShapeGeometry(shape, width, height) {
  const geometry = new THREE.ShapeGeometry(shape, 8);
  const positions = geometry.attributes.position;
  const uvs = geometry.attributes.uv;
  for (let index = 0; index < positions.count; index += 1) {
    uvs.setXY(index, positions.getX(index) / width + 0.5, positions.getY(index) / height + 0.5);
  }
  uvs.needsUpdate = true;
  return geometry;
}


function createCardSurfaceMaterial(map, roughness = 0.5) {
  const material = new THREE.MeshPhysicalMaterial({
    map,
    roughness,
    metalness: 0,
    transparent: true,
    alphaTest: 0.08,
    bumpMap: paperBumpTexture,
    bumpScale: 0.0026,
    clearcoat: 0.34,
    clearcoatRoughness: 0.52,
    sheen: 0.18,
    sheenRoughness: 0.72,
    sheenColor: new THREE.Color(0xffedc9),
    specularIntensity: 0.62,
    specularColor: new THREE.Color(0xfff2d4),
  });
  managedMaterials.push(material);
  return material;
}


function createCardReflectionMaterial(index) {
  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uSweep: { value: index * 0.17 },
      uOpacity: { value: 0 },
    },
    vertexShader: `
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDirection;
      void main() {
        vUv = uv;
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormalView = normalize(normalMatrix * normal);
        vViewDirection = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform float uSweep;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormalView;
      varying vec3 vViewDirection;
      void main() {
        float diagonal = vUv.x * 0.78 + vUv.y * 0.34;
        float distanceToSweep = abs(diagonal - uSweep);
        float broadGlow = 1.0 - smoothstep(0.05, 0.22, distanceToSweep);
        float fineGlow = 1.0 - smoothstep(0.0, 0.045, distanceToSweep);
        float facing = clamp(dot(vNormalView, vViewDirection), 0.0, 1.0);
        float grazing = pow(1.0 - facing, 1.8);
        float paperVariation = 0.92 + sin((vUv.x * 143.0 + vUv.y * 97.0)) * 0.08;
        vec3 reflectedLight = mix(vec3(0.50, 0.72, 0.67), vec3(1.0, 0.82, 0.50), vUv.y);
        float alpha = (broadGlow * 0.105 + fineGlow * 0.09 + grazing * 0.055) * paperVariation * uOpacity;
        gl_FragColor = vec4(reflectedLight, alpha);
      }
    `,
  });
  managedMaterials.push(material);
  return material;
}


function createRoundedCard(faceTexture, backTexture, index) {
  const width = 0.61;
  const height = 1.01;
  const thickness = 0.0085; // approximately 1 mm against a 120 mm physical card height
  const radius = 0.038;
  const shape = roundedShape(width, height, radius);
  const group = new THREE.Group();
  group.userData.cardIndex = index;

  const edgeGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: thickness,
    steps: 1,
    curveSegments: 8,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.0012,
    bevelThickness: 0.0012,
  });
  edgeGeometry.translate(0, 0, -thickness / 2);
  const edge = new THREE.Mesh(edgeGeometry, cardEdgeMaterial);
  edge.castShadow = true;
  edge.receiveShadow = true;
  group.add(edge);

  const planeGeometry = normalizedShapeGeometry(shape, width, height);
  const faceMaterial = createCardSurfaceMaterial(faceTexture, 0.48);
  const backMaterial = createCardSurfaceMaterial(backTexture, 0.54);
  const front = new THREE.Mesh(planeGeometry, faceMaterial);
  front.position.z = thickness / 2 + 0.0013;
  front.castShadow = true;
  group.add(front);
  const back = new THREE.Mesh(planeGeometry.clone(), backMaterial);
  back.rotation.y = Math.PI;
  back.position.z = -thickness / 2 - 0.0013;
  back.castShadow = true;
  group.add(back);

  const frontReflectionMaterial = createCardReflectionMaterial(index);
  const frontReflection = new THREE.Mesh(planeGeometry.clone(), frontReflectionMaterial);
  group.userData.frontSurface = front;
  group.userData.frontReflection = frontReflection;
  frontReflection.position.z = thickness / 2 + 0.0025;
  frontReflection.renderOrder = 4;
  group.add(frontReflection);

  const backReflectionMaterial = createCardReflectionMaterial(index + 2.75);
  const backReflection = new THREE.Mesh(planeGeometry.clone(), backReflectionMaterial);
  backReflection.rotation.y = Math.PI;
  backReflection.position.z = -thickness / 2 - 0.0025;
  backReflection.renderOrder = 4;
  group.add(backReflection);
  group.userData.frontMaterial = faceMaterial;
  group.userData.reflectionMaterials = [frontReflectionMaterial, backReflectionMaterial];
  return group;
}


const cardsGroup = new THREE.Group();
cardsGroup.name = "Rounded 1 mm floating cards";
cardsGroup.visible = false;
scene.add(cardsGroup);
let cardMeshes = [];
const cardTexturePool = new Map();
const cardTexturePromises = new Map();
let cardTextureUseClock = 0;
let cardTextureGeneration = 0;

function isCardTextureReady(index) {
  return cardTexturePool.has(index);
}

function assignCardFaceTexture(index, texture) {
  const material = cardMeshes[index]?.userData.frontMaterial;
  const entry = readingEntries().find((item) => item.index === index);
  const concealed = (drawRitual?.isOpen && drawRitual.visual.phase !== "setup") || (readingResult && !entry?.revealed);
  if (concealed) texture = textures[`${cardCatalogDeckKey}:${DECKS[cardCatalogDeckKey]?.cardBack}`];
  if (!material || !texture) return;
  material.map = texture;
  material.needsUpdate = true;
}

function protectedCardTextureIndices(centerIndex) {
  const protectedIndices = new Set();
  if (!CARDS.length) return protectedIndices;
  // Keep a revealed result available while preparing a new draw, including cancellation.
  readingEntries().forEach((entry) => protectedIndices.add(entry.index));
  readingEntries(drawRestoreState?.result ?? null).forEach((entry) => protectedIndices.add(entry.index));
  if (drawRitual?.isOpen && drawRitual.session) {
    const session = drawRitual.session;
    [...session.draws, ...(session.cut ? [session.cut] : [])].forEach((entry) => protectedIndices.add(entry.index));
  }
  for (let offset = -2; offset <= 2; offset += 1) {
    protectedIndices.add((centerIndex + offset + CARDS.length) % CARDS.length);
  }
  return protectedIndices;
}

function trimCardTexturePool(centerIndex = selectedCard) {
  const protectedIndices = protectedCardTextureIndices(centerIndex);
  const limit = Math.max(CARD_TEXTURE_POOL_LIMIT, protectedIndices.size);
  while (cardTexturePool.size > limit) {
    const candidate = [...cardTexturePool.entries()]
      .filter(([index]) => !protectedIndices.has(index))
      .sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    if (!candidate) break;
    const [index, entry] = candidate;
    cardTexturePool.delete(index);
    assignCardFaceTexture(index, textures[`${cardCatalogDeckKey}:${DECKS[cardCatalogDeckKey]?.cardBack}`]);
    entry.texture.dispose();
  }
  inspection.dataset.texturePool = `${cardTexturePool.size}/${limit}`;
}

async function ensureCardTexture(index) {
  if (!CARDS.length || index < 0 || index >= CARDS.length) return null;
  const cached = cardTexturePool.get(index);
  if (cached) {
    cached.lastUsed = ++cardTextureUseClock;
    assignCardFaceTexture(index, cached.texture);
    return cached.texture;
  }
  if (cardTexturePromises.has(index)) return cardTexturePromises.get(index);
  const deckKeyAtRequest = cardCatalogDeckKey;
  const generationAtRequest = cardTextureGeneration;
  const request = loadColorTexture(CARDS[index].src)
    .then((texture) => {
      if (deckKeyAtRequest !== cardCatalogDeckKey || generationAtRequest !== cardTextureGeneration) {
        texture.dispose();
        return null;
      }
      cardTexturePool.set(index, { texture, lastUsed: ++cardTextureUseClock });
      assignCardFaceTexture(index, texture);
      trimCardTexturePool(index);
      return texture;
    })
    .catch((error) => {
      console.warn(`[arcana] unable to prepare card texture ${index}`, error);
      return null;
    })
    .finally(() => {
      if (cardTexturePromises.get(index) === request) cardTexturePromises.delete(index);
    });
  cardTexturePromises.set(index, request);
  return request;
}

function requestCardTextureWindow(centerIndex) {
  if (!CARDS.length) return;
  void ensureCardTexture(centerIndex);
  const neighbours = [-1, 1, -2, 2].map((offset) => (centerIndex + offset + CARDS.length) % CARDS.length);
  void Promise.allSettled(neighbours.map((index) => ensureCardTexture(index))).then(() => trimCardTexturePool(centerIndex));
}

function clearCardTexturePool() {
  cardTextureGeneration += 1;
  cardTexturePool.forEach((entry) => entry.texture.dispose());
  cardTexturePool.clear();
  cardTexturePromises.clear();
  inspection.dataset.texturePool = `0/${CARD_TEXTURE_POOL_LIMIT}`;
}

function disposeCardMeshes() {
  cardsGroup.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : object.material ? [object.material] : [];
    materials.forEach((material) => {
      if (material !== cardEdgeMaterial) material.dispose?.();
    });
  });
  cardsGroup.clear();
  cardMeshes = [];
}

function resizeReturnBeamBuffer(cardCount) {
  returnBeamPositions = new Float32Array(cardCount * 6);
  returnBeamGeometry.setAttribute("position", new THREE.BufferAttribute(returnBeamPositions, 3));
}

function initializeCardMeshes(deckKey) {
  clearCardTexturePool();
  disposeCardMeshes();
  const deck = DECKS[deckKey];
  const backTexture = textures[`${deckKey}:${deck.cardBack}`];
  if (!ringSelection) {
    ringSelection = createRingSelection({ THREE, capacity: Math.max(80, CARDS.length) });
    scene.add(ringSelection.group);
  }
  ringSelection.setTexture(backTexture);
  ringSelection.group.visible = false;
  cardMeshes = CARDS.map((card, index) => {
    const group = createRoundedCard(backTexture, backTexture, index);
    group.position.set(0, 0, 0.35 + index * 0.01);
    cardsGroup.add(group);
    return group;
  });
  resizeReturnBeamBuffer(CARDS.length);
  cardWebGLAssetsReady = cardMeshes.length === CARDS.length && cardMeshes.length > 0;
  updateCardAssetReadiness();
}

async function ensureDeckCardExperience(deckKey) {
  if (!DECKS[deckKey]?.hasCards) return [];
  if (cardCatalogDeckKey === deckKey && cardWebGLAssetsReady) return CARDS;
  if (!cardCatalogLoads.has(deckKey)) {
    const request = loadCardCatalog(deckKey).catch((error) => {
      if (cardCatalogLoads.get(deckKey) === request) cardCatalogLoads.delete(deckKey);
      throw error;
    });
    cardCatalogLoads.set(deckKey, request);
  }
  try {
    const catalog = await cardCatalogLoads.get(deckKey);
    if (activeDeckKey !== deckKey || !inspectionVisible) return [];
    if (!catalog.length) throw new Error(`No cards available for ${deckKey}`);
    if (cardCatalogDeckKey === deckKey && cardWebGLAssetsReady) return CARDS;
    CARDS = catalog;
    selectedCard = Math.min(selectedCard, CARDS.length - 1);
    cardCatalogDeckKey = deckKey;
    buildCardRail();
    initializeCardMeshes(deckKey);
    inspection.dataset.cardManifest = deckKey;
    return CARDS;
  } catch (error) {
    console.error("[arcana] unable to initialize deck cards", error);
    if (activeDeckKey === deckKey && inspectionVisible) {
      showBoxFeedback("牌組清單載入失敗，可重新開始抽牌再試", "muted", 3200);
      if (activeMode === "browse") browseCardGrid.innerHTML = '<p class="browse-loading">牌組暫時無法載入，請回到牌盒重試。</p>';
    }
    return [];
  }
}

let returnBeamPositions = new Float32Array(0);
const returnBeamGeometry = new THREE.BufferGeometry();
returnBeamGeometry.setAttribute("position", new THREE.BufferAttribute(returnBeamPositions, 3));
returnBeamMaterial = new THREE.LineBasicMaterial({
  color: 0xf6d58d,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthTest: false,
  depthWrite: false,
});
returnBeams = new THREE.LineSegments(returnBeamGeometry, returnBeamMaterial);
returnBeams.visible = false;
returnBeams.renderOrder = 18;
scene.add(returnBeams);
const returnBeamCenter = new THREE.Vector3(0, 0.08, 0.54);

function createFocusMaskTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(256, 256, 72, 256, 256, 256);
  gradient.addColorStop(0, "rgba(3, 8, 7, 0)");
  gradient.addColorStop(0.34, "rgba(3, 8, 7, 0.08)");
  gradient.addColorStop(0.7, "rgba(3, 8, 7, 0.72)");
  gradient.addColorStop(1, "rgba(3, 8, 7, 0.96)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  return new THREE.CanvasTexture(canvas);
}

const cardFocusMaskMaterial = new THREE.SpriteMaterial({
  map: createFocusMaskTexture(),
  transparent: true,
  opacity: 0,
  depthWrite: false,
});
const cardFocusMask = new THREE.Sprite(cardFocusMaskMaterial);
cardFocusMask.scale.set(6.8, 6.8, 1);
cardFocusMask.renderOrder = 1;
scene.add(cardFocusMask);

function createFocusShaftTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "rgba(255, 248, 218, 0)");
  gradient.addColorStop(0.12, "rgba(255, 248, 218, 0.05)");
  gradient.addColorStop(0.68, "rgba(255, 242, 194, 0.24)");
  gradient.addColorStop(0.9, "rgba(255, 238, 181, 0.32)");
  gradient.addColorStop(1, "rgba(255, 238, 181, 0)");

  context.save();
  context.filter = "blur(24px)";
  context.fillStyle = gradient;
  context.beginPath();
  context.moveTo(222, -20);
  context.lineTo(290, -20);
  context.lineTo(480, canvas.height + 20);
  context.lineTo(32, canvas.height + 20);
  context.closePath();
  context.fill();
  context.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const cardFocusShaftMaterial = new THREE.SpriteMaterial({
  map: createFocusShaftTexture(),
  color: 0xffedbb,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthTest: true,
  depthWrite: false,
});
const cardFocusShaft = new THREE.Sprite(cardFocusShaftMaterial);
cardFocusShaft.scale.set(2.55, 5.25, 1);
cardFocusShaft.renderOrder = 2;
scene.add(cardFocusShaft);
const selectedCardWorldPosition = new THREE.Vector3();
const selectedCardWorldQuaternion = new THREE.Quaternion();
const selectedCardFrontNormal = new THREE.Vector3();
const selectedCardToCamera = new THREE.Vector3();

const plinth = new THREE.Mesh(
  new THREE.CircleGeometry(1.65, 96),
  new THREE.MeshStandardMaterial({ color: 0x0d1512, roughness: 0.98, transparent: true, opacity: 0.78 })
);
plinth.rotation.x = -Math.PI / 2;
plinth.position.y = -1.05;
plinth.receiveShadow = true;
scene.add(plinth);

const castingGroup = new THREE.Group();
scene.add(castingGroup);
const castingLines = [];
for (let lineIndex = 0; lineIndex < 3; lineIndex += 1) {
  const offset = (lineIndex - 1) * 0.12;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-2.8, -1.15 + offset, 0.7),
    new THREE.Vector3(-1.5, -0.25 - offset, 0.9),
    new THREE.Vector3(-0.45, 0.7 + offset, 1.0),
    new THREE.Vector3(0, 0.05, 1.25),
  ]);
  const points = curve.getPoints(70);
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  geometry.setDrawRange(0, 0);
  const material = new THREE.LineBasicMaterial({
    color: lineIndex === 1 ? 0x77b7a5 : 0xd9b566,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const line = new THREE.Line(geometry, material);
  castingGroup.add(line);
  castingLines.push({ line, material, count: points.length });
}

const pulseGeometry = new THREE.TorusGeometry(0.75, 0.007, 8, 96);
const pulseRings = Array.from({ length: 3 }, (_, index) => {
  const material = new THREE.MeshBasicMaterial({ color: index === 1 ? 0x6da897 : 0xd7b16a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
  const ring = new THREE.Mesh(pulseGeometry, material);
  ring.position.z = 0.55;
  ring.scale.setScalar(0.15);
  scene.add(ring);
  return { ring, material, delay: index * 0.15 };
});

const particleCount = 260;
const particlePositions = new Float32Array(particleCount * 3);
const particleSeeds = [];
for (let index = 0; index < particleCount; index += 1) {
  const radius = 1.1 + Math.random() * 2.7;
  const theta = Math.random() * Math.PI * 2;
  particlePositions[index * 3] = Math.cos(theta) * radius;
  particlePositions[index * 3 + 1] = -1.4 + Math.random() * 3.2;
  particlePositions[index * 3 + 2] = Math.sin(theta) * radius * 0.55;
  particleSeeds.push({ speed: 0.05 + Math.random() * 0.11, phase: Math.random() * Math.PI * 2 });
}
const particleGeometry = new THREE.BufferGeometry();
particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
const particleMaterial = new THREE.PointsMaterial({ color: 0xd3aa62, size: 0.018, transparent: true, opacity: 0.46, blending: THREE.AdditiveBlending, depthWrite: false });
const particles = new THREE.Points(particleGeometry, particleMaterial);
scene.add(particles);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setPointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function findInteraction(object, root) {
  let current = object;
  while (current && current !== root) {
    if (current.userData.interaction) return current.userData.interaction;
    current = current.parent;
  }
  return null;
}

function findInteractiveHit(root, preferredInteraction = null) {
  const hits = raycaster.intersectObject(root, true);
  let firstInteractive = null;
  for (const hit of hits) {
    const interaction = findInteraction(hit.object, root);
    if (!interaction) continue;
    const interactive = { hit, interaction };
    if (interaction === preferredInteraction) return interactive;
    if (!firstInteractive) firstInteractive = interactive;
  }
  return firstInteractive;
}

function beginGuidebookExtraction() {
  pendingGuidebookExtraction = false;
  guidebookExtractedTarget = 1;
  woodlandPhase = WOODLAND_PHASE.GUIDE_EXTRACTED;
  inspection.dataset.woodlandPhase = woodlandPhase;
  playCardSlide(1);
  triggerMysticEffect(0.25);
  showBoxFeedback("已選取說明書：正在取出");
}

function handleGuidebookClick() {
  if (woodlandOpenTarget < 0.5) {
    pendingGuidebookExtraction = true;
    setBoxOpen(1, { sound: true });
    showBoxFeedback("已接收取書指令：外盒重新開啟後會自動取出說明書", "waiting", 2600);
    return;
  }
  if (woodlandOpenCurrent < 0.68) {
    pendingGuidebookExtraction = true;
    showBoxFeedback("已接收取書指令：外盒開啟後會自動取出說明書", "waiting", 2200);
    return;
  }
  if (guidebookExtractedTarget < 0.5) {
    beginGuidebookExtraction();
    return;
  }
  if (guidebookExtractedCurrent <= 0.86) {
    showBoxFeedback("說明書正在移出，請稍候", "waiting");
    return;
  }
  guidebookFlippedTarget = guidebookFlippedTarget > 0.5 ? 0 : 1;
  playCardFlip(guidebookFlippedTarget > 0.5 ? 1 : -1);
  triggerMysticEffect(0.14);
  showBoxFeedback(guidebookFlippedTarget > 0.5 ? "說明書已翻至背面" : "說明書已翻回正面");
}

function handleInnerBoxClick() {
  const label = packageLabel();
  if (guidebookExtractedTarget < 0.5 || guidebookExtractedCurrent < 0.86) {
    showBoxFeedback("請先點擊說明書並等待它完全取出", "waiting");
    return;
  }
  if (innerBoxExtractedTarget < 0.5) {
    innerBoxExtractedTarget = 1;
    innerBoxGlowTarget = 1;
    woodlandPhase = WOODLAND_PHASE.INNER_FLOATING;
    inspection.dataset.woodlandPhase = woodlandPhase;
    playBoxSound(true, activeDeckKey);
    triggerMysticEffect(0.36);
    showBoxFeedback(`已選取${label}：正在浮出`);
    return;
  }
  if (woodlandPhase === WOODLAND_PHASE.INNER_READY) {
    const expectedCardCount = CARDS.length || DECKS[activeDeckKey]?.availableCardCount;
    showBoxFeedback(
      expectedCardCount
        ? `已選取${label}：正在展開 ${expectedCardCount} 張牌面`
        : `已選取${label}：正在展開完整牌組`,
    );
    beginCardSummoning();
    return;
  }
  showBoxFeedback(`${label}正在移動，請稍候`, "waiting");
}

function beginCardSummoning({ fromRitual = false } = {}) {
  if (
    woodlandPhase !== WOODLAND_PHASE.INNER_READY ||
    innerBoxExtractedCurrent < 0.92 ||
    cardSummonStartedAt > 0
  ) return;
  if (!fromRitual) { drawRitual?.open(); return; }
  woodlandPhase = WOODLAND_PHASE.SUMMONING;
  cardSummonStartedAt = performance.now();
  cardSummonProgress = 0;
  pendingSummonCardIndex = null;
  cardSummonAssetsReady = false;
  innerBoxGlowTarget = 1.35;
  cardsModeTab.disabled = true;
  cardsModeTab.title = "正在凝聚牌面…";
  inspection.classList.remove("is-inner-box-ready");
  inspection.classList.add("is-card-summoning");
  inspection.setAttribute("aria-busy", "true");
  inspection.dataset.woodlandPhase = woodlandPhase;
  playInvocationSound();
  triggerMysticEffect(0.48);
  showBoxFeedback("牌組正沿光線聚攏，在心裡留住你的問題", "waiting", 0);
  void prepareCardSummoningAssets();
}

async function prepareCardSummoningAssets() {
  const deckKey = activeDeckKey;
  const startedAt = cardSummonStartedAt;
  const cards = await ensureDeckCardExperience(deckKey);
  if (activeDeckKey !== deckKey || cardSummonStartedAt !== startedAt || woodlandPhase !== WOODLAND_PHASE.SUMMONING || !cards.length) return;
  // Only backs are needed for the ritual. A face is loaded after a choice locks.
  pendingSummonCardIndex = null;
  cardSummonAssetsReady = true;
  updateCardAssetReadiness();
}

function completeCardSummoning() {
  if (woodlandPhase !== WOODLAND_PHASE.SUMMONING) return;
  cardSummonStartedAt = 0;
  cardSummonProgress = 1;
  cardRevealComplete = true;
  cardsModeTab.disabled = false;
  cardsModeTab.title = `檢視完整 ${CARDS.length} 張牌面`;
  inspection.classList.remove("is-card-summoning");
  inspection.removeAttribute("aria-busy");
  selectCard(0, false);
  showBoxFeedback("牌組已就緒，請選一張牌", "active", 2100);
  setMode("cards", false);
  inspection.dataset.woodlandPhase = WOODLAND_PHASE.CARDS;
  drawRitual?.animationComplete();
  playCardSlide(1);
  triggerMysticEffect(0.72);
}


function beginCardRedraw(fromRitual = false) {
  if (activeMode !== "cards" || !cardRevealComplete || isCardTransitionActive()) return;
  if (fromRitual !== true) { drawRitual?.open(); return; }
  setCardCatalogOpen(false);
  cardRedrawStartedAt = performance.now();
  cardRedrawProgress = 0;
  selectedFlipped = true;
  inspection.dataset.cardFace = "back";
  inspection.dataset.cardTransition = "redraw";
  inspection.classList.add("is-card-redrawing");
  inspection.setAttribute("aria-busy", "true");
  cardIndex.textContent = "星光聚攏中";
  cardName.textContent = "正在整理這一輪的牌";
  setCardInteractionLocked(true);
  playInvocationSound();
  triggerMysticEffect(0.36);
}


function finishCardRedraw() {
  if (cardRedrawStartedAt <= 0) return;
  cardRedrawStartedAt = 0;
  cardRedrawProgress = 0;
  inspection.classList.remove("is-card-redrawing");
  delete inspection.dataset.cardTransition;
  inspection.removeAttribute("aria-busy");
  selectCard(selectedCard, false);
  setCardInteractionLocked(false);
  drawRitual?.animationComplete();
  playCardSlide(1);
  triggerMysticEffect(0.58);
}


function setDeckReturnStage(stage, now) {
  deckReturnStage = stage;
  deckReturnStageStartedAt = now;
  inspection.dataset.returnStage = stage;
}


function beginDeckReturn() {
  if (activeMode !== "cards" || !cardRevealComplete || isCardTransitionActive()) return;
  if (drawRitual?.isOpen) return;
  readingResult = null;
  updateReadingResult();
  const now = performance.now();
  setCardCatalogOpen(false);
  deckReturnStartedAt = now;
  deckReturnProgress = 0;
  returnCardOrigins = cardMeshes.map((card) => ({
    position: card.position.clone(),
    scale: card.scale.clone(),
    rotation: card.rotation.clone(),
    visible: card.visible,
  }));
  setDeckReturnStage("cards-to-light", now);
  woodlandPhase = WOODLAND_PHASE.RETURNING;
  inspection.dataset.woodlandPhase = woodlandPhase;
  inspection.dataset.cardTransition = "return";
  inspection.classList.add("is-deck-returning");
  inspection.setAttribute("aria-busy", "true");
  cardIndex.textContent = "收回牌盒";
  cardName.textContent = "牌卡正在化為光束";
  returnBeams.visible = true;
  setCardInteractionLocked(true);
  openButton.disabled = true;
  playInvocationSound();
  triggerMysticEffect(0.42);
}


function enterBoxModeDuringReturn(now) {
  cardsGroup.visible = false;
  returnBeams.visible = false;
  returnBeamMaterial.opacity = 0;
  activeMode = "box";
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === "box");
  });
  cardControls.setAttribute("aria-hidden", "true");
  boxControls.classList.remove("is-hidden");
  setViewMenuOpen(false);
  innerBoxExtractedTarget = 0;
  innerBoxGlowTarget = 0;
  artifactBrightnessTarget = 1;
  artifactTargetScale = 1;
  artifactTargetPosition.set(0, 0, 0);
  queueCamera([0.16, 0.1, 4.55], [0, 0, 0.25], 700);
  if (!isBookDeck(activeDeckKey)) {
    setBoxOpen(0, { sound: true });
    setDeckReturnStage("slipcase", now);
    showBoxFeedback("牌卡已聚攏，正在收回內抽屜", "waiting", 0);
    return;
  }
  setDeckReturnStage("inner-box", now);
  showBoxFeedback(`牌卡已聚攏，正在收回${packageLabel()}`, "waiting", 0);
}


function finishDeckReturn() {
  cardsGroup.visible = false;
  controls.enabled = true;
  cardRevealComplete = !isBookDeck(activeDeckKey) && DECKS[activeDeckKey].hasCards;
  artifactBrightnessTarget = 1;
  artifactTargetScale = 1;
  artifactTargetPosition.set(0, 0, 0);
  woodlandPhase = WOODLAND_PHASE.CLOSED;
  inspection.dataset.woodlandPhase = woodlandPhase;
  resetCardTransitionState();
  openButton.disabled = false;
  cardsModeTab.disabled = isBookDeck(activeDeckKey);
  cardsModeTab.title = isBookDeck(activeDeckKey)
    ? `依序單擊說明書與${packageLabel()}，再單擊抽牌`
    : `抽取完整 ${CARDS.length} 張牌組`;
  showBoxFeedback(
    isBookDeck(activeDeckKey)
      ? `牌卡、${packageLabel()}與說明書已歸位，磁吸書型盒已闔上`
      : "牌卡與內抽屜已收回牌盒",
    "active",
    3200
  );
  focusWhenVisible(() => inspectionVisible && activeMode === "box" && !drawRitual?.isOpen ? openButton : null, 1000);
}


function updateCardTransitions(now) {
  if (cardRedrawStartedAt > 0) {
    const elapsed = now - cardRedrawStartedAt;
    cardRedrawProgress = THREE.MathUtils.clamp(elapsed / CARD_REDRAW_DURATION_MS, 0, 1);
    const remaining = Math.max(1, Math.ceil((CARD_REDRAW_DURATION_MS - elapsed) / 1000));
    cardIndex.textContent = `重新抽牌 · ${remaining} 秒`;
    if (cardRedrawProgress >= 1) finishCardRedraw();
    return;
  }
  if (deckReturnStartedAt <= 0) return;

  if (deckReturnStage === "cards-to-light") {
    deckReturnProgress = THREE.MathUtils.clamp((now - deckReturnStageStartedAt) / CARD_RETURN_BEAM_DURATION_MS, 0, 1);
    if (deckReturnProgress >= 1) enterBoxModeDuringReturn(now);
    return;
  }
  if (deckReturnStage === "slipcase" && unveiledOpenCurrent <= 0.015) {
    finishDeckReturn();
    return;
  }
  if (deckReturnStage === "inner-box" && innerBoxExtractedCurrent <= 0.045) {
    guidebookFlippedTarget = 0;
    guidebookExtractedTarget = 0;
    setDeckReturnStage("guidebook", now);
    showBoxFeedback(`${packageLabel()}已歸位，正在放回說明書`, "waiting", 0);
    return;
  }
  if (deckReturnStage === "guidebook" && guidebookExtractedCurrent <= 0.045) {
    setDeckReturnStage("outer-cover", now);
    setBoxOpen(0, { sound: true });
    openButton.disabled = true;
    return;
  }
  if (deckReturnStage === "outer-cover" && woodlandOpenCurrent <= 0.015) finishDeckReturn();
}

function readingPickTargets(event) {
  const y = event.clientY - stage.getBoundingClientRect().top;
  const outside = isReadingScrollable() && (y < readingScreenLayout.top || y > readingScreenLayout.bottom);
  return cardMeshes.filter((card) => card.visible && (!outside || card.userData.cardIndex === readingResult.session.cut?.index));
}

renderer.domElement.addEventListener("click", (event) => {
  if (!inspectionVisible || drawRitual?.isOpen || activeMode !== "cards" || isCardTransitionActive()) return;
  setPointerFromEvent(event);
  const hit = raycaster.intersectObjects(readingPickTargets(event), true)[0];
  if (!hit) { showReadingOverview(); return; }
  let cardRoot = hit.object;
  while (cardRoot.parent !== cardsGroup && cardRoot.parent) cardRoot = cardRoot.parent;
  const index = cardRoot.userData.cardIndex;
  if (readingResult) {
    activateReadingCard(index);
  }
  else if (index === selectedCard) flipSelectedCard();
  else if (!readingResult) selectCard(index);
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!inspectionVisible || drawRitual?.isOpen || activeMode !== "box") return;
  setPointerFromEvent(event);
  const activeRoot = isBookDeck(activeDeckKey) ? woodlandRoot : unveiledRoot;
  const hasObject = raycaster.intersectObject(activeRoot, true).length > 0;
  renderer.domElement.style.cursor = hasObject ? "pointer" : "grab";
});

renderer.domElement.addEventListener("click", (event) => {
  if (!inspectionVisible || drawRitual?.isOpen || activeMode !== "box" || isCardTransitionActive()) return;
  setPointerFromEvent(event);
  const activeRoot = isBookDeck(activeDeckKey) ? woodlandRoot : unveiledRoot;

  if (activeDeckKey === "unveiled") {
    if (raycaster.intersectObject(activeRoot, true).length === 0) return;
    setBoxOpen(unveiledOpenTarget < 0.5 ? 1 : 0, { sound: true });
    triggerMysticEffect(0.2);
    return;
  }

  // During the retract-before-close interval the cover is still visibly open,
  // even though the logical target has already switched to closed. Preserve a
  // guidebook click made in that interval and complete it after reopening.
  if (woodlandOpenTarget < 0.5) {
    const retractingInteraction = woodlandOpenCurrent > 0.12 ? findInteractiveHit(woodlandRoot, "guidebook") : null;
    if (retractingInteraction?.interaction === "guidebook") {
      handleGuidebookClick();
      return;
    }
    if (raycaster.intersectObject(woodlandRoot, true).length === 0) return;
    setBoxOpen(1, { sound: true });
    triggerMysticEffect(0.2);
    return;
  }
  const preferredInteraction = guidebookExtractedTarget < 0.5 ? "guidebook" : null;
  const interactive = findInteractiveHit(woodlandRoot, preferredInteraction);
  if (interactive?.interaction === "guidebook") handleGuidebookClick();
  else if (interactive?.interaction === "inner-box") handleInnerBoxClick();
  else showBoxFeedback("已點到外盒；請點擊說明書或使用下方開闔按鈕", "muted");
});

const viewPositions = {
  front: [0.16, 0.1, 4.55],
  back: [-0.16, 0.1, -4.55],
  left: [-4.1, 0.08, 0.15],
  right: [4.1, 0.08, -0.15],
  top: [0.28, 4.2, 1.05],
  bottom: [-0.2, -4.1, 1.05],
};
const VIEW_LABELS = {
  front: "正面", back: "背面", left: "左側", right: "右側", top: "頂面", bottom: "底面",
};

function pickRitualPosition(event) {
  setPointerFromEvent(event);
  if (isRingSelecting()) {
    const preview = cardMeshes[drawRitual.session.order[ringFocusedPosition]];
    if (preview?.visible && raycaster.intersectObject(preview, true).length) return ringFocusedPosition;
    return ringSelection.pick(raycaster) ?? -1;
  }
  const hit = raycaster.intersectObjects(cardMeshes.filter((card) => card.visible), true)[0];
  if (!hit) return -1;
  let card = hit.object;
  while (card.parent !== cardsGroup && card.parent) card = card.parent;
  return card.userData.ritualPosition ?? -1;
}

function isRitualChoosing() {
  return drawRitual?.isOpen && ["cutting", "selecting"].includes(drawRitual.visual.phase);
}

function isRingSelecting() {
  return Boolean(drawRitual?.isOpen && drawRitual.visual.phase === "selecting" && ringSelection);
}

function confirmRingCard() {
  if (!isRingSelecting() || !availableDrawPositions(drawRitual.session).includes(ringFocusedPosition)) return;
  drawRitual.choose(ringFocusedPosition);
}

ringConfirm.addEventListener("click", confirmRingCard);

function isReadingScrollable() {
  return Boolean(readingResult && activeMode === "cards" && !drawRitual?.isOpen && !isCardTransitionActive() && readingScreenLayout?.scrollable);
}

readingScroll.addEventListener("scroll", () => {
  if (!readingScroll.hidden) readingScrollOffset = readingScroll.scrollTop;
});
function bindReadingScrollGestures(surface) {
  let suppressClick = false;
  surface.addEventListener("wheel", (event) => {
    if (!isReadingScrollable()) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? readingScreenLayout.viewportHeight : 1;
    readingScroll.scrollTop += (event.deltaY || event.deltaX) * unit;
  }, { passive: false });
  surface.addEventListener("pointerdown", (event) => {
    suppressClick = false;
    if (!isReadingScrollable() || event.button !== 0) return;
    readingPan = { id: event.pointerId, x: event.clientX, y: event.clientY, offset: readingScroll.scrollTop };
    // Preserve a name button as the click target when the gesture is only a tap.
    (event.target?.closest?.(".spread-card-label") ?? surface).setPointerCapture(event.pointerId);
  });
  surface.addEventListener("pointermove", (event) => {
    if (!isReadingScrollable() || readingPan?.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - readingPan.x, event.clientY - readingPan.y) > SCENE_TAP_MAX_MOVE_PX) suppressClick = true;
    readingScroll.scrollTop = readingPan.offset + readingPan.y - event.clientY;
    event.preventDefault();
  });
  for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
    surface.addEventListener(eventName, () => { readingPan = null; });
  }
  surface.addEventListener("click", (event) => {
    if (suppressClick && event.detail !== 0) { event.preventDefault(); event.stopImmediatePropagation(); }
    suppressClick = false;
  }, true);
}
bindReadingScrollGestures(renderer.domElement);
bindReadingScrollGestures(document.querySelector("#spread-result-labels"));

renderer.domElement.addEventListener("pointerdown", (event) => {
  if (!isRitualChoosing() || event.button !== 0) return;
  ritualPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, rotation: ringRotation, focus: drawRitual.visual.focus, moved: false };
  renderer.domElement.setPointerCapture(event.pointerId);
});
renderer.domElement.addEventListener("pointermove", (event) => {
  if (!isRitualChoosing()) return;
  if (ritualPointer?.id === event.pointerId) {
    const delta = event.clientX - ritualPointer.x;
    if (Math.hypot(delta, event.clientY - ritualPointer.y) > 7) ritualPointer.moved = true;
    if (ritualPointer.moved) {
      if (isRingSelecting()) ringRotation = ritualPointer.rotation + delta / stage.clientWidth * Math.PI * 2;
      else {
        const step = stage.clientWidth / (camera.aspect < 0.85 ? 5 : 10);
        drawRitual.focusChoice(ritualPointer.focus - delta / step, false);
      }
      ritualMotion.hover = -1;
      renderer.domElement.style.cursor = "grabbing";
      event.preventDefault();
    }
  } else {
    ritualMotion.hover = pickRitualPosition(event);
    renderer.domElement.style.cursor = ritualMotion.hover < 0 ? "grab" : "pointer";
  }
});
for (const eventName of ["pointerup", "pointercancel", "lostpointercapture"]) {
  renderer.domElement.addEventListener(eventName, () => { ritualPointer = null; });
}
renderer.domElement.addEventListener("pointerleave", () => { ritualMotion.hover = -1; });
renderer.domElement.addEventListener("click", (event) => {
  if (!isRitualChoosing()) return;
  const position = pickRitualPosition(event);
  if (position < 0) return;
  if (isRingSelecting()) {
    if (position === ringFocusedPosition) confirmRingCard();
    else drawRitual.focusChoice(position, false);
  } else drawRitual.choose(position);
});
renderer.domElement.addEventListener("wheel", (event) => {
  if (!isRitualChoosing()) return;
  event.preventDefault();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (delta) {
    if (isRingSelecting()) ringRotation += Math.sign(delta) * 0.12;
    else drawRitual.focusChoice(drawRitual.visual.focus + Math.sign(delta), false);
  }
}, { passive: false });
renderer.domElement.addEventListener("keydown", (event) => {
  if (!isRitualChoosing()) return;
  const focus = drawRitual.visual.focus;
  if (event.key === "ArrowLeft") drawRitual.focusChoice(focus - 1, false);
  else if (event.key === "ArrowRight") drawRitual.focusChoice(focus + 1, false);
  else if (event.key === "Home") drawRitual.focusChoice(0, false);
  else if (event.key === "End") drawRitual.focusChoice(drawRitual.session.order.length - 1, false);
  else if (event.key === "Enter" || event.key === " ") { if (!event.repeat) drawRitual.choose(focus); }
  else return;
  event.preventDefault();
});

function queueCamera(position, target = [0, 0, 0], duration = 760) {
  cameraTween = {
    start: performance.now(),
    duration,
    fromPosition: camera.position.clone(),
    toPosition: new THREE.Vector3(...position),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(...target),
  };
}


function activateView(name) {
  const position = viewPositions[name];
  if (!position) return;
  activeView = name;
  currentViewLabel.textContent = VIEW_LABELS[name] ?? name;
  document.querySelectorAll(".view-button").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === name);
  });
  const root = isBookDeck(activeDeckKey) ? woodlandRoot : unveiledRoot;
  root.rotation.y = 0;
  root.rotation.z = 0;
  queueCamera(position);
}


function updateCameraTween(now) {
  if (!cameraTween) return;
  const t = Math.min((now - cameraTween.start) / cameraTween.duration, 1);
  const eased = 1 - Math.pow(1 - t, 3);
  camera.position.lerpVectors(cameraTween.fromPosition, cameraTween.toPosition, eased);
  controls.target.lerpVectors(cameraTween.fromTarget, cameraTween.toTarget, eased);
  if (t >= 1) cameraTween = null;
}


function updateCards(dt, time) {
  if (!cardsGroup.visible) return;
  if (drawRitual?.isOpen && drawRitual.visual.phase !== "setup") {
    updateRitualCards(dt, time);
    return;
  }
  if (readingResult && !isCardTransitionActive()) {
    updateReadingCards(dt, time);
    return;
  }
  const returningCards = deckReturnStartedAt > 0 && deckReturnStage === "cards-to-light";
  const redrawing = cardRedrawStartedAt > 0;
  cardMeshes.forEach((card, index) => {
    const isSelected = index === selectedCard;
    if (returningCards) {
      const origin = returnCardOrigins[index];
      card.visible = origin.visible;
      const progress = deckReturnProgress * deckReturnProgress * (3 - 2 * deckReturnProgress);
      card.position.lerpVectors(origin.position, returnBeamCenter, progress);
      card.position.y += Math.sin(progress * Math.PI) * 1.08;
      const narrow = THREE.MathUtils.lerp(origin.scale.x, 0.022, THREE.MathUtils.smoothstep(progress, 0, 0.55));
      const vanish = 1 - THREE.MathUtils.smoothstep(progress, 0.7, 1);
      card.scale.set(narrow * vanish, THREE.MathUtils.lerp(origin.scale.y, 1.52, progress) * vanish, 0.028 * vanish);
      card.rotation.z = THREE.MathUtils.lerp(origin.rotation.z, 0, progress);
      card.rotation.y = Math.PI;
      const offset = index * 6;
      returnBeamPositions[offset] = card.position.x;
      returnBeamPositions[offset + 1] = card.position.y - (0.36 + (1 - progress) * 0.5);
      returnBeamPositions[offset + 2] = card.position.z;
      returnBeamPositions[offset + 3] = card.position.x;
      returnBeamPositions[offset + 4] = card.position.y + (0.82 + (1 - progress) * 0.72);
      returnBeamPositions[offset + 5] = card.position.z;
      if (!origin.visible) returnBeamPositions.fill(0, offset, offset + 6);
    } else if (redrawing && !deckCarouselReducedMotion.matches) {
      const angle = index / CARDS.length * Math.PI * 2 + cardRedrawProgress * Math.PI * 4;
      const radius = 1.22 + Math.sin(cardRedrawProgress * Math.PI) * 0.48;
      const targetX = Math.cos(angle) * radius;
      const targetY = Math.sin(angle) * radius * 0.54 + 0.08;
      const targetZ = 0.84 + Math.sin(angle * 2) * 0.1;
      const ringScale = 0.27 + Math.sin(cardRedrawProgress * Math.PI) * 0.08;
      card.position.x = THREE.MathUtils.damp(card.position.x, targetX, 8.5, dt);
      card.position.y = THREE.MathUtils.damp(card.position.y, targetY, 8.5, dt);
      card.position.z = THREE.MathUtils.damp(card.position.z, targetZ, 8.5, dt);
      card.scale.x = THREE.MathUtils.damp(card.scale.x, ringScale, 8.5, dt);
      card.scale.y = THREE.MathUtils.damp(card.scale.y, ringScale, 8.5, dt);
      card.scale.z = THREE.MathUtils.damp(card.scale.z, ringScale, 8.5, dt);
      card.rotation.z = THREE.MathUtils.damp(card.rotation.z, angle + Math.PI * 0.5, 9, dt);
      card.rotation.y = THREE.MathUtils.damp(card.rotation.y, Math.PI, 9, dt);
    } else {
      card.visible = true;
      card.userData.frontSurface.rotation.z = 0;
      card.userData.frontReflection.rotation.z = 0;
      const relative = index - selectedCard;
      const spreadX = isSelected ? 0 : THREE.MathUtils.clamp(relative, -3, 3) * 0.52;
      const spreadY = isSelected ? 0.1 : -0.38 - Math.abs(relative) * 0.055;
      const spreadZ = isSelected ? 1.46 : 0.5 - Math.abs(relative) * 0.07;
      const targetScale = isSelected ? 1.18 : 0.72;
      const floatY = isSelected ? Math.sin(time * 1.25) * 0.045 : Math.sin(time * 0.9 + index) * 0.018;
      card.position.x = THREE.MathUtils.damp(card.position.x, spreadX, 7.5, dt);
      card.position.y = THREE.MathUtils.damp(card.position.y, spreadY + floatY, 7.5, dt);
      card.position.z = THREE.MathUtils.damp(card.position.z, spreadZ, 7.5, dt);
      card.scale.x = THREE.MathUtils.damp(card.scale.x, targetScale, 7.5, dt);
      card.scale.y = THREE.MathUtils.damp(card.scale.y, targetScale, 7.5, dt);
      card.scale.z = THREE.MathUtils.damp(card.scale.z, targetScale, 7.5, dt);
      card.rotation.z = THREE.MathUtils.damp(card.rotation.z, isSelected ? 0 : relative * -0.075, 8, dt);
      const targetRotationY = isSelected && !selectedFlipped ? 0 : Math.PI;
      card.rotation.y = THREE.MathUtils.damp(card.rotation.y, targetRotationY, 8.5, dt);
    }
    card.userData.reflectionMaterials.forEach((material, surfaceIndex) => {
      const cycle = (time * 0.105 + index * 0.173 + surfaceIndex * 0.41) % 1.38;
      material.uniforms.uSweep.value = -0.16 + cycle;
      material.uniforms.uOpacity.value = THREE.MathUtils.damp(
        material.uniforms.uOpacity.value,
        returningCards ? 0 : redrawing ? 0.4 : isSelected ? 0.88 : 0.25,
        5.5,
        dt
      );
    });
  });
  if (returningCards) {
    returnBeamGeometry.attributes.position.needsUpdate = true;
    returnBeamMaterial.opacity = Math.sin(deckReturnProgress * Math.PI) * 0.92;
  }
}


function updateRitualCards(dt, time) {
  const state = drawRitual.visual;
  const session = drawRitual.session;
  if (state.phase === "selecting" && ringSelection) { updateRingSelecting(dt, time); return; }
  const spread = getDrawSpread(session.spreadId);
  ritualMotion.energy = THREE.MathUtils.damp(ritualMotion.energy, state.holding ? 1 : 0.05, 3.5, dt);
  ritualMotion.clock += dt * (0.12 + ritualMotion.energy * 1.55);
  ritualMotion.focus = THREE.MathUtils.damp(ritualMotion.focus, state.focus, 9, dt);
  Object.assign(ritualPoseOptions, {
    phase: state.phase === "cutting" ? "selecting" : state.phase, count: session.order.length, time: ritualMotion.clock,
    energy: ritualMotion.energy, progress: state.phase === "shuffling" ? state.progress : (performance.now() - state.phaseStartedAt) / 1150,
    focus: ritualMotion.focus, selectedPosition: state.selectedPosition, aspect: camera.aspect,
    reducedMotion: deckCarouselReducedMotion.matches,
  });
  for (const card of cardMeshes) {
    ritualPoseOptions.position = card.userData.ritualPosition;
    const pose = getRitualCardPose(ritualPoseOptions, ritualPose);
    const cut = session.cut?.index === card.userData.cardIndex;
    const slot = session.draws.findIndex((entry) => entry.index === card.userData.cardIndex);
    if (cut || (slot >= 0 && state.phase === "revealing")) {
      getReadingCardPose({ spread, slot: Math.max(0, slot), aspect: camera.aspect, cut }, pose);
    } else if (slot >= 0) {
      Object.assign(pose, { x: (slot - (session.drawCount - 1) / 2) * Math.min(0.14, camera.aspect * 0.22), y: -0.94, z: 1.05, rx: 0, ry: Math.PI, rz: 0, scale: 0.2, visible: true });
    }
    card.visible = pose.visible;
    if (!pose.visible) continue;
    const hovered = isRitualChoosing() && !cut && slot < 0 && card.userData.ritualPosition === ritualMotion.hover;
    const speed = deckCarouselReducedMotion.matches ? 1000 : 9;
    card.position.x = THREE.MathUtils.damp(card.position.x, pose.x, speed, dt);
    card.position.y = THREE.MathUtils.damp(card.position.y, pose.y + (hovered ? 0.13 : 0), speed, dt);
    card.position.z = THREE.MathUtils.damp(card.position.z, pose.z + (hovered ? 0.13 : 0), speed, dt);
    card.rotation.x = THREE.MathUtils.damp(card.rotation.x, pose.rx, speed, dt);
    card.rotation.y = THREE.MathUtils.damp(card.rotation.y, pose.ry, speed, dt);
    card.rotation.z = THREE.MathUtils.damp(card.rotation.z, pose.rz, speed, dt);
    card.scale.setScalar(THREE.MathUtils.damp(card.scale.x, pose.scale * (hovered ? 1.04 : 1), speed, dt));
    card.userData.reflectionMaterials.forEach((material) => {
      material.uniforms.uSweep.value = deckCarouselReducedMotion.matches ? 0.5 : (time * 0.28 + card.userData.ritualPosition * 0.09) % 1.38 - 0.16;
      material.uniforms.uOpacity.value = hovered ? 1.4 : 0.65 + ritualMotion.energy * 0.6;
    });
  }
}

function updateRingSelecting(dt, time) {
  const session = drawRitual.session;
  const available = availableDrawPositions(session);
  const bounds = stage.getBoundingClientRect();
  const header = document.querySelector(".draw-ritual-header").getBoundingClientRect();
  const count = document.querySelector("#draw-selection-count").getBoundingClientRect();
  const short = bounds.height < 500;
  const top = Math.max(short ? 65 : 100, header.bottom - bounds.top + 8);
  const bottom = Math.max(top + 50, Math.min(bounds.height - (short ? 112 : 165), count.top - bounds.top - (short ? 30 : 65)));
  ringFocusedPosition = available.includes(drawRitual.visual.focus) ? drawRitual.visual.focus : available[0] ?? -1;
  ringViewport = ringSelection.update({ positions: available, count: session.order.length,
    rotation: ringRotation, focusPosition: ringFocusedPosition,
    width: bounds.width, height: bounds.height, top, bottom, project: screenToReadingPlane });
  ringSelection.group.visible = true;
  const preview = ringViewport.preview;
  const hudBounds = document.querySelector("#draw-ritual").getBoundingClientRect();
  ringConfirm.hidden = ringFocusedPosition < 0;
  ringConfirm.style.left = `${bounds.left - hudBounds.left + preview.x}px`;
  ringConfirm.style.top = `${bounds.top - hudBounds.top + preview.y}px`;
  ringConfirm.style.width = `${Math.max(44, preview.width)}px`;
  ringConfirm.style.height = `${Math.max(44, preview.height)}px`;
  ringConfirm.setAttribute("aria-label", `抽取中央放大的第 ${ringFocusedPosition + 1} 號牌背`);
  for (const card of cardMeshes) {
    const index = card.userData.cardIndex;
    const cut = session.cut?.index === index;
    const slot = session.draws.findIndex((entry) => entry.index === index);
    const focus = session.order[ringFocusedPosition] === index;
    card.visible = cut || slot >= 0 || focus;
    if (!card.visible) continue;
    const height = cut ? (short ? 44 : 64) : slot >= 0 ? (short ? 26 : 36) : preview.height;
    const rect = focus ? preview : { x: cut ? 40 : bounds.width * 0.30 + slot * bounds.width * 0.62 / Math.max(1, session.drawCount - 1),
      y: bounds.height - (short ? 88 : 125), height, width: height * 0.61 / 1.01 };
    screenToReadingPlane(rect.x, rect.y, readingLabelPoint);
    screenToReadingPlane(rect.x, rect.y - rect.height / 2, readingProjectionPoint);
    const scale = Math.abs(readingProjectionPoint.y - readingLabelPoint.y) / 0.505;
    const speed = deckCarouselReducedMotion.matches ? 1000 : 12;
    card.position.x = THREE.MathUtils.damp(card.position.x, readingLabelPoint.x, speed, dt);
    card.position.y = THREE.MathUtils.damp(card.position.y, readingLabelPoint.y, speed, dt);
    card.position.z = THREE.MathUtils.damp(card.position.z, 1.05, speed, dt);
    card.rotation.x = THREE.MathUtils.damp(card.rotation.x, 0, speed, dt);
    card.rotation.y = Math.PI;
    card.rotation.z = THREE.MathUtils.damp(card.rotation.z, 0, speed, dt);
    card.scale.setScalar(THREE.MathUtils.damp(card.scale.x, scale, speed, dt));
    card.userData.reflectionMaterials.forEach((material) => {
      material.uniforms.uSweep.value = deckCarouselReducedMotion.matches ? 0.5 : (time * 0.18) % 1.38 - 0.16;
      material.uniforms.uOpacity.value = focus ? 0.85 : 0.3;
    });
  }
}

function measureReadingLayout() {
  const spread = getDrawSpread(readingResult.session.spreadId);
  const bounds = stage.getBoundingClientRect();
  const metrics = readingLayoutMetrics(bounds.width, spread, { detail: readingResult.detail !== null });
  inspection.dataset.readingSpread = spread.id;
  inspection.dataset.readingCompact = String(metrics.compact);
  const header = document.querySelector("#spread-result > header").getBoundingClientRect();
  const footer = cardControls.getBoundingClientRect();
  const questionPanel = document.querySelector("#reading-question");
  const questionHeight = questionPanel.hidden ? 0 : questionPanel.getBoundingClientRect().height;
  const labelHeights = { mainTopLabelHeight: 0, mainBottomLabelHeight: 0, cutTopLabelHeight: 0,
    cutBottomLabelHeight: 0, detailTopLabelHeight: 0, detailBottomLabelHeight: 0 };
  for (const label of document.querySelectorAll(".spread-card-label")) {
    const index = Number(label.dataset.readingIndex);
    const cut = index === readingResult.session.cut?.index;
    const detail = index === readingResult.detail;
    label.hidden = readingResult.detail !== null && !detail;
    label.classList.toggle("is-detail", detail);
    label.style.width = `${readingNameWidth(bounds.width, spread, { cut, detail })}px`;
    if (label.hidden) continue;
    const nameHeight = label.getBoundingClientRect().height;
    label.dataset.nameHeight = String(nameHeight);
    const side = label.classList.contains("is-identity") ? "Bottom" : "Top";
    if (detail) labelHeights[`detail${side}LabelHeight`] = nameHeight;
    if (cut) labelHeights[`cut${side}LabelHeight`] = nameHeight;
    else labelHeights[`main${side}LabelHeight`] = Math.max(labelHeights[`main${side}LabelHeight`], nameHeight);
  }
  readingScreenLayout = fitReadingLayout({ width: bounds.width, height: bounds.height,
    top: Math.max(16, header.bottom - bounds.top + metrics.headerGap), footerTop: footer.top - bounds.top,
    bottomPadding: Math.max(16, bounds.bottom - footer.bottom),
    spread, ...labelHeights, questionHeight, detail: readingResult.detail !== null });
  if (readingScreenLayout.question) {
    const resultBounds = document.querySelector("#spread-result").getBoundingClientRect();
    questionPanel.style.top = `${bounds.top - resultBounds.top + readingScreenLayout.question.top}px`;
  }
  document.querySelector("#spread-result").style.setProperty("--reading-label-gap", `${readingScreenLayout.labelGap}px`);
  if (readingLayoutSession !== readingResult.session) {
    readingScrollOffset = 0;
    readingLayoutSession = readingResult.session;
  }
  readingScroll.hidden = !readingScreenLayout.scrollable;
  const scrollHint = document.querySelector("#reading-scroll-hint");
  scrollHint.hidden = readingScroll.hidden;
  if (readingScreenLayout.scrollable) {
    const resultBounds = document.querySelector("#spread-result").getBoundingClientRect();
    readingScroll.style.top = `${bounds.top - resultBounds.top + readingScreenLayout.top}px`;
    scrollHint.style.top = `${bounds.top - resultBounds.top + readingScreenLayout.top - 14}px`;
    readingScroll.style.height = `${readingScreenLayout.viewportHeight}px`;
    document.querySelector("#reading-scroll-content").style.height = `${readingScreenLayout.contentHeight}px`;
    readingScrollOffset = Math.min(readingScrollOffset, readingScreenLayout.contentHeight - readingScreenLayout.viewportHeight);
    readingScroll.scrollTop = readingScrollOffset;
  }
  readingLayoutDirty = false;
}

function screenToReadingPlane(x, y, target) {
  target.set(x / stage.clientWidth * 2 - 1, 1 - y / stage.clientHeight * 2, 0.5).unproject(camera);
  target.sub(camera.position);
  target.multiplyScalar((1.05 - camera.position.z) / target.z).add(camera.position);
  return target;
}

function updateReadingCards(dt, time) {
  const { session, detail } = readingResult;
  if (readingLayoutDirty || !readingScreenLayout) measureReadingLayout();
  const entries = readingEntries();
  let finishedFlip = false;
  for (const card of cardMeshes) {
    const entry = entries.find((item) => item.index === card.userData.cardIndex);
    const cut = entry && entry === session.cut;
    card.visible = Boolean(entry) && (detail === null || entry.index === detail);
    const flip = readingFlips.get(card.userData.cardIndex);
    // Finish offscreen flips too, so a detail view can export the whole reading.
    if (entry && flip?.result === readingResult) {
      getCardFlipPose({ ...flip, elapsed: time * 1000 - flip.startedAt }, readingFlipPose);
      card.rotation.y = readingFlipPose.rotationY;
      if (readingFlipPose.done) { readingFlips.delete(entry.index); finishedFlip = true; }
    }
    if (!card.visible) continue;
    const slot = session.draws.indexOf(entry);
    const rect = detail !== null ? readingScreenLayout.detail : cut ? readingScreenLayout.cut : readingScreenLayout.cards[slot];
    const offset = readingScreenLayout.scrollable && !cut ? readingScrollOffset : 0;
    screenToReadingPlane(rect.x, rect.y - offset, readingLabelPoint);
    screenToReadingPlane(rect.x, rect.y - offset - rect.height / 2, readingProjectionPoint);
    Object.assign(ritualPose, { x: readingLabelPoint.x, y: readingLabelPoint.y, z: 1.05,
      scale: Math.abs(readingProjectionPoint.y - readingLabelPoint.y) / 0.505, ry: entry.faceUp ? 0 : Math.PI });
    const speed = deckCarouselReducedMotion.matches || readingScreenLayout.scrollable ? 1000 : 9;
    card.position.x = THREE.MathUtils.damp(card.position.x, ritualPose.x, speed, dt);
    card.position.y = THREE.MathUtils.damp(card.position.y, ritualPose.y, speed, dt);
    card.position.z = THREE.MathUtils.damp(card.position.z, ritualPose.z, speed, dt);
    card.rotation.x = THREE.MathUtils.damp(card.rotation.x, 0, speed, dt);
    if (flip?.result !== readingResult) card.rotation.y = THREE.MathUtils.damp(card.rotation.y, ritualPose.ry, deckCarouselReducedMotion.matches ? 1000 : 7.5, dt);
    card.rotation.z = THREE.MathUtils.damp(card.rotation.z, 0, speed, dt);
    card.scale.setScalar(THREE.MathUtils.damp(card.scale.x, ritualPose.scale, speed, dt));
    // The back stays direction-neutral; only the original front surface is reversed.
    card.userData.frontSurface.rotation.z = entry.reversed ? Math.PI : 0;
    card.userData.frontReflection.rotation.z = entry.reversed ? Math.PI : 0;
    card.userData.reflectionMaterials.forEach((material) => {
      material.uniforms.uSweep.value = deckCarouselReducedMotion.matches ? 0.5 : (time * 0.12) % 1.38 - 0.16;
      material.uniforms.uOpacity.value = card.userData.cardIndex === selectedCard ? 0.8 : 0.4;
    });
  }
  if (finishedFlip) { updateReadingResult(); measureReadingLayout(); }
  const stageBounds = stage.getBoundingClientRect();
  const labelBounds = document.querySelector("#spread-result").getBoundingClientRect();
  for (const label of document.querySelectorAll(".spread-card-label")) {
    const card = cardMeshes[Number(label.dataset.readingIndex)];
    label.hidden = !card?.visible;
    if (!card?.visible) continue;
    const below = label.classList.contains("is-identity");
    card.getWorldPosition(readingLabelPoint);
    readingLabelPoint.y += card.scale.y * 0.505 * (below ? -1 : 1);
    readingLabelPoint.project(camera);
    const anchor = (1 - readingLabelPoint.y) * 0.5 * stageBounds.height;
    const labelHeight = Number(label.dataset.nameHeight);
    const labelTop = below ? anchor + readingScreenLayout.labelGap : anchor - readingScreenLayout.labelGap - labelHeight;
    const labelBottom = labelTop + labelHeight;
    if (readingScreenLayout.scrollable && !label.classList.contains("is-cut")) {
      label.hidden = labelTop < readingScreenLayout.top - 0.5 || labelBottom > readingScreenLayout.bottom + 0.5;
    }
    label.style.left = `${stageBounds.left - labelBounds.left + (readingLabelPoint.x + 1) * 0.5 * stageBounds.width}px`;
    label.style.top = `${stageBounds.top - labelBounds.top + (1 - readingLabelPoint.y) * 0.5 * stageBounds.height}px`;
  }
}

function updateCasting(dt) {
  invokeAge += dt;
  castingLines.forEach((entry, index) => {
    const localAge = invokeAge - index * 0.055;
    const progress = THREE.MathUtils.clamp(localAge / 0.7, 0, 1);
    const fade = THREE.MathUtils.clamp(1 - (localAge - 0.5) / 0.85, 0, 1);
    entry.line.geometry.setDrawRange(0, Math.floor(entry.count * progress));
    entry.material.opacity = fade * 0.62;
  });
  pulseRings.forEach((entry) => {
    const age = invokeAge - entry.delay;
    const progress = THREE.MathUtils.clamp(age / 1.05, 0, 1);
    entry.ring.scale.setScalar(0.18 + progress * 2.7);
    entry.material.opacity = Math.sin(progress * Math.PI) * 0.38;
  });
  pooledLights.forEach((entry) => {
    entry.target *= Math.pow(0.002, dt);
    entry.light.intensity = THREE.MathUtils.damp(entry.light.intensity, entry.target, 8, dt);
  });
}


function updateShake(dt, time) {
  if (shakeTrauma < 0.001) return new THREE.Vector3();
  const strength = shakeTrauma * shakeTrauma;
  const offset = new THREE.Vector3(
    Math.sin(time * 31) * 0.017 * strength,
    Math.sin(time * 37 + 1.7) * 0.012 * strength,
    Math.sin(time * 23 + 3.2) * 0.009 * strength
  );
  shakeTrauma = Math.max(0, shakeTrauma - dt * 1.6);
  return offset;
}


function updateInnerBoxEffects(dt, time, now) {
  innerBoxGlowCurrent = THREE.MathUtils.damp(innerBoxGlowCurrent, innerBoxGlowTarget, 7, dt);
  const glowPulse = 0.78 + Math.sin(time * 6.4) * 0.22;
  innerBoxEdgeMaterial.opacity = Math.min(1, innerBoxGlowCurrent * glowPulse * 0.82);
  innerBoxGlowLight.intensity = innerBoxGlowCurrent * (1.2 + glowPulse * 1.35);

  const isSummoning = woodlandPhase === WOODLAND_PHASE.SUMMONING && cardSummonStartedAt > 0;
  if (!isSummoning) {
    summonRayMaterial.opacity = THREE.MathUtils.damp(summonRayMaterial.opacity, 0, 10, dt);
    return;
  }

  const summonElapsed = now - cardSummonStartedAt;
  const rayExpansion = THREE.MathUtils.clamp(summonElapsed / CARD_SUMMON_RAY_EXPAND_MS, 0, 1);
  cardSummonProgress = THREE.MathUtils.clamp(summonElapsed / CARD_SUMMON_MIN_DURATION_MS, 0, 1);
  const spread = rayExpansion * rayExpansion * (3 - 2 * rayExpansion);
  summonRaySeeds.forEach((seed, index) => {
    const local = THREE.MathUtils.clamp((spread - seed.delay) / (1 - seed.delay), 0, 1);
    const innerRadius = 0.2 + local * 0.2;
    const outerRadius = innerRadius + seed.length * (0.15 + local * 1.72);
    const offset = index * 6;
    summonRayPositions[offset] = Math.cos(seed.angle) * innerRadius;
    summonRayPositions[offset + 1] = Math.sin(seed.angle) * innerRadius;
    summonRayPositions[offset + 2] = 0;
    summonRayPositions[offset + 3] = Math.cos(seed.angle) * outerRadius;
    summonRayPositions[offset + 4] = Math.sin(seed.angle) * outerRadius;
    summonRayPositions[offset + 5] = 0;
  });
  summonRayGeometry.attributes.position.needsUpdate = true;
  const heldRayPulse = 0.76 + Math.sin(time * 8.5) * 0.16;
  summonRayMaterial.opacity = rayExpansion < 1
    ? Math.sin(rayExpansion * Math.PI * 0.5) * 0.92
    : heldRayPulse;
  innerBoxEdgeMaterial.opacity = Math.min(1, 0.72 + Math.sin(time * 14) * 0.2);
  innerBoxGlowLight.intensity = 3.2 + Math.sin(time * 16) * 0.55;
  const minimumDuration = deckCarouselReducedMotion.matches ? 250 : CARD_SUMMON_MIN_DURATION_MS;
  if (summonElapsed >= minimumDuration && areCardAssetsReady()) completeCardSummoning();
}


function updateArtifactPresentation(dt) {
  artifactBrightnessCurrent = THREE.MathUtils.damp(artifactBrightnessCurrent, artifactBrightnessTarget, 5.5, dt);
  woodlandDisplayMaterialState.forEach((baseColor, material) => {
    material.color.copy(baseColor).multiplyScalar(artifactBrightnessCurrent);
  });
}


function updateCardFocus(dt, time) {
  const cardActive = inspectionVisible && !drawRitual?.isOpen && !readingResult && activeMode === "cards" && cardsGroup.visible && !isCardTransitionActive();
  const selected = cardMeshes[selectedCard];
  let frontFacing = 1;
  if (selected) {
    selected.getWorldPosition(selectedCardWorldPosition);
    selected.getWorldQuaternion(selectedCardWorldQuaternion);
    selectedCardFrontNormal.set(0, 0, 1).applyQuaternion(selectedCardWorldQuaternion).normalize();
    selectedCardToCamera.copy(camera.position).sub(selectedCardWorldPosition).normalize();
    frontFacing = selectedCardFrontNormal.dot(selectedCardToCamera);
  }
  const sideView = cardActive && Math.abs(frontFacing) <= 0.35;
  const frontVisible = cardActive && frontFacing > 0.35;
  const frontStrength = THREE.MathUtils.smoothstep(frontFacing, 0.28, 0.92);
  const target = !cardActive ? 0 : frontVisible ? 0.4 + frontStrength * 0.6 : sideView ? 0.08 : 0.16;
  cardFocusMaskMaterial.opacity = THREE.MathUtils.damp(cardFocusMaskMaterial.opacity, target * 0.78, 6.5, dt);
  const shaftTarget = frontVisible
    ? (0.12 + frontStrength * 0.16) * (0.96 + Math.sin(time * 1.7) * 0.04)
    : 0;
  cardFocusShaftMaterial.opacity = THREE.MathUtils.damp(
    cardFocusShaftMaterial.opacity,
    shaftTarget,
    6.5,
    dt
  );

  if (selected) {
    cardFocusMask.position.copy(selectedCardWorldPosition).addScaledVector(selectedCardToCamera, -0.36);
    cardFocusShaft.position.copy(selectedCardWorldPosition).addScaledVector(selectedCardToCamera, -0.18);
    cardFocusShaft.position.y += 2.38;
  }

  inspection.classList.toggle("is-card-focus", frontVisible);
  inspection.classList.toggle("is-card-back", cardActive && !frontVisible && !sideView);
  inspection.classList.toggle("is-card-side", cardActive && sideView);
  if (cardActive) inspection.dataset.cardFace = frontVisible ? "front" : sideView ? "side" : "back";
  else delete inspection.dataset.cardFace;
}


function moveAtOneSecond(current, target, dt) {
  if (current === target) return target;
  const next = current + Math.sign(target - current) * dt;
  return target > current ? Math.min(next, target) : Math.max(next, target);
}

function renderStageScene() {
  if (!isReadingScrollable()) { renderer.render(scene, camera); return; }
  // Render the pinned cut/background normally, then clip only the scrollable
  // main cards. This keeps the existing meshes, materials, lighting and camera.
  const mainIndices = new Set(readingResult.session.draws.map((entry) => entry.index));
  const mainCards = cardMeshes.filter((card) => mainIndices.has(card.userData.cardIndex));
  const originalMainVisibility = mainCards.map((card) => card.visible);
  const cut = cardMeshes[readingResult.session.cut?.index];
  const cutVisible = cut?.visible;
  const decorations = scene.children.filter((object) => object !== cardsGroup && !object.isLight);
  const decorationVisibility = decorations.map((object) => object.visible);
  const autoClear = renderer.autoClear;
  try {
    mainCards.forEach((card) => { card.visible = false; });
    renderer.render(scene, camera);
    mainCards.forEach((card, index) => { card.visible = originalMainVisibility[index]; });
    if (cut) cut.visible = false;
    decorations.forEach((object) => { object.visible = false; });
    renderer.autoClear = false;
    renderer.setScissor(0, stage.clientHeight - readingScreenLayout.bottom, stage.clientWidth,
      Math.max(1, readingScreenLayout.bottom - readingScreenLayout.top));
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(scene, camera);
  } finally {
    mainCards.forEach((card, index) => { card.visible = originalMainVisibility[index]; });
    if (cut) cut.visible = cutVisible;
    decorations.forEach((object, index) => { object.visible = decorationVisibility[index]; });
    renderer.autoClear = autoClear;
    renderer.setScissorTest(false);
  }
}


function animate(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  const time = now / 1000;
  if (document.hidden) return;
  const leftFlicker = 0.84 + Math.sin(time * 7.9) * 0.1 + Math.sin(time * 17.7 + 1.2) * 0.055;
  const rightFlicker = 0.86 + Math.sin(time * 8.7 + 2.4) * 0.095 + Math.sin(time * 19.1) * 0.05;
  candleWash.style.opacity = String(0.38 + (leftFlicker + rightFlicker) * 0.085);
  renderDeckCarousel3DPreview(dt, time);
  if (!inspectionVisible) return;

  const coverTarget = woodlandOpenTarget > 0.5 || guidebookExtractedCurrent > 0.03 || innerBoxExtractedCurrent > 0.03 ? 1 : 0;
  woodlandOpenCurrent = moveAtOneSecond(woodlandOpenCurrent, coverTarget, dt);
  if (pendingGuidebookExtraction && woodlandOpenTarget > 0.5 && woodlandOpenCurrent >= 0.98) {
    beginGuidebookExtraction();
  }
  const woodlandEase = woodlandOpenCurrent * woodlandOpenCurrent * (3 - 2 * woodlandOpenCurrent);
  woodlandHinge.rotation.y = -woodlandEase * Math.PI * 0.86;
  guidebookExtractedCurrent = THREE.MathUtils.damp(guidebookExtractedCurrent, guidebookExtractedTarget, 4.4, dt);
  guidebookFlippedCurrent = THREE.MathUtils.damp(guidebookFlippedCurrent, guidebookFlippedTarget, 6.2, dt);
  const bookLift = THREE.MathUtils.smoothstep(guidebookExtractedCurrent, 0, 0.42);
  const bookTravel = THREE.MathUtils.smoothstep(guidebookExtractedCurrent, 0.24, 1);
  const bookFlip = guidebookFlippedCurrent * guidebookFlippedCurrent * (3 - 2 * guidebookFlippedCurrent);
  woodlandGuidebook.position.x = bookTravel * 1.18;
  woodlandGuidebook.position.y = -0.015 + bookTravel * 0.11 + Math.sin(time * 1.25) * bookTravel * 0.018;
  woodlandGuidebook.position.z = 0.028 + bookLift * 0.34 + bookTravel * 0.1;
  woodlandGuidebook.rotation.z = 0;
  woodlandGuidebook.rotation.y = bookFlip * Math.PI;

  innerBoxExtractedCurrent = THREE.MathUtils.damp(innerBoxExtractedCurrent, innerBoxExtractedTarget, 3.8, dt);
  const innerBoxEase = innerBoxExtractedCurrent * innerBoxExtractedCurrent * (3 - 2 * innerBoxExtractedCurrent);
  woodlandInnerPackage.position.x = 0;
  woodlandInnerPackage.position.y = -0.025 + innerBoxEase * 0.08;
  woodlandInnerPackage.position.z = -0.035 + innerBoxEase * 0.92;
  woodlandInnerPackage.rotation.z = 0;
  const innerPackageScale = 1 + innerBoxEase * 0.13;
  const geometryAspectRatio = INNER_BOX_WIDTH / INNER_BOX_HEIGHT;
  const requestedAspectRatio = Number(DECKS[activeDeckKey]?.packageAspectRatio);
  const innerPackageScaleX = Number.isFinite(requestedAspectRatio) && requestedAspectRatio > 0
    ? requestedAspectRatio / geometryAspectRatio
    : 1;
  woodlandInnerPackage.scale.set(
    innerPackageScale * innerPackageScaleX,
    innerPackageScale,
    innerPackageScale,
  );
  if (woodlandPhase === WOODLAND_PHASE.INNER_FLOATING && innerBoxExtractedCurrent > 0.92) {
    woodlandPhase = WOODLAND_PHASE.INNER_READY;
    innerBoxGlowTarget = 1;
    inspection.classList.add("is-inner-box-ready");
    inspection.dataset.woodlandPhase = woodlandPhase;
    cardsModeTab.title = `單擊浮出的${packageLabel()}抽取一張牌`;
  }
  updateInnerBoxEffects(dt, time, now);

  unveiledOpenCurrent = moveAtOneSecond(unveiledOpenCurrent, unveiledOpenTarget, dt);
  const unveiledEase = unveiledOpenCurrent * unveiledOpenCurrent * (3 - 2 * unveiledOpenCurrent);
  unveiledDrawer.position.y = -unveiledEase * 1.13;
  unveiledDrawer.position.z = unveiledEase * 0.12;

  const activeRoot = isBookDeck(activeDeckKey) ? woodlandRoot : unveiledRoot;
  const floatY = inspectionVisible ? Math.sin(time * 0.86) * 0.018 : 0;
  activeRoot.position.x = THREE.MathUtils.damp(activeRoot.position.x, artifactTargetPosition.x, 5, dt);
  activeRoot.position.y = THREE.MathUtils.damp(activeRoot.position.y, artifactTargetPosition.y + floatY, 5, dt);
  activeRoot.position.z = THREE.MathUtils.damp(activeRoot.position.z, artifactTargetPosition.z, 5, dt);
  const scale = THREE.MathUtils.damp(activeRoot.scale.x, artifactTargetScale, 5, dt);
  activeRoot.scale.setScalar(scale);

  updateCardTransitions(now);
  updateDrawEntry();
  updateCards(dt, time);
  updateArtifactPresentation(dt);
  updateCardFocus(dt, time);
  updateCasting(dt);
  if (drawRitual?.isOpen) {
    const visual = drawRitual.visual;
    const effectProgress = visual.phase === "revealing" ? Math.min(1, (now - visual.phaseStartedAt) / 1150) : visual.progress;
    ritualEffects.setState({ phase: visual.phase === "cutting" ? "selecting" : visual.phase, progress: effectProgress, holding: visual.holding, aspect: camera.aspect });
  }
  ritualEffects.update(dt, time);
  updateCameraTween(now);

  const positions = particleGeometry.attributes.position.array;
  for (let index = 0; index < particleCount; index += 1) {
    positions[index * 3 + 1] += particleSeeds[index].speed * dt;
    positions[index * 3] += Math.sin(time * 0.55 + particleSeeds[index].phase) * dt * 0.015;
    if (positions[index * 3 + 1] > 1.8) positions[index * 3 + 1] = -1.5;
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particles.rotation.y += dt * 0.018;

  const shake = updateShake(dt, time);
  camera.position.add(shake);
  controls.update();
  renderStageScene();
  camera.position.sub(shake);
}

renderer.setAnimationLoop(animate);

const resizeObserver = new ResizeObserver(([entry]) => {
  readingLayoutDirty = true;
  const width = Math.max(1, entry.contentRect.width);
  const height = Math.max(1, entry.contentRect.height);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});
resizeObserver.observe(stage);
const readingTextObserver = new ResizeObserver(() => { readingLayoutDirty = true; });
readingTextObserver.observe(cardControls);
readingTextObserver.observe(document.querySelector("#spread-result > header"));
readingTextObserver.observe(document.querySelector("#reading-question"));
document.fonts?.ready.then(() => { readingLayoutDirty = true; });

loading.classList.add("is-hidden");
const deckCarouselHadFocus = document.activeElement === deckCarouselTrack;
document.querySelectorAll(".tabletop-deck[data-deck]").forEach((button) => {
  button.disabled = false;
  button.setAttribute("aria-busy", "false");
});
deckCarouselTrack.tabIndex = -1;
setDeckCarouselCurrent(deckCarouselCurrentIndex);
if (deckCarouselHadFocus) getDeckCarouselSlides()[deckCarouselCurrentIndex]?.focus({ preventScroll: true });
cardsGroup.visible = false;
setBoxOpen(0);

initializeDrawRitual();
artifactStageReady = true;
updateDeckWorkbench(deckEntries[deckCarouselCurrentIndex][0]);

const requestedParameters = new URLSearchParams(window.location.search);
const requestedDeck = requestedParameters.get("deck");
const requestedMode = requestedParameters.get("mode");
if (DECKS[requestedDeck]) {
  archive.dataset.phase = "choose";
  setDeckPickerInteractive(true);
  const requestedDeckIndex = deckEntries.findIndex(([deckKey]) => deckKey === requestedDeck);
  if (requestedDeckIndex >= 0) setDeckCarouselCurrent(requestedDeckIndex, { scroll: true });
  enterInspection(requestedDeck, requestedMode);
}
