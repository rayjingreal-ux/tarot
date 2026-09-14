import test from "node:test";
import assert from "node:assert/strict";
import { readingArrivalEnvelope } from "../reading-journey-timing.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DRAW_SPREADS, getDrawSpread } from "../draw-spreads.js";
import { getCardDisplayName } from "../card-names.js";
import * as THREE from "../vendor/three/three.module.js";
import { getCardFlipPose } from "../card-flip.js";

// Execute the real app functions with state/element doubles, without browser QA.
const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
function bind(names, state) {
  const context = vm.createContext(state);
  for (const name of names) {
    const body = source.match(new RegExp(`^function ${name}\\([^]*?^}`, "m"))?.[0];
    assert.ok(body, `Missing app function ${name}`);
    vm.runInContext(body, context);
  }
  return context;
}

test("completed readings hide both artifact roots and the independent plinth for every deck", () => {
  const state = bind(["syncReadingArtifactVisibility"], {
    artifactStageReady: true, readingResult: {}, activeMode: "cards", activeDeckKey: "woodland", inspection: { dataset: {} },
    woodlandRoot: { visible: true }, unveiledRoot: { visible: false }, plinth: { visible: true },
    isBookDeck: (id) => id !== "unveiled",
  });
  for (const deck of ["woodland", "redvisions", "prosepoem", "unveiled"]) {
    state.activeDeckKey = deck; state.activeMode = "cards"; state.readingResult = {};
    state.syncReadingArtifactVisibility();
    assert.equal(state.woodlandRoot.visible, false); assert.equal(state.unveiledRoot.visible, false); assert.equal(state.plinth.visible, false);
    state.activeMode = "box"; state.syncReadingArtifactVisibility();
    assert.equal(state.woodlandRoot.visible, deck !== "unveiled");
    assert.equal(state.unveiledRoot.visible, deck === "unveiled"); assert.equal(state.plinth.visible, true);
    state.activeMode = "cards"; state.readingResult = null; state.syncReadingArtifactVisibility();
    assert.equal(state.plinth.visible, true, "returning cards restores the box presentation");
    state.readingResult = {}; state.syncReadingArtifactVisibility();
    assert.equal(state.plinth.visible, false, "cancel back to a prior reading keeps artifacts hidden");
    state.readingResult = null;
    for (const phase of ["shuffling", "cutting", "selecting", "revealing"]) {
      state.inspection.dataset.ritualPhase = phase;
      state.syncReadingArtifactVisibility();
      assert.ok(!state.plinth.visible && !state.woodlandRoot.visible && !state.unveiledRoot.visible, `${deck}/${phase} hides both boxes, guide and plinth`);
    }
    state.inspection.dataset.ritualPhase = "setup";
    state.syncReadingArtifactVisibility(); assert.equal(state.plinth.visible, true);
    delete state.inspection.dataset.ritualPhase;
  }
  state.artifactStageReady = false; state.woodlandRoot = null;
  assert.doesNotThrow(() => state.syncReadingArtifactVisibility());
});

test("blank-space overview preserves card selection, order, cut and orientations", () => {
  let updates = 0;
  const result = { detail: 9, index: 9, session: { order: [9, 1, 4], draws: [{ index: 9, reversed: true, faceUp: true }], cut: { index: 4, reversed: false, faceUp: false } } };
  const snapshot = JSON.stringify(result.session);
  const state = bind(["showReadingOverview"], {
    readingResult: result, drawRitual: { isOpen: false }, isCardTransitionActive: () => false, updateReadingResult: () => updates++,
  });
  state.showReadingOverview(); assert.equal(result.detail, null); assert.equal(updates, 1);
  assert.equal(JSON.stringify(result.session), snapshot); assert.equal(result.index, 9);
  state.showReadingOverview(); assert.equal(updates, 1, "blank overview is a no-op");
  result.detail = 9; state.drawRitual.isOpen = true; state.showReadingOverview(); assert.equal(result.detail, 9);
  state.drawRitual.isOpen = false; state.isCardTransitionActive = () => true; state.showReadingOverview(); assert.equal(result.detail, 9);
});

