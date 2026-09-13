import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { DRAW_SPREADS, getDrawSpread } from "../draw-spreads.js";
import { getCardDisplayName } from "../card-names.js";

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
    artifactStageReady: true, readingResult: {}, activeMode: "cards", activeDeckKey: "woodland",
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
    readingResult: {}, drawRitual: { isOpen: false }, isCardTransitionActive: () => false,
    readingEntries: () => entries, focusReadingCard: (index, detail) => calls.push([index, detail]), flipSelectedCard: () => calls.push("flip"),
  });
  state.activateReadingCard(8); assert.deepEqual(calls, [[8, false], "flip"]);
  entries[0].faceUp = true; state.activateReadingCard(8); assert.deepEqual(calls.at(-1), [8, true]);
  state.activateReadingCard(22); assert.deepEqual(calls.at(-1), [22, true]);
  const count = calls.length; state.activateReadingCard(77); assert.equal(calls.length, count);
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
    readingResult: { session, detail: null }, activeMode: "cards", inspection: new Element(), revealingResult: null,
    syncReadingArtifactVisibility() {}, getDrawSpread, getCardDisplayName,
    CARDS: [{ name: "THE FOOL" }, { name: "SECRET CARD" }, { name: "THE STAR" }],
    document: { querySelector: get, createElement: () => new Element(), activeElement: null },
  });
  state.updateReadingResult();
  const labels = get("#spread-result-labels").children;
  assert.deepEqual(labels.map((label) => label.children[0].textContent), ["愚者", "尚未翻牌", "星星"]);
  assert.ok(labels[0].title.includes("THE FOOL"), "original English name is retained in the tooltip");
  assert.ok(labels[0]["aria-label"].includes("逆位"));
  assert.ok(labels[2]["aria-label"].includes("切牌"));
  assert.deepEqual(labels.map((label) => label.children[1].children[0].textContent), ["第 1 張", "第 2 張", "切牌"]);
  assert.deepEqual(labels.map((label) => label.children[1].children[1].textContent), ["逆位", "", "正位"]);
  assert.equal(labels[0].children[1].children[1].hidden, false, "orientation must be visible, not tooltip-only");
  assert.equal(labels[1].children[1].children[1].hidden, true);
  assert.equal(labels[1].children[1].children[1].dataset.orientation, undefined, "face-down direction is not exposed");
  assert.ok(!JSON.stringify(labels[1]).includes("SECRET CARD"));
  assert.ok(labels.every((label) => label.type === "button"), "names remain keyboard accessible");

  session.draws[0].faceUp = false;
  state.updateReadingResult();
  const faceDownLabel = get("#spread-result-labels").children[0];
  assert.equal(faceDownLabel.children[1].children[0].textContent, "第 1 張");
  assert.equal(faceDownLabel.children[1].children[1].hidden, true);
  assert.ok(!JSON.stringify(faceDownLabel).includes("愚者") && !JSON.stringify(faceDownLabel).includes("THE FOOL"));

  for (const spread of DRAW_SPREADS) {
    session.spreadId = spread.id; session.drawCount = spread.count;
    session.draws = spread.slots.map((_, index) => ({ index, faceUp: true, reversed: index % 2 === 0 }));
    session.cut = { index: spread.count, faceUp: true, reversed: true };
    state.CARDS = Array.from({ length: spread.count + 1 }, (_, index) => ({ name: `ORIGINAL ${index}`, nameZh: `牌組中文名${index}` }));
    for (const detail of [null, 0, session.cut.index]) {
      state.readingResult.detail = detail;
      state.updateReadingResult();
      const allLabels = get("#spread-result-labels").children;
      for (const [index, label] of allLabels.entries()) {
        const entry = index === spread.count ? session.cut : session.draws[index];
        assert.equal(label.children[0].textContent, `牌組中文名${index}`);
        assert.equal(label.children[1].children[0].textContent, index === spread.count ? "切牌" : spread.slots[index].label);
        assert.equal(label.children[1].children[1].textContent, entry.reversed ? "逆位" : "正位");
        assert.equal(label.children[1].children[1].hidden, false);
      }
    }
  }
});

test("result markup removes the bottom numeric/cut strip and binds background return", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const id of ["reading-card-list", "reading-overview"]) {
    assert.ok(!html.includes(`id="${id}"`)); assert.ok(!source.includes(`querySelector("#${id}")`));
  }
  assert.ok(source.includes("if (!hit) { showReadingOverview(); return; }"));
  assert.ok(source.includes("readingLabelPoint.y += card.scale.y * 0.505"));
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
    const state = bind(["renderStageScene"], { renderer, isReadingScrollable: () => true,
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
