import test from "node:test";
import assert from "node:assert/strict";
import { createDrawRitual } from "../draw-ritual.js";
import { DRAW_SPREADS } from "../draw-spreads.js";

// Minimal event/element doubles exercise the real controller, without a browser or
// production dependencies. These are state-machine tests, not visual-layout QA.
function harness(t, { method = "manual", prepareSelection = async () => {} } = {}) {
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
  get("draw-ritual").hidden = true; get("draw-spread").value = "single";
  const commits = [], preparations = []; let cancelled = 0;
  const controller = createDrawRitual({
    getContext: () => ({ deckKey: "test", name: "Test deck", backUrl: "back.webp" }), onOpen() {},
    loadDeck: async () => Array.from({ length: 78 }, (_, index) => ({ id: `card-${index}` })),
    startAnimation() {}, cancelAnimation() { cancelled++; }, focusResult() {}, focusChoices() {},
    prepareSelection: async (indices, session) => { preparations.push({ indices, session }); await prepareSelection(indices, session); },
    commitSelection: (index, session) => commits.push({ index, session }),
  });
  async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  function advance(milliseconds) { now += milliseconds; const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback(now)); }
  async function start(spread = "free-3") {
    controller.open(); get("draw-spread").value = spread; get("draw-start").fire("click"); await settle();
    controller.animationComplete();
    if (method === "manual") get("draw-hold").fire("click");
    advance(2500);
    if (method === "manual") get("draw-collect").fire("click");
    assert.equal(controller.session.phase, "cutting");
  }
  return { controller, get, commits, preparations, start, settle, advance, get cancelled() { return cancelled; } };
}

test("controller completes all fourteen layouts only after cut plus the selected count", async (t) => {
  const h = harness(t);
  assert.equal(h.get("draw-spread").children.length, 14);
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