test("card and name activation reveal first, then enlarge, including the separate cut", () => {
  const calls = [], entries = [{ index: 8, faceUp: false }, { index: 22, faceUp: true }];
  const state = bind(["activateReadingCard"], {
    readingResult: {}, readingFlips: new Map(), drawRitual: { isOpen: false }, isCardTransitionActive: () => false,
    readingEntries: () => entries, focusReadingCard: (index, detail) => calls.push([index, detail]), flipSelectedCard: () => calls.push("flip"),
  });
  state.activateReadingCard(8); assert.deepEqual(calls, [[8, false], "flip"]);
  entries[0].faceUp = true; state.activateReadingCard(8); assert.deepEqual(calls.at(-1), [8, true]);
  state.activateReadingCard(22); assert.deepEqual(calls.at(-1), [22, true]);
  const count = calls.length; state.activateReadingCard(77); assert.equal(calls.length, count);
  state.readingFlips.set(8, {}); state.activateReadingCard(8); assert.equal(calls.length, count, "an in-flight flip cannot open detail or restart");
  state.drawRitual.isOpen = true; state.activateReadingCard(8); assert.equal(calls.length, count);
});

test("each revealed name appears in overview; hidden cards never disclose identity", () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; }
    replaceChildren() { this.children = []; }
    append(...items) { this.children.push(...items); }
    contains(element) { return this.children.includes(element); }
    setAttribute(name, value) { this[name] = value; }
  }
  const elements = new Map();
  const get = (id) => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const session = { spreadId: "free-2", method: "manual", drawCount: 2, draws: [{ index: 0, faceUp: true, reversed: true }, { index: 1, faceUp: false, reversed: false }], cut: { index: 2, faceUp: true, reversed: false } };
  const state = bind(["readingEntries", "updateReadingResult"], {
    readingResult: { session, detail: null }, readingFlips: new Map(), exportingReading: false, activeMode: "cards", inspection: new Element(), revealingResult: null,
    syncReadingArtifactVisibility() {}, getDrawSpread, getCardDisplayName,
    CARDS: [{ name: "THE FOOL" }, { name: "SECRET CARD" }, { name: "THE STAR" }],
    document: { querySelector: get, createElement: () => new Element(), activeElement: null },
  });
  state.updateReadingResult();
  assert.equal(get("#reading-question").hidden, true, "blank questions are omitted");
  const literalQuestion = "<img src=x onerror=alert(1)>\n未來，我想如何前進？";
  session.question = `  ${literalQuestion}  `;
  state.updateReadingResult();
  assert.equal(get("#reading-question").hidden, false);
  assert.equal(get("#reading-question-text").textContent, literalQuestion, "user input is literal text, never HTML");
  assert.equal(get("#reading-question-text").scrollTop, 0);
  get("#reading-question-text").scrollTop = 18;
  state.readingResult.detail = 0;
  state.updateReadingResult();
  assert.equal(get("#reading-question").hidden, false, "the question remains readable in detail view");
  assert.equal(get("#reading-question-text").scrollTop, 18, "flips and detail refreshes preserve a long note's reading position");
  session.question = "  \n  ";
  state.updateReadingResult();
  assert.equal(get("#reading-question").hidden, true);
  assert.equal(get("#reading-question-text").textContent, "");
  state.readingResult.detail = null;
  const identityLabels = () => get("#spread-result-labels").children.filter((label) => label.dataset.labelSide === "bottom");
  const positionLabels = () => get("#spread-result-labels").children.filter((label) => label.dataset.labelSide === "top");
  const labels = identityLabels();
  assert.deepEqual(labels.map((label) => label.children[0].textContent), ["愚者", "尚未翻牌", "星星"]);
  assert.ok(labels[0].title.includes("THE FOOL"), "original English name is retained in the tooltip");
  assert.ok(labels[0]["aria-label"].includes("逆位"));
  assert.ok(labels[2]["aria-label"].includes("切牌"));
  assert.deepEqual(positionLabels().map((label) => label.children[0].textContent), ["第 1 張", "第 2 張", "切牌"]);
  assert.deepEqual(labels.map((label) => label.children[1].children[0].textContent), ["逆位", "", "正位"]);
  assert.equal(labels[0].children[1].children[0].hidden, false, "orientation must be visible, not tooltip-only");
  assert.equal(labels[1].children[1].children[0].hidden, true);
  assert.equal(labels[1].children[1].children[0].dataset.orientation, undefined, "face-down direction is not exposed");
  assert.ok(!JSON.stringify(labels[1]).includes("SECRET CARD"));
  assert.ok(labels.every((label) => label.type === "button"), "names remain keyboard accessible");

  state.readingFlips.set(0, { result: state.readingResult });
  state.updateReadingResult();
  const turningLabel = identityLabels()[0];
  assert.equal(turningLabel.children[0].textContent, "翻牌中…");
  assert.ok(!JSON.stringify(turningLabel).includes("愚者") && !JSON.stringify(turningLabel).includes("THE FOOL"));
  assert.equal(turningLabel.children[1].children[0].hidden, true);
  state.readingFlips.clear();

  session.draws[0].faceUp = false;
  state.updateReadingResult();
  const faceDownLabel = identityLabels()[0];
  assert.equal(positionLabels()[0].children[0].textContent, "第 1 張");
  assert.equal(faceDownLabel.children[1].children[0].hidden, true);
  assert.ok(!JSON.stringify(faceDownLabel).includes("愚者") && !JSON.stringify(faceDownLabel).includes("THE FOOL"));

  for (const spread of DRAW_SPREADS) {
    session.spreadId = spread.id; session.drawCount = spread.count;
    session.draws = spread.slots.map((_, index) => ({ index, faceUp: true, reversed: index % 2 === 0 }));
    session.cut = { index: spread.count, faceUp: true, reversed: true };
    state.CARDS = Array.from({ length: spread.count + 1 }, (_, index) => ({ name: `ORIGINAL ${index}`, nameZh: `牌組中文名${index}` }));
    for (const detail of [null, 0, session.cut.index]) {
      state.readingResult.detail = detail;
      state.updateReadingResult();
      const allLabels = identityLabels();
      assert.equal(positionLabels().length, spread.count + 1);
      for (const [index, label] of allLabels.entries()) {
        const entry = index === spread.count ? session.cut : session.draws[index];
        assert.equal(label.children[0].textContent, `牌組中文名${index}`);
        assert.equal(positionLabels()[index].children[0].textContent, index === spread.count ? "切牌" : spread.slots[index].label);
        assert.equal(label.children[1].children[0].textContent, entry.reversed ? "逆位" : "正位");
        assert.equal(label.children[1].children[0].hidden, false);
      }
    }
  }
  session.question = "會清除的上一輪問題";
  state.updateReadingResult();
  state.readingResult = null;
  state.readingScroll = {};
  state.updateReadingResult();
  assert.equal(get("#reading-question").hidden, true);
  assert.equal(get("#reading-question-text").textContent, "", "discarding the result clears the question from the DOM");
});

