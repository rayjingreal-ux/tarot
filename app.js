import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";


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
const MANIFEST_CANDIDATES = [
  "./assets/woodland/cards-manifest.json",
  "./assets/woodland/cards/cards-manifest.json",
  "./assets/woodland/textures/cards-manifest.json",
  "./assets/cards-manifest.json",
  "./cards-manifest.json",
];
const CARD_ASSET_VERSION = "github-pages-20260814-01";

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
    numeral,
    name,
    file: index < 6 ? `card-${String(index).padStart(2, "0")}-${slug}.png` : null,
  }));
  MINOR_SUITS.forEach((suit) => {
    MINOR_RANKS.forEach((rank, rankIndex) => {
      cards.push({
        id: `${suit.toLowerCase()}-${String(rankIndex + 1).padStart(2, "0")}`,
        numeral: `${suit} / ${rank}`,
        name: `${rank} OF ${suit}`,
        file: null,
      });
    });
  });
  return cards;
}

function resolveCardSource(file, manifestUrl = null, basePath = null) {
  if (!file) return null;
  const value = String(file).replace(/\\/g, "/");
  if (/^(?:data:|blob:|https?:|file:)/i.test(value)) return value;
  if (basePath && manifestUrl) {
    const directory = String(basePath).endsWith("/") ? String(basePath) : `${basePath}/`;
    return new URL(value, new URL(directory, manifestUrl)).href;
  }
  if (manifestUrl && (value.startsWith(".") || value.includes("/"))) return new URL(value, manifestUrl).href;
  return new URL(`./assets/woodland/textures/${value}`, window.location.href).href;
}

function versionCardSource(source) {
  if (!source || /^(?:data:|blob:)/i.test(source)) return source;
  const url = new URL(source, window.location.href);
  url.searchParams.set("v", CARD_ASSET_VERSION);
  return url.href;
}

function normalizeCardCatalog(payload, manifestUrl = null) {
  const sourceCards = Array.isArray(payload) ? payload : payload?.cards;
  if (!Array.isArray(sourceCards) || sourceCards.length < 78) return null;
  const fallbackCards = createFallbackCatalog();
  const basePath = Array.isArray(payload) ? null : payload.basePath ?? payload.base_path ?? null;
  return sourceCards
    .map((card, originalIndex) => ({ card, originalIndex }))
    .sort((a, b) => Number(a.card.index ?? a.card.order ?? a.originalIndex) - Number(b.card.index ?? b.card.order ?? b.originalIndex))
    .slice(0, 78)
    .map(({ card }, index) => {
      const fallback = fallbackCards[index];
      const file = card.file ?? card.filename ?? card.path ?? card.front_file ?? card.front ?? card.texturePath ?? card.texture ?? card.image?.front ?? card.image ?? null;
      const normalized = {
        id: String(card.id ?? card.slug ?? fallback.id),
        numeral: String(card.numeral ?? card.roman ?? card.arcana ?? card.number ?? card.rank ?? fallback.numeral),
        name: String(card.name ?? card.title ?? card.name_en ?? card.label ?? fallback.name).toUpperCase(),
        file: typeof file === "string" ? file : null,
      };
      normalized.src = versionCardSource(resolveCardSource(normalized.file, manifestUrl, basePath)) ?? createFallbackCardSource(normalized);
      normalized.fallbackSrc = createFallbackCardSource(normalized);
      return normalized;
    });
}

async function loadCardCatalog() {
  const injected = normalizeCardCatalog(globalThis.WOODLAND_CARDS_MANIFEST);
  if (injected) return injected;
  if (window.location.protocol !== "file:") {
    for (const candidate of MANIFEST_CANDIDATES) {
      try {
        const response = await fetch(candidate, { cache: "no-store" });
        if (!response.ok) continue;
        const catalog = normalizeCardCatalog(await response.json(), response.url);
        if (catalog) {
          console.info(`[arcana] loaded ${catalog.length} cards from ${response.url}`);
          return catalog;
        }
      } catch (error) {
        console.warn(`[arcana] unable to load ${candidate}`, error);
      }
    }
  }
  const fallback = createFallbackCatalog().map((card) => ({
    ...card,
    src: resolveCardSource(card.file) ?? createFallbackCardSource(card),
    fallbackSrc: createFallbackCardSource(card),
  }));
  console.info("[arcana] using the embedded 78-card catalog; set window.WOODLAND_CARDS_MANIFEST when running from file:// to inject generated assets synchronously");
  return fallback;
}

