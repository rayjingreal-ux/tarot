import test from "node:test";
import assert from "node:assert/strict";
import { createDrawRitual } from "../draw-ritual.js";
import { DRAW_SPREADS } from "../draw-spreads.js";

// Minimal event/element doubles exercise the real controller, without a browser or
// production dependencies. These are state-machine tests, not visual-layout QA.
function harness(t, { method = "manual", prepareSelection = async () => {}, prefetchSelection = async () => {} } = {}) {
  const elements = new Map(), frames = new Map(); let now = 0, nextFrame = 0;
  const classes = () => {
    const values = new Set();
    return { add: (...names) => names.forEach((name) => values.add(name)), remove: (...names) => names.forEach((name) => values.delete(name)), toggle: (name, on) => on ? values.add(name) : values.delete(name) };
  };
  class Element {
    constructor(id = "") {
      Object.assign(this, { id, children: [], dataset: {}, style: { setProperty() {} }, classList: classes(), hidden: false, disabled: false, value: "", listeners: new Map(), isConnected: true });
    }
    append(...items) { this.children.push(...items.flatMap((item) => item.fragment ? item.children : [item])); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    focus() { document.activeElement = this; }
    closest() { return null; }
    setPointerCapture() {}
    addEventListener(name, handler) {
      if (!this.listeners.has(name)) this.listeners.set(name, []);
      this.listeners.get(name).push(handler);
    }
    fire(name, event = {}) { this.listeners.get(name)?.forEach((handler) => handler({ target: this, detail: 0, preventDefault() {}, stopPropagation() {}, ...event })); }
    querySelector(selector) {
      if (selector.startsWith("#")) return get(selector.slice(1));
      if (selector.includes(":checked")) return { value: method };
      const position = selector.match(/data-position="(\d+)"/);
      return position ? this.children.find((child) => child.dataset.position === position[1]) ?? null : null;
    }
    querySelectorAll(selector) {
      if (selector === ".draw-choice") return this.children;
      if (selector.includes('name="draw-method"')) return ["manual", "starlight"].map((value) => ({ value, checked: value === method }));
      return [];
    }
  }
  function get(id) { if (!elements.has(id)) elements.set(id, new Element(id)); return elements.get(id); }
  const documentDouble = new Element();
  Object.assign(documentDouble, {
    querySelector: (selector) => get(selector.slice(1)),
    createElement: () => new Element(),
    createDocumentFragment: () => Object.assign(new Element(), { fragment: true }),
    activeElement: get("prepare-draw"),
  });
  const globals = { document: documentDouble, matchMedia: (query) => ({ matches: query.includes("prefers-reduced-motion") }), performance: { now: () => now }, requestAnimationFrame: (callback) => { frames.set(++nextFrame, callback); return nextFrame; }, cancelAnimationFrame: (id) => frames.delete(id), getComputedStyle: () => ({ visibility: "visible", display: "block" }) };
  const saved = Object.fromEntries(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  t.after(() => { for (const [key, descriptor] of Object.entries(saved)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  get("draw-ritual").hidden = true;
  const commits = [], preparations = [], prefetches = [], orders = []; let cancelled = 0;
  const controller = createDrawRitual({
    getContext: () => ({ deckKey: "test", name: "Test deck", backUrl: "back.webp" }), onOpen() {},
    loadDeck: async () => Array.from({ length: 78 }, (_, index) => ({ id: `card-${index}` })),
    startAnimation() {}, cancelAnimation() { cancelled++; }, focusResult() {}, focusChoices() {},
    orderChanged(session) { orders.push(session.order.slice()); },
    prefetchSelection: async (indices, session) => { prefetches.push({ indices, session }); await prefetchSelection(indices, session); },
    prepareSelection: async (indices, session) => { preparations.push({ indices, session }); await prepareSelection(indices, session); },
    commitSelection: (index, session) => commits.push({ index, session }),
  });
  async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  function advance(milliseconds) { now += milliseconds; const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback(now)); }
  async function begin(spread = "free-3") {
    controller.open();
    get("draw-spread-options").children.find((button) => button.dataset.spread === spread).fire("click");
    get(method === "manual" ? "draw-start" : "draw-fate").fire("click"); await settle();
    controller.animationComplete();
  }
  async function start(spread = "free-3", cut = true) {
    await begin(spread);
    if (method === "manual") get("draw-hold").fire("click");
    advance(4500);
    assert.equal(controller.session.phase, "shuffling", "completion waits for explicit cutting");
    if (cut) get("draw-collect").fire("click");
    assert.equal(controller.session.phase, cut ? "cutting" : "shuffling");
  }
  return { controller, get, commits, preparations, prefetches, orders, begin, start, settle, advance, get cancelled() { return cancelled; } };
}

test("only confirmed cut and newly selected faces are prefetched, never the full ring", async (t) => {
  const h = harness(t, { prefetchSelection: async () => { throw new Error("optional prefetch failed"); } });
  await h.start("free-3"); assert.equal(h.prefetches.length, 0);
  h.controller.choose(7); await h.settle();
  assert.deepEqual(h.prefetches[0].indices, [h.controller.session.cut.index]);
  h.advance(500); h.controller.focusChoice(12, false); await h.settle();
  assert.equal(h.prefetches.length, 1, "previewing a back does not download its face");
  h.controller.choose(12); await h.settle();
  assert.deepEqual(h.prefetches[1].indices, [h.controller.session.draws[0].index]);
  h.controller.choose(); await h.settle();
  assert.equal(h.commits.length, 1, "prefetch errors do not prevent authoritative delivery");
  assert.equal(h.prefetches.flatMap((item) => item.indices).length, 4);
  assert.equal(new Set(h.prefetches.flatMap((item) => item.indices)).size, 4);
});

test("cancel before the prefetch microtask prevents stale face downloads", async (t) => {
  const h = harness(t); await h.start();
  h.controller.choose(7); h.controller.cancel(); await h.settle();
  assert.equal(h.prefetches.length, 0); assert.equal(h.commits.length, 0);
});

test("double-clicking the centre preview does not accidentally draw the next card", async (t) => {
  const h = harness(t); await h.start(); h.controller.choose(7); h.advance(500);
  h.controller.choose(12); h.controller.choose(13);
  assert.equal(h.controller.session.draws.length, 1);
  h.advance(350); h.controller.choose(13);
  assert.equal(h.controller.session.draws.length, 2);
  h.controller.choose(); await h.settle();
  assert.equal(h.commits.length, 1, "explicit auto-fill remains available during tap cooldown");
});

test("controller completes all fourteen layouts only after cut plus the selected count", async (t) => {
  const h = harness(t);
  assert.equal(h.get("draw-spread-options").children.length, 14);
  for (const spread of DRAW_SPREADS) {
    await h.start(spread.id);
    assert.equal(h.controller.session.draws.length, 0);
    h.controller.choose(9);
    assert.equal(h.controller.session.cut.position, 9);
    assert.equal(h.controller.session.draws.length, 0);
    h.controller.choose(9);
    assert.equal(h.controller.session.draws.length, 0, "cut double-click cannot pick a main card");
    h.advance(500);
    h.controller.choose(4);
    if (spread.count > 1) h.controller.choose();
    await h.settle();
    const delivered = h.commits.at(-1).session;
    assert.equal(delivered.draws.length, spread.count);
    assert.equal(new Set(h.preparations.at(-1).indices).size, spread.count + 1);
    assert.equal(h.commits.at(-1).index, delivered.draws[0].index);
    assert.equal(h.controller.isOpen, false);
  }
  assert.equal(h.commits.length, 14);
});

test("starlight waits for a cut, then fills the spread without exposing card identities", async (t) => {
  const h = harness(t, { method: "starlight" }); await h.start("houses");
  assert.equal(h.commits.length, 0);
  assert.ok(h.get("draw-card-track").children.every((button) => !button["aria-label"].includes("card-")));
  h.controller.choose(30); await h.settle();
  assert.equal(h.commits[0].session.draws.length, 13);
  assert.equal(h.preparations[0].indices.length, 14);
  assert.ok([...h.commits[0].session.draws, h.commits[0].session.cut].every((entry) => !entry.faceUp && !entry.revealed));
});

test("delivery retry retains the same cut, chosen order and orientations, with one commit", async (t) => {
  let attempts = 0;
  const h = harness(t, { prepareSelection: async () => { if (++attempts === 1) throw new Error("texture unavailable"); } });
  await h.start(); h.controller.choose(10); h.advance(500); h.controller.choose(); await h.settle();
  const selected = h.controller.session, snapshot = JSON.stringify([selected.draws, selected.cut]);
  assert.equal(h.get("draw-error").hidden, false); assert.equal(h.commits.length, 0);
  h.get("draw-retry").fire("click"); h.get("draw-retry").fire("click"); await h.settle();
  assert.equal(attempts, 2); assert.equal(h.commits.length, 1);
  assert.equal(h.commits[0].session, selected);
  assert.equal(JSON.stringify([selected.draws, selected.cut]), snapshot);
});

test("cancel during preparation prevents stale delivery and supports a fresh round", async (t) => {
  let release;
  const h = harness(t, { prepareSelection: () => new Promise((resolve) => { release = resolve; }) });
  await h.start(); h.controller.choose(0); h.advance(500); h.controller.choose(); await h.settle();
  h.controller.cancel(); release(); await h.settle();
  assert.equal(h.commits.length, 0); assert.equal(h.cancelled, 1); assert.equal(h.controller.session, null);
  await h.start("free-2"); assert.equal(h.controller.session.cut, null); assert.equal(h.controller.session.draws.length, 0);
  h.controller.cancel();
});

test("light hand repeats complete cycles with a fresh random order, and never cuts automatically", async (t) => {
  const h = harness(t); await h.start("free-7", false);
  let previous = h.controller.session;
  for (let cycle = 0; cycle < 4; cycle++) {
    assert.equal(h.get("draw-hold").disabled, false);
    assert.equal(h.get("draw-collect").hidden, false);
    h.get("draw-hold").fire("click");
    assert.notEqual(h.controller.session, previous);
    assert.notDeepEqual(h.controller.session.order, previous.order);
    assert.equal(h.controller.session.spreadId, "free-7");
    assert.equal(h.controller.session.cut, null);
    assert.deepEqual(h.controller.session.draws, []);
    assert.equal(h.get("draw-collect").hidden, true);
    h.get("draw-collect").fire("click");
    assert.equal(h.controller.session.phase, "shuffling", "cannot cut partway through a repeat");
    h.advance(4500);
    assert.equal(h.controller.visual.progress, 1);
    assert.equal(h.controller.session.phase, "shuffling");
    previous = h.controller.session;
  }
  assert.equal(h.orders.length, 4);
  h.get("draw-collect").fire("click");
  assert.equal(h.controller.session.phase, "cutting");
  h.get("draw-hold").fire("click");
  assert.equal(h.controller.session, previous, "hidden hand cannot alter the cutting round");
});

test("releasing a completed hold does not replay; a new pointer click does", async (t) => {
  const h = harness(t); await h.begin();
  const hand = h.get("draw-hold");
  hand.fire("pointerdown", { button: 0, pointerId: 1 });
  h.advance(1000); hand.fire("pointerup");
  const paused = h.controller.visual.progress;
  h.advance(2000); assert.equal(h.controller.visual.progress, paused);
  hand.fire("pointerdown", { button: 0, pointerId: 2 });
  h.advance(3500); const completed = h.controller.session;
  hand.fire("pointerup"); hand.fire("click", { detail: 1 });
  assert.equal(h.controller.session, completed);
  hand.fire("pointerdown", { button: 0, pointerId: 3 });
  hand.fire("pointerup"); hand.fire("click", { detail: 1 });
  assert.notEqual(h.controller.session, completed);
  h.advance(4500); assert.equal(h.controller.visual.progress, 1);
});

test("fate can also repeat and suspends timed progress when the document is hidden", async (t) => {
  const h = harness(t, { method: "starlight" }); await h.begin("single");
  h.advance(1000);
  document.hidden = true; document.fire("visibilitychange");
  const progress = h.controller.visual.progress;
  h.advance(20000); assert.equal(h.controller.visual.progress, progress);
  document.hidden = false; document.fire("visibilitychange");
  h.advance(3500); assert.equal(h.controller.visual.progress, 1);
  assert.equal(h.get("draw-hold").hidden, false);
  const before = h.controller.session;
  h.get("draw-hold").fire("click"); h.advance(4500);
  assert.notEqual(h.controller.session, before);
  assert.equal(h.controller.session.cut, null);
  h.get("draw-collect").fire("click"); h.controller.choose(8); await h.settle();
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].session.draws.length, 1);
});