test("scrollable mobile results still rotate through an edge-on frame before revealing names", () => {
  const card = new THREE.Group();
  card.rotation.y = Math.PI;
  Object.assign(card.userData, { cardIndex: 0, frontSurface: { rotation: {} }, frontReflection: { rotation: {} }, reflectionMaterials: [] });
  const entry = { index: 0, faceUp: true, reversed: true };
  const result = { session: { draws: [entry], cut: null }, detail: null };
  const flips = new Map([[0, { result, entry, from: Math.PI, to: 0, startedAt: 0, delay: 0, duration: 720 }]]);
  let refreshes = 0;
  const bounds = { left: 0, top: 0, width: 390, height: 700 };
  const state = bind(["updateReadingCards", "readingScreenCardPose"], {
    THREE, getCardFlipPose, readingResult: result, readingFlips: flips, readingFlipPose: {},
    readingLayoutDirty: false, readingScreenLayout: { scrollable: true, cards: [{ x: 100, y: 200, width: 61, height: 101 }], labelGap: 8, top: 100, bottom: 500 },
    readingEntries: () => [entry], cardMeshes: [card], readingScrollOffset: 0,
    readingLabelPoint: new THREE.Vector3(), readingProjectionPoint: new THREE.Vector3(), ritualPose: {},
    screenToReadingPlane: (x, y, target) => target.set(x / 100, y / 100, 1.05),
    deckCarouselReducedMotion: { matches: false }, selectedCard: 0,
    updateReadingResult: () => refreshes++, measureReadingLayout() {},
    stage: { getBoundingClientRect: () => bounds },
    document: { querySelector: () => ({ getBoundingClientRect: () => bounds }), querySelectorAll: () => [] },
  });
  state.updateReadingCards(1 / 60, 0.36);
  assert.equal(card.rotation.y, Math.PI / 2, "scroll's instant position update must not skip the flip");
  assert.equal(flips.size, 1); assert.equal(refreshes, 0);
  state.updateReadingCards(1 / 60, 0.72);
  assert.equal(card.rotation.y, 0); assert.equal(flips.size, 0); assert.equal(refreshes, 1);
  assert.equal(card.userData.frontSurface.rotation.z, Math.PI, "random reversal survives flipping");
  const hiddenCard = new THREE.Group(), hiddenEntry = { index: 1, faceUp: true, reversed: false };
  hiddenCard.userData.cardIndex = 1;
  result.detail = 0; result.session.draws.push(hiddenEntry);
  state.readingEntries = () => [entry, hiddenEntry]; state.cardMeshes.push(hiddenCard);
  state.readingScreenLayout.detail = state.readingScreenLayout.cards[0];
  flips.set(1, { result, entry: hiddenEntry, from: Math.PI, to: 0, startedAt: 0, delay: 55, duration: 720 });
  state.updateReadingCards(1 / 60, 1.5);
  assert.equal(flips.size, 0, "offscreen cards finish flipping so detail view can export all cards");
  assert.equal(hiddenCard.visible, false); assert.equal(hiddenCard.rotation.y, 0);
});