const CARDS = await loadCardCatalog();

const DECKS = {
  unveiled: {
    number: "01",
    header: "THE UNVEILED TAROT",
    kicker: "DREAM, SYMBOL & REVELATION",
    title: "THE UNVEILED<br /><em>Tarot</em>",
    description: "硬紙盒外套與可滑出的內抽屜，以五張實拍照片重建並納入同一套召喚舞台。",
    structure: "SLIPCASE + DRAWER",
    cards: "尚未提供獨立牌面",
    basis: "5 PHOTOS",
    hasCards: false,
    openLabel: "拉出內盒",
    closeLabel: "收回內盒",
  },
  woodland: {
    number: "02",
    header: "WOODLAND FAIRY TALE TAROT",
    kicker: "MAGIC, FOLKLORE & PLANTS",
    title: "WOODLAND<br /><em>Fairy Tale</em> TAROT",
    description: "磁吸書型外盒、可取出的說明書、內卡盒與完整七十八張牌面，依照 411495–411497 的拆件狀態重建。",
    structure: "OUTER BOX + GUIDE + INNER BOX",
    cards: "LXXVIII / LXXVIII",
    basis: "29 PHOTOS",
    hasCards: true,
    openLabel: "打開磁吸書型盒",
    closeLabel: "闔上磁吸書型盒",
  },
};

const archive = document.querySelector("#archive");
const cabinet = document.querySelector("#cabinet-scene");
const inspection = document.querySelector("#inspection");
const stage = document.querySelector("#three-stage");
const loading = document.querySelector("#model-loading");
const flash = document.querySelector("#mystic-flash");
const boxControls = document.querySelector("#box-controls");
const cardControls = document.querySelector("#card-controls");
const cardsModeTab = document.querySelector("#cards-mode-tab");
const openButton = document.querySelector("#open-box");
const viewMenuToggle = document.querySelector("#view-menu-toggle");
const viewMenuPanel = document.querySelector("#view-menu-panel");
const currentViewLabel = document.querySelector("#current-view-label");
const cardRail = document.querySelector("#card-rail");
const cardCatalogToggle = document.querySelector("#card-catalog-toggle");
const cardCatalogPanel = document.querySelector("#card-catalog-panel");
const cardIndex = document.querySelector("#card-index");
const cardName = document.querySelector("#card-name");
const flipCardButton = document.querySelector("#flip-card");
const soundToggle = document.querySelector("#sound-toggle");
const boxSequenceHint = document.querySelector(".box-sequence-hint");
let feedbackResetTimer = null;

let activeDeckKey = "woodland";
let activeMode = "box";
let selectedCard = 0;
let selectedFlipped = false;
let inspectionVisible = false;
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
});
let woodlandPhase = WOODLAND_PHASE.CLOSED;
let cardRevealComplete = false;
let innerBoxGlowTarget = 0;
let innerBoxGlowCurrent = 0;
let cardSummonStartedAt = 0;
let cardSummonProgress = 0;
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
buildCardRail();

document.querySelector("#approach-button").addEventListener("click", () => {
  archive.dataset.phase = "choose";
});

document.querySelector("#retreat-button").addEventListener("click", () => {
  archive.dataset.phase = "entrance";
});

document.querySelectorAll(".tabletop-deck[data-deck]").forEach((button) => {
  button.addEventListener("click", () => enterInspection(button.dataset.deck));
});

document.querySelector("#close-inspection").addEventListener("click", leaveInspection);

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
  if (woodlandPhase === WOODLAND_PHASE.SUMMONING) return;
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

document.querySelector("#previous-card").addEventListener("click", () => selectCard(selectedCard - 1));
document.querySelector("#next-card").addEventListener("click", () => selectCard(selectedCard + 1));
flipCardButton.addEventListener("click", flipSelectedCard);
cardCatalogToggle.addEventListener("click", () => {
  setCardCatalogOpen(cardCatalogToggle.getAttribute("aria-expanded") !== "true");
});

window.addEventListener("keydown", (event) => {
  if (!inspectionVisible) return;
  if (event.key === "Escape") leaveInspection();
  if (activeMode === "cards") {
    if (event.key === "ArrowLeft") selectCard(selectedCard - 1);
    if (event.key === "ArrowRight") selectCard(selectedCard + 1);
    if (event.key === " " || event.key === "Enter") flipSelectedCard();
  }
});

cabinet.addEventListener("pointermove", (event) => {
  const nx = event.clientX / window.innerWidth - 0.5;
  const ny = event.clientY / window.innerHeight - 0.5;
  const strength = archive.dataset.phase === "entrance" ? 1 : 0.45;
  cabinet.querySelector(".scene-image").style.margin = `${ny * -8 * strength}px ${nx * -13 * strength}px`;
  cabinet.style.setProperty("--scene-x", `${nx * 18}px`);
  cabinet.style.setProperty("--scene-y", `${ny * 12}px`);
});


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
  cardRail.replaceChildren();
  CARDS.forEach((card, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `rail-card${index === 0 ? " is-active" : ""}`;
    button.setAttribute("aria-label", card.name);
    const image = document.createElement("img");
    image.src = card.src;
    image.alt = card.name;
    image.addEventListener("error", () => {
      if (image.src !== card.fallbackSrc) image.src = card.fallbackSrc;
    }, { once: true });
    button.append(image);
    button.addEventListener("click", () => selectCard(index));
    cardRail.append(button);
  });
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
  const sequenceHint = activeDeckKey === "woodland"
    ? "單擊外盒開啟 · 單擊說明書取出／翻面 · 單擊內卡盒浮出 · 再單擊內卡盒抽牌"
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
  innerBoxGlowTarget = 0;
  innerBoxGlowCurrent = 0;
  guidebookExtractedTarget = 0;
  guidebookExtractedCurrent = 0;
  guidebookFlippedTarget = 0;
  guidebookFlippedCurrent = 0;
  innerBoxExtractedTarget = 0;
  innerBoxExtractedCurrent = 0;
  artifactBrightnessTarget = 1;
  artifactBrightnessCurrent = 1;
  cardsModeTab.disabled = true;
  cardsModeTab.title = "依序單擊說明書與內卡盒，再單擊抽牌";
  inspection.classList.remove("is-inner-box-ready", "is-card-summoning", "is-card-focus", "is-card-back", "is-card-side");
  delete inspection.dataset.woodlandPhase;
}


function enterInspection(deckKey) {
  if (!DECKS[deckKey]) return;
  activeDeckKey = deckKey;
  updateArtifactCopy();
  if (deckKey === "woodland") {
    cardsModeTab.disabled = true;
    cardsModeTab.title = "依序單擊說明書與內卡盒後開啟";
  }
  woodlandRoot.visible = deckKey === "woodland";
  unveiledRoot.visible = deckKey === "unveiled";
  inspectionVisible = true;
  inspection.classList.add("is-visible", "is-summoning");
  inspection.setAttribute("aria-hidden", "false");
  invokeAge = 0;
  resetWoodlandInteraction();
  setMode("box", false);
  setBoxOpen(0);
  activateView("front");
  triggerMysticEffect(0.42);
  playInvocationSound();
  window.setTimeout(() => inspection.classList.remove("is-summoning"), 1900);
}


function leaveInspection() {
  setViewMenuOpen(false);
  if (woodlandPhase === WOODLAND_PHASE.SUMMONING) {
    woodlandPhase = WOODLAND_PHASE.INNER_READY;
    cardSummonStartedAt = 0;
    cardSummonProgress = 0;
  }
  inspectionVisible = false;
  inspection.classList.remove("is-visible", "is-summoning");
  inspection.classList.remove("is-card-summoning", "is-card-focus", "is-card-back", "is-card-side");
  inspection.setAttribute("aria-hidden", "true");
  controls.autoRotate = false;
}