test("arrival uses final measured card positions, remains face down and never shows unselected cards", () => {
  const session = { drawCount: 2, selectedIndex: 0, draws: [{ index: 0 }, { index: 1 }], cut: { index: 2 } };
  const visual = { phase: "revealing", journeyActive: true, journeyArrival: 0 };
  const cards = [0, 1, 2, 3].map((index) => {
    const card = new THREE.Group(); Object.assign(card.userData, { cardIndex: index, reflectionMaterials: [] }); return card;
  });
  let measurements = 0;
  const destinations = new Map();
  const rects = [{ x: 100, y: 180, height: 101 }, { x: 200, y: 180, height: 101 }, { x: 30, y: 510, height: 60 }];
  const state = bind(["updateRitualCards", "readingScreenCardPose"], {
    THREE, readingArrivalEnvelope, drawRitual: { visual, session }, readingResult: null,
    readingJourney: { setTarget(slot, pose, clip) { destinations.set(slot, { ...pose, clip }); } }, cardMeshes: cards,
    readingLayoutDirty: true, readingScreenLayout: null, readingScrollOffset: 0,
    readingLabelPoint: new THREE.Vector3(), readingProjectionPoint: new THREE.Vector3(), ritualPose: {},
    screenToReadingPlane: (x, y, target) => target.set(x / 100, -y / 100, 1.05),
    deckCarouselReducedMotion: { matches: false }, updateReadingResult() {},
    measureReadingLayout() {
      measurements++; state.readingLayoutDirty = false;
      state.readingScreenLayout = { cards: rects.slice(0, 2), cut: rects[2], scrollable: false };
    },
  });
  state.updateRitualCards(1 / 60, 2);
  assert.ok(cards.every((card) => !card.visible)); assert.equal(measurements, 0);
  visual.journeyArrival = .5; state.updateRitualCards(1 / 60, 5.9);
  assert.equal(state.readingResult.session, session); assert.equal(measurements, 1);
  assert.ok(cards.every((card) => !card.visible), "real sharp cards cannot overwrite the returning light points");
  assert.equal(destinations.size, 3, "destinations are available while the real backs remain hidden");
  state.stage = { clientHeight: 700 }; state.renderer = { getPixelRatio: () => 2 };
  Object.assign(state.readingScreenLayout, { scrollable: true, top: 100, bottom: 490 });
  state.updateRitualCards(1 / 60, 6);
  assert.deepEqual(Array.from(destinations.get(0).clip), [420, 1200], "proxy clipping uses drawing-buffer pixels");
  assert.equal(destinations.get(2).clip, null, "the pinned cut is not clipped with the main cards");
  visual.journeyArrival = 1; state.updateRitualCards(1 / 60, 6.8);
  cards.slice(0, 3).forEach((card, i) => {
    const target = state.readingScreenCardPose(rects[i]);
    assert.equal(card.position.x, target.x); assert.equal(card.position.y, target.y);
    assert.equal(card.position.z, target.z); assert.equal(card.scale.x, target.scale);
    assert.equal(card.rotation.y, Math.PI);
  });
  assert.equal(cards[3].visible, false);
});