function setMode(mode, userInitiated = false) {
  if (mode === "cards" && !DECKS[activeDeckKey].hasCards) return;
  if (mode === "cards" && activeDeckKey === "woodland" && !cardRevealComplete) return;
  activeMode = mode;
  document.querySelectorAll(".mode-tab").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  const cardsActive = mode === "cards";
  boxControls.classList.toggle("is-hidden", cardsActive);
  cardControls.setAttribute("aria-hidden", cardsActive ? "false" : "true");
  cardsGroup.visible = cardsActive && activeDeckKey === "woodland";
  controls.autoRotate = false;

  if (cardsActive) {
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
    selectCard(selectedCard, false);
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
}


function setCardCatalogOpen(open) {
  cardCatalogToggle.setAttribute("aria-expanded", String(open));
  cardCatalogPanel.hidden = !open;
  cardControls.classList.toggle("is-catalog-open", open);
}


function setViewMenuOpen(open) {
  viewMenuToggle.setAttribute("aria-expanded", String(open));
  viewMenuPanel.hidden = !open;
  boxControls.classList.toggle("is-view-menu-open", open);
}


function getActiveOpenTarget() {
  return activeDeckKey === "woodland" ? woodlandOpenTarget : unveiledOpenTarget;
}


function setBoxOpen(value, { sound = false } = {}) {
  const clamped = THREE.MathUtils.clamp(value, 0, 1);
  if (activeDeckKey === "woodland") {
    woodlandOpenTarget = clamped;
    if (clamped < 0.5) {
      setViewMenuOpen(false);
      guidebookExtractedTarget = 0;
      guidebookFlippedTarget = 0;
      innerBoxExtractedTarget = 0;
      innerBoxGlowTarget = 0;
      cardRevealComplete = false;
      cardSummonStartedAt = 0;
      cardSummonProgress = 0;
      woodlandPhase = WOODLAND_PHASE.CLOSED;
      cardsModeTab.disabled = true;
      cardsModeTab.title = "依序單擊說明書與內卡盒，再單擊抽牌";
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
  if (sound) showBoxFeedback(open ? "外盒正在開啟，完成後點擊說明書" : "外盒正在闔上", open ? "active" : "muted");
}


function selectCard(index, effect = true) {
  const previousCard = selectedCard;
  selectedCard = (index + CARDS.length) % CARDS.length;
  selectedFlipped = true;
  inspection.dataset.cardFace = "back";
  flipCardButton.querySelector("span").textContent = "翻至正面";
  CARDS.forEach((card, cardNumber) => {
    cardRail.children[cardNumber].classList.toggle("is-active", cardNumber === selectedCard);
  });
  cardIndex.textContent = `ARCANA ${CARDS[selectedCard].numeral}`;
  cardName.textContent = CARDS[selectedCard].name;
  if (effect) {
    triggerMysticEffect(0.22);
    const rawDirection = index - previousCard;
    playCardSlide(rawDirection === 0 ? 0 : Math.sign(rawDirection));
  }
}


function flipSelectedCard() {
  if (activeMode !== "cards") return;
  selectedFlipped = !selectedFlipped;
  inspection.dataset.cardFace = selectedFlipped ? "back" : "front";
  flipCardButton.querySelector("span").textContent = selectedFlipped ? "翻至正面" : "翻至背面";
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
  filter.frequency.setValueAtTime(deckKey === "woodland" ? 720 : 980, now);
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
const staticTextureRequests = [
  ...[
    "outer-front.jpg", "outer-back.jpg", "outer-inside.jpg", "outer-left.jpg", "outer-right.jpg", "outer-top.jpg", "outer-bottom.jpg",
    "inner-front.jpg", "inner-back.jpg", "inner-front-upright.jpg", "inner-back-upright.jpg", "inner-left.jpg", "inner-right.jpg", "inner-top.jpg", "inner-bottom.jpg", "guidebook-front.png", "guidebook-back.png", "card-back.png",
  ].map((name) => [`woodland:${name}`, `./assets/woodland/textures/${name}?v=20260814-10`]),
  ...["front.jpg", "back.jpg", "left.jpg", "right.jpg", "top.jpg", "drawer.jpg"]
    .map((name) => [`unveiled:${name}`, `./assets/unveiled/textures/${name}`]),
];

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

const staticTextureEntries = await Promise.all(staticTextureRequests.map(async ([key, path]) => [key, await loadColorTexture(path)]));
const cardTextureEntries = await Promise.all(CARDS.map(async (card, index) => [
  `woodland:card:${index}`,
  await loadColorTexture(card.src, card.fallbackSrc),
]));
const textureEntries = [...staticTextureEntries, ...cardTextureEntries];
const textures = Object.fromEntries(textureEntries);

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

for (let index = 0; index < 8; index += 1) {
  const layer = new THREE.Mesh(new THREE.BoxGeometry(0.79, 1.15, 0.006), index % 2 ? neutralPaper : darkPaper);
  layer.position.set(0, -0.04 + index * 0.006, UNVEILED_DEPTH / 2 - 0.018 + index * 0.006);
  layer.castShadow = true;
  unveiledDrawer.add(layer);
}


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
  frontReflection.position.z = thickness / 2 + 0.0025;
  frontReflection.renderOrder = 4;
  group.add(frontReflection);

  const backReflectionMaterial = createCardReflectionMaterial(index + 2.75);
  const backReflection = new THREE.Mesh(planeGeometry.clone(), backReflectionMaterial);
  backReflection.rotation.y = Math.PI;
  backReflection.position.z = -thickness / 2 - 0.0025;
  backReflection.renderOrder = 4;
  group.add(backReflection);
  group.userData.reflectionMaterials = [frontReflectionMaterial, backReflectionMaterial];
  return group;
}


const cardsGroup = new THREE.Group();
cardsGroup.name = "Rounded 1 mm floating cards";
cardsGroup.visible = false;
scene.add(cardsGroup);
const cardMeshes = CARDS.map((card, index) => {
  const group = createRoundedCard(textures[`woodland:card:${index}`], textures["woodland:card-back.png"], index);
  group.position.set(0, 0, 0.35 + index * 0.01);
  cardsGroup.add(group);
  return group;
});

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

function findInteractiveHit(root) {
  const hits = raycaster.intersectObject(root, true);
  for (const hit of hits) {
    const interaction = findInteraction(hit.object, root);
    if (interaction) return { hit, interaction };
  }
  return null;
}

function handleGuidebookClick() {
  if (woodlandOpenTarget < 0.5) {
    setBoxOpen(1, { sound: true });
    return;
  }
  if (woodlandOpenCurrent < 0.68) {
    showBoxFeedback("外盒仍在開啟，請稍候再點說明書", "waiting");
    return;
  }
  if (guidebookExtractedTarget < 0.5) {
    guidebookExtractedTarget = 1;
    woodlandPhase = WOODLAND_PHASE.GUIDE_EXTRACTED;
    inspection.dataset.woodlandPhase = woodlandPhase;
    playCardSlide(1);
    triggerMysticEffect(0.25);
    showBoxFeedback("已選取說明書：正在取出（封面已向右旋轉 90°）");
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
  if (guidebookExtractedTarget < 0.5 || guidebookExtractedCurrent < 0.86) {
    showBoxFeedback("請先點擊說明書並等待它完全取出", "waiting");
    return;
  }
  if (innerBoxExtractedTarget < 0.5) {
    innerBoxExtractedTarget = 1;
    innerBoxGlowTarget = 1;
    woodlandPhase = WOODLAND_PHASE.INNER_FLOATING;
    inspection.dataset.woodlandPhase = woodlandPhase;
    playBoxSound(true, "woodland");
    triggerMysticEffect(0.36);
    showBoxFeedback("已選取內卡盒：正在浮出");
    return;
  }
  if (woodlandPhase === WOODLAND_PHASE.INNER_READY) {
    showBoxFeedback("已選取內卡盒：正在展開 78 張牌面");
    beginCardSummoning();
    return;
  }
  showBoxFeedback("內卡盒正在移動，請稍候", "waiting");
}

function beginCardSummoning() {
  if (
    woodlandPhase !== WOODLAND_PHASE.INNER_READY ||
    innerBoxExtractedCurrent < 0.92 ||
    cardSummonStartedAt > 0
  ) return;
  woodlandPhase = WOODLAND_PHASE.SUMMONING;
  cardSummonStartedAt = performance.now();
  cardSummonProgress = 0;
  innerBoxGlowTarget = 1.35;
  cardsModeTab.disabled = true;
  cardsModeTab.title = "正在凝聚牌面…";
  inspection.classList.remove("is-inner-box-ready");
  inspection.classList.add("is-card-summoning");
  inspection.dataset.woodlandPhase = woodlandPhase;
  playInvocationSound();
  triggerMysticEffect(0.48);
}

function completeCardSummoning() {
  if (woodlandPhase !== WOODLAND_PHASE.SUMMONING) return;
  const randomIndex = Math.floor(Math.random() * CARDS.length);
  cardSummonStartedAt = 0;
  cardSummonProgress = 1;
  cardRevealComplete = true;
  cardsModeTab.disabled = false;
  cardsModeTab.title = "檢視完整七十八張牌面";
  inspection.classList.remove("is-card-summoning");
  selectCard(randomIndex, false);
  setMode("cards", false);
  inspection.dataset.woodlandPhase = WOODLAND_PHASE.CARDS;
  playCardSlide(randomIndex >= CARDS.length / 2 ? 1 : -1);
  triggerMysticEffect(0.72);
}

renderer.domElement.addEventListener("click", (event) => {
  if (activeMode !== "cards") return;
  setPointerFromEvent(event);
  const hit = raycaster.intersectObjects(cardMeshes, true)[0];
  if (!hit) return;
  let cardRoot = hit.object;
  while (cardRoot.parent !== cardsGroup && cardRoot.parent) cardRoot = cardRoot.parent;
  const index = cardRoot.userData.cardIndex;
  if (index === selectedCard) flipSelectedCard();
  else selectCard(index);
});

renderer.domElement.addEventListener("pointermove", (event) => {
  if (!inspectionVisible || activeMode !== "box") return;
  setPointerFromEvent(event);
  const activeRoot = activeDeckKey === "woodland" ? woodlandRoot : unveiledRoot;
  const hasObject = raycaster.intersectObject(activeRoot, true).length > 0;
  renderer.domElement.style.cursor = hasObject ? "pointer" : "grab";
});

renderer.domElement.addEventListener("click", (event) => {
  if (!inspectionVisible || activeMode !== "box") return;
  setPointerFromEvent(event);
  const activeRoot = activeDeckKey === "woodland" ? woodlandRoot : unveiledRoot;

  if (activeDeckKey === "unveiled") {
    if (raycaster.intersectObject(activeRoot, true).length === 0) return;
    setBoxOpen(unveiledOpenTarget < 0.5 ? 1 : 0, { sound: true });
    triggerMysticEffect(0.2);
    return;
  }

  // When closed, the cover is the only intended target. Once open, inspect
  // every ray hit instead of only the nearest mesh: transparent/frame meshes
  // can otherwise hide the guidebook and make a valid click look ignored.
  if (woodlandOpenTarget < 0.5) {
    if (raycaster.intersectObject(woodlandRoot, true).length === 0) return;
    setBoxOpen(1, { sound: true });
    triggerMysticEffect(0.2);
    return;
  }
  const interactive = findInteractiveHit(woodlandRoot);
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
  const root = activeDeckKey === "woodland" ? woodlandRoot : unveiledRoot;
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
  cardMeshes.forEach((card, index) => {
    const isSelected = index === selectedCard;
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
    card.userData.reflectionMaterials.forEach((material, surfaceIndex) => {
      const cycle = (time * 0.105 + index * 0.173 + surfaceIndex * 0.41) % 1.38;
      material.uniforms.uSweep.value = -0.16 + cycle;
      material.uniforms.uOpacity.value = THREE.MathUtils.damp(
        material.uniforms.uOpacity.value,
        isSelected ? 0.88 : 0.25,
        5.5,
        dt
      );
    });
  });
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

  cardSummonProgress = THREE.MathUtils.clamp((now - cardSummonStartedAt) / 2000, 0, 1);
  const spread = cardSummonProgress * cardSummonProgress * (3 - 2 * cardSummonProgress);
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
  summonRayMaterial.opacity = Math.sin(cardSummonProgress * Math.PI) * 0.92;
  innerBoxEdgeMaterial.opacity = Math.min(1, 0.72 + Math.sin(time * 14) * 0.2);
  innerBoxGlowLight.intensity = 3.2 + Math.sin(time * 16) * 0.55;
  if (cardSummonProgress >= 1) completeCardSummoning();
}


function updateArtifactPresentation(dt) {
  artifactBrightnessCurrent = THREE.MathUtils.damp(artifactBrightnessCurrent, artifactBrightnessTarget, 5.5, dt);
  woodlandDisplayMaterialState.forEach((baseColor, material) => {
    material.color.copy(baseColor).multiplyScalar(artifactBrightnessCurrent);
  });
}


function updateCardFocus(dt, time) {
  const cardActive = inspectionVisible && activeMode === "cards" && cardsGroup.visible;
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


function animate(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.05);
  lastFrameTime = now;
  const time = now / 1000;

  const coverTarget = woodlandOpenTarget > 0.5 || guidebookExtractedCurrent > 0.03 || innerBoxExtractedCurrent > 0.03 ? 1 : 0;
  woodlandOpenCurrent = moveAtOneSecond(woodlandOpenCurrent, coverTarget, dt);
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
  woodlandInnerPackage.scale.setScalar(1 + innerBoxEase * 0.13);
  if (woodlandPhase === WOODLAND_PHASE.INNER_FLOATING && innerBoxExtractedCurrent > 0.92) {
    woodlandPhase = WOODLAND_PHASE.INNER_READY;
    innerBoxGlowTarget = 1;
    inspection.classList.add("is-inner-box-ready");
    inspection.dataset.woodlandPhase = woodlandPhase;
    cardsModeTab.title = "單擊浮出的內卡盒抽取一張牌";
  }
  updateInnerBoxEffects(dt, time, now);

  unveiledOpenCurrent = moveAtOneSecond(unveiledOpenCurrent, unveiledOpenTarget, dt);
  const unveiledEase = unveiledOpenCurrent * unveiledOpenCurrent * (3 - 2 * unveiledOpenCurrent);
  unveiledDrawer.position.y = -unveiledEase * 1.13;
  unveiledDrawer.position.z = unveiledEase * 0.12;

  const activeRoot = activeDeckKey === "woodland" ? woodlandRoot : unveiledRoot;
  const floatY = inspectionVisible ? Math.sin(time * 0.86) * 0.018 : 0;
  activeRoot.position.x = THREE.MathUtils.damp(activeRoot.position.x, artifactTargetPosition.x, 5, dt);
  activeRoot.position.y = THREE.MathUtils.damp(activeRoot.position.y, artifactTargetPosition.y + floatY, 5, dt);
  activeRoot.position.z = THREE.MathUtils.damp(activeRoot.position.z, artifactTargetPosition.z, 5, dt);
  const scale = THREE.MathUtils.damp(activeRoot.scale.x, artifactTargetScale, 5, dt);
  activeRoot.scale.setScalar(scale);

  updateCards(dt, time);
  updateArtifactPresentation(dt);
  updateCardFocus(dt, time);
  updateCasting(dt);
  updateCameraTween(now);

  const positions = particleGeometry.attributes.position.array;
  for (let index = 0; index < particleCount; index += 1) {
    positions[index * 3 + 1] += particleSeeds[index].speed * dt;
    positions[index * 3] += Math.sin(time * 0.55 + particleSeeds[index].phase) * dt * 0.015;
    if (positions[index * 3 + 1] > 1.8) positions[index * 3 + 1] = -1.5;
  }
  particleGeometry.attributes.position.needsUpdate = true;
  particles.rotation.y += dt * 0.018;

  // Only the two candles already present in the photograph drive the ambient
  // light wash. There are no additional flame sprites or floating lights.
  const leftFlicker = 0.84 + Math.sin(time * 7.9) * 0.1 + Math.sin(time * 17.7 + 1.2) * 0.055;
  const rightFlicker = 0.86 + Math.sin(time * 8.7 + 2.4) * 0.095 + Math.sin(time * 19.1) * 0.05;
  candleWash.style.opacity = String(0.38 + (leftFlicker + rightFlicker) * 0.085);

  const shake = updateShake(dt, time);
  camera.position.add(shake);
  controls.update();
  renderer.render(scene, camera);
  camera.position.sub(shake);
}

renderer.setAnimationLoop(animate);

const resizeObserver = new ResizeObserver(([entry]) => {
  const width = Math.max(1, entry.contentRect.width);
  const height = Math.max(1, entry.contentRect.height);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
});
resizeObserver.observe(stage);

loading.classList.add("is-hidden");
document.querySelectorAll(".tabletop-deck[data-deck]").forEach((button) => {
  button.disabled = false;
  button.setAttribute("aria-busy", "false");
});
cardsGroup.visible = false;
setBoxOpen(0);

const requestedDeck = new URLSearchParams(window.location.search).get("deck");
if (DECKS[requestedDeck]) {
  archive.dataset.phase = "choose";
  enterInspection(requestedDeck);
}