test("result markup removes the bottom numeric/cut strip and binds background return", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["reading-card-list", "reading-overview"]) {
    assert.ok(!html.includes(`id="${id}"`)); assert.ok(!source.includes(`querySelector("#${id}")`));
  }
  assert.ok(source.includes("if (!hit) { showReadingOverview(); return; }"));
  assert.ok(source.includes("readingLabelPoint.y += card.scale.y * 0.505"));
  assert.ok(source.includes('if (event.target.closest?.("#reading-question")) return;'), "question scroll keys cannot flip a card");
});

test("clipped main cards cannot intercept the pinned cut or blank-space clicks", () => {
  const cards = [0, 1, 2].map((index) => ({ visible: index !== 1, userData: { cardIndex: index } }));
  const state = bind(["readingPickTargets"], {
    cardMeshes: cards, isReadingScrollable: () => true, readingScreenLayout: { top: 100, bottom: 400 },
    stage: { getBoundingClientRect: () => ({ top: 40 }) }, readingResult: { session: { cut: { index: 2 } } },
  });
  assert.deepEqual(Array.from(state.readingPickTargets({ clientY: 60 })), [cards[2]]);
  assert.deepEqual(Array.from(state.readingPickTargets({ clientY: 470 })), [cards[2]]);
  assert.deepEqual(Array.from(state.readingPickTargets({ clientY: 200 })), [cards[0], cards[2]]);
  state.isReadingScrollable = () => false; state.readingResult = null;
  assert.equal(state.readingPickTargets({ clientY: 60 }).length, 2, "normal browsing remains unrestricted");
});

test("scroll rendering clips only main cards and always restores scene state", () => {
  for (const failSecondPass of [false, true]) {
    const main = { visible: true, userData: { cardIndex: 0 } }, cut = { visible: true, userData: { cardIndex: 1 } };
    const decoration = { visible: true }, hiddenBox = { visible: false }, light = { visible: true, isLight: true }, group = { visible: true };
    const snapshots = [], scissors = [];
    const renderer = { autoClear: true, scissorTest: false,
      render() {
        snapshots.push([main.visible, cut.visible, decoration.visible, hiddenBox.visible, light.visible, this.autoClear, this.scissorTest]);
        if (failSecondPass && snapshots.length === 2) throw new Error("render failed");
      },
      setScissor(...values) { scissors.push(values); },
      setScissorTest(value) { this.scissorTest = value; }, clearDepth() {},
    };
    const state = bind(["renderStageScene"], { renderer, isReadingScrollable: () => true, drawRitual: null,
      scene: { children: [group, decoration, hiddenBox, light] }, camera: {}, cardsGroup: group, cardMeshes: [main, cut],
      stage: { clientWidth: 390, clientHeight: 619 }, readingScreenLayout: { top: 110, bottom: 420 },
      readingResult: { session: { draws: [{ index: 0 }], cut: { index: 1 } } },
    });
    if (failSecondPass) assert.throws(() => state.renderStageScene(), /render failed/);
    else state.renderStageScene();
    assert.deepEqual(snapshots, [[false, true, true, false, true, true, false], [true, false, false, false, true, false, true]]);
    assert.deepEqual(scissors, [[0, 199, 390, 310]]);
    assert.ok(main.visible && cut.visible && decoration.visible && !hiddenBox.visible && light.visible);
    assert.ok(renderer.autoClear && !renderer.scissorTest);
  }
});

test("mobile arrival mist renders after the sharp backs, with overlay and scissor state restored even on failure", () => {
  for (const failOverlay of [false, true]) {
    const main = { visible: true, userData: { cardIndex: 0 } }, cut = { visible: true, userData: { cardIndex: 1 } };
    const overlay = { visible: true }, background = { visible: true }, group = { visible: true };
    const session = { draws: [{ index: 0 }], cut: { index: 1 } }, snapshots = [];
    const renderer = { autoClear: true, scissorTest: false,
      render() {
        snapshots.push([main.visible, cut.visible, overlay.visible, background.visible, this.scissorTest]);
        if (failOverlay && snapshots.length === 3) throw new Error("overlay failed");
      },
      setScissor() {}, setScissorTest(value) { this.scissorTest = value; }, clearDepth() {},
    };
    const state = bind(["renderStageScene"], { renderer, isReadingScrollable: () => false,
      drawRitual: { isOpen: true, visual: { journeyArrival: .9 }, session }, readingJourney: { arrivalLayer: overlay },
      scene: { children: [group, background, overlay] }, camera: {}, cardsGroup: group, cardMeshes: [main, cut],
      stage: { clientWidth: 390, clientHeight: 700 }, readingScreenLayout: { scrollable: true, top: 100, bottom: 490 },
      readingResult: { session },
    });
    if (failOverlay) assert.throws(() => state.renderStageScene(), /overlay failed/);
    else state.renderStageScene();
    assert.deepEqual(snapshots, [[false, true, false, true, false], [true, false, false, false, true], [false, false, true, false, false]]);
    assert.ok(main.visible && cut.visible && overlay.visible && background.visible);
    assert.ok(renderer.autoClear && !renderer.scissorTest);
  }
});

test("canvas and name scrolling preserve taps, suppress drags and support wheel units", () => {
  const handlers = new Map(), captures = [];
  const surface = { addEventListener(name, handler) { handlers.set(name, handler); }, setPointerCapture(id) { captures.push(["surface", id]); } };
  const button = { setPointerCapture(id) { captures.push(["name", id]); } };
  const state = bind(["bindReadingScrollGestures"], { isReadingScrollable: () => true, readingPan: null,
    readingScroll: { scrollTop: 0 }, readingScreenLayout: { viewportHeight: 300 }, SCENE_TAP_MAX_MOVE_PX: 7 });
  state.bindReadingScrollGestures(surface);
  let prevented = 0, stopped = 0;
  const event = (values = {}) => ({ button: 0, pointerId: 1, clientX: 20, clientY: 150, detail: 1,
    preventDefault() { prevented++; }, stopImmediatePropagation() { stopped++; }, ...values });
  handlers.get("pointerdown")(event({ target: { closest: () => button } }));
  handlers.get("pointerup")(event()); handlers.get("click")(event());
  assert.deepEqual(captures, [["name", 1]], "name tap keeps the button as click target");
  assert.equal(stopped, 0);
  handlers.get("pointerdown")(event()); handlers.get("pointermove")(event({ clientY: 100 }));
  handlers.get("pointerup")(event()); handlers.get("click")(event());
  assert.equal(state.readingScroll.scrollTop, 50); assert.equal(stopped, 1);
  handlers.get("wheel")(event({ deltaY: 2, deltaMode: 1 })); assert.equal(state.readingScroll.scrollTop, 82);
  handlers.get("wheel")(event({ deltaY: 1, deltaMode: 2 })); assert.equal(state.readingScroll.scrollTop, 382);
  state.isReadingScrollable = () => false;
  handlers.get("wheel")(event({ deltaY: 100 })); assert.equal(state.readingScroll.scrollTop, 382);
  assert.ok(prevented > 0);
  assert.ok(source.includes('bindReadingScrollGestures(document.querySelector("#spread-result-labels"))'));
});
