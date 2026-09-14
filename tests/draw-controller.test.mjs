import test from "node:test";
import assert from "node:assert/strict";
import { createDrawRitual } from "../draw-ritual.js";
import { DRAW_SPREADS } from "../draw-spreads.js";
import { SHUFFLE_TIMING } from "../ritual-layout.js";
import { READING_JOURNEY_TIMING } from "../reading-journey-timing.js";

// Minimal event/element doubles exercise the real controller, without a browser or
// production dependencies. These are state-machine tests, not visual-layout QA.
function harness(t, { method = "manual", prepareSelection = async () => {}, prefetchSelection = async () => {},
  loadDeck = async () => Array.from({ length: 78 }, (_, index) => ({ id: `card-${index}` })) } = {}) {
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
    loadDeck,
    startAnimation() {}, cancelAnimation() { cancelled++; }, focusResult() {}, focusChoices() {},
    orderChanged(session) { orders.push(session.order.slice()); },
    prefetchSelection: async (indices, session) => { prefetches.push({ indices, session }); await prefetchSelection(indices, session); },
    prepareSelection: async (indices, session) => { preparations.push({ indices, session }); await prepareSelection(indices, session); },
    commitSelection: (index, session) => commits.push({ index, session }),
  });
  async function settle() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
  async function finishDelivery() {
    await settle();
    advance(READING_JOURNEY_TIMING.minimumMs + READING_JOURNEY_TIMING.arrivalMs + 32);
    await settle();
  }
  function stall(milliseconds) { now += milliseconds; const queued = [...frames.values()]; frames.clear(); queued.forEach((callback) => callback(now)); }
  function advance(milliseconds) {
    const end = now + milliseconds;
    while (now < end) stall(Math.min(16, end - now));
  }
  async function begin(spread = "free-3", questionText = "") {
    controller.open();
    get("draw-question").value = questionText;
    get("draw-question").fire("input");
    get("draw-spread-options").children.find((button) => button.dataset.spread === spread).fire("click");
    get(method === "manual" ? "draw-start" : "draw-fate").fire("click"); await settle();
    controller.animationComplete();
  }
  async function start(spread = "free-3", cut = true) {
    await begin(spread);
    if (method === "manual") get("draw-hold").fire("click");
    advance(SHUFFLE_TIMING.durationMs + 100);
    assert.equal(controller.session.phase, "shuffling", "completion waits for explicit cutting");
    if (cut) get("draw-collect").fire("click");
    assert.equal(controller.session.phase, cut ? "cutting" : "shuffling");
  }
  return { controller, get, commits, preparations, prefetches, orders, begin, start, settle, finishDelivery, advance, stall, get cancelled() { return cancelled; } };
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
  h.controller.choose(); await h.finishDelivery();
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
  h.controller.choose(); await h.finishDelivery();
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
    await h.finishDelivery();
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
  h.controller.choose(30); await h.finishDelivery();
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
  h.get("draw-retry").fire("click"); h.get("draw-retry").fire("click"); await h.finishDelivery();
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
    h.advance(SHUFFLE_TIMING.durationMs + 100);
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
  h.advance(SHUFFLE_TIMING.durationMs - 1000 + 100); const completed = h.controller.session;
  hand.fire("pointerup"); hand.fire("click", { detail: 1 });
  assert.equal(h.controller.session, completed);
  hand.fire("pointerdown", { button: 0, pointerId: 3 });
  hand.fire("pointerup"); hand.fire("click", { detail: 1 });
  assert.notEqual(h.controller.session, completed);
  h.advance(SHUFFLE_TIMING.durationMs + 100); assert.equal(h.controller.visual.progress, 1);
});

test("fate can also repeat and suspends timed progress when the document is hidden", async (t) => {
  const h = harness(t, { method: "starlight" }); await h.begin("single");
  h.advance(1000);
  document.hidden = true; document.fire("visibilitychange");
  const progress = h.controller.visual.progress;
  h.advance(20000); assert.equal(h.controller.visual.progress, progress);
  document.hidden = false; document.fire("visibilitychange");
  h.advance(SHUFFLE_TIMING.durationMs - 1000 + 100); assert.equal(h.controller.visual.progress, 1);
  assert.equal(h.get("draw-hold").hidden, false);
  const before = h.controller.session;
  h.get("draw-hold").fire("click"); h.advance(SHUFFLE_TIMING.durationMs + 100);
  assert.notEqual(h.controller.session, before);
  assert.equal(h.controller.session.cut, null);
  h.get("draw-collect").fire("click"); h.controller.choose(8); await h.finishDelivery();
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].session.draws.length, 1);
});

test("held shuffle exposes the central-light interval and delayed frames cannot skip it", async (t) => {
  const h = harness(t); await h.begin();
  h.get("draw-hold").fire("pointerdown", { button: 0, pointerId: 1 });
  h.advance(SHUFFLE_TIMING.chargeStartMs);
  assert.match(h.get("draw-progress-label").textContent, /聚光停留/);
  assert.equal(h.get("draw-collect").hidden, true);
  h.stall(1500);
  assert.equal(Math.round(h.controller.visual.progress * SHUFFLE_TIMING.durationMs), SHUFFLE_TIMING.chargeStartMs + 100);
  assert.match(h.get("draw-progress-label").textContent, /聚光停留/);
  h.get("draw-hold").fire("pointerup");
  const paused = h.controller.visual.progress;
  h.advance(1200); assert.equal(h.controller.visual.progress, paused);
  h.get("draw-hold").fire("pointerdown", { button: 0, pointerId: 2 });
  h.advance(SHUFFLE_TIMING.burstStartMs - SHUFFLE_TIMING.chargeStartMs - 100);
  assert.match(h.get("draw-progress-label").textContent, /聚光停留/);
  h.advance(40); assert.match(h.get("draw-progress-label").textContent, /炸散展開/);
  h.advance(SHUFFLE_TIMING.durationMs);
  assert.equal(h.controller.visual.progress, 1);
  assert.equal(h.controller.session.phase, "shuffling", "bright hold never implicitly cuts the deck");
});

test("optional question survives repeat shuffling, cutting and delivery for both draw methods", async (t) => {
  for (const method of ["manual", "starlight"]) await t.test(method, async (t) => {
    const h = harness(t, { method });
    const question = "未來三個月，適合如何前進？\n我想記住當下的感受。✨";
    await h.begin("free-3", `  ${question}\r\n  `);
    assert.equal(h.controller.session.question, question);
    assert.equal(h.get("draw-question").disabled, true);
    if (method === "manual") h.get("draw-hold").fire("click");
    h.advance(SHUFFLE_TIMING.durationMs + 100);
    h.get("draw-question").value = "hidden input must not change the reading";
    h.get("draw-hold").fire("click");
    assert.equal(h.controller.session.question, question);
    h.advance(SHUFFLE_TIMING.durationMs + 100);
    h.get("draw-collect").fire("click");
    h.controller.choose(7);
    if (method === "manual") { h.advance(500); h.controller.choose(); }
    await h.finishDelivery();
    assert.equal(h.commits.length, 1);
    assert.equal(h.commits[0].session.question, question);
    assert.equal(h.commits[0].session.draws.length, 3);
    h.controller.open();
    assert.equal(h.get("draw-question").value, "", "new readings do not inherit an old question");
    assert.equal(h.get("draw-question-count").textContent, "0 / 200");
    assert.equal(h.get("draw-question").disabled, false);
  });
});

test("whitespace is optional, markup remains text and the question limit never splits a surrogate", async (t) => {
  const h = harness(t);
  for (const [input, expected] of [[" \n\r\n\t", ""], ["<script>alert(1)</script>", "<script>alert(1)</script>"],
    ["問".repeat(205), "問".repeat(200)], ["問".repeat(199) + "✨", "問".repeat(199) + "✨"],
    ["問".repeat(199) + "🌙", "問".repeat(199)]]) {
    await h.begin("single", input);
    assert.equal(h.controller.session.question, expected);
    h.controller.cancel();
  }
});

test("question is captured before slow loading and retained when deck preparation is retried", async (t) => {
  let release, attempts = 0;
  const h = harness(t, { loadDeck: () => {
    attempts++;
    if (attempts === 1) return Promise.reject(new Error("offline"));
    return new Promise((resolve) => { release = resolve; });
  } });
  await h.begin("single", "當下的問題");
  assert.equal(h.get("draw-question").disabled, false);
  assert.equal(h.get("draw-question").value, "當下的問題");
  h.get("draw-retry").fire("click");
  assert.equal(h.get("draw-question").disabled, true);
  h.get("draw-question").value = "later edit";
  release(Array.from({length:78}, (_, i) => ({id:`card-${i}`})));
  await h.settle();
  assert.equal(h.controller.session.question, "當下的問題");
});

test("delivery retry preserves the question and a cancelled preparation cannot leak it to a new round", async (t) => {
  let attempts = 0;
  const h = harness(t, { prepareSelection: async () => { if (++attempts === 1) throw new Error("retry"); } });
  await h.begin("single", "留存這次的問題");
  h.get("draw-hold").fire("click"); h.advance(SHUFFLE_TIMING.durationMs + 100);
  h.get("draw-collect").fire("click"); h.controller.choose(0); h.advance(500); h.controller.choose();
  await h.settle();
  const session = h.controller.session;
  h.get("draw-retry").fire("click"); await h.finishDelivery();
  assert.equal(h.commits[0].session, session);
  assert.equal(h.commits[0].session.question, "留存這次的問題");
  h.controller.open(); h.get("draw-question").value = "cancelled draft";
  h.controller.cancel(); h.controller.open();
  assert.equal(h.get("draw-question").value, "");
});

test("typing line breaks or cancelling IME composition never starts or cancels a reading", (t) => {
  const h = harness(t); h.controller.open();
  h.get("draw-question").value = "目前的問題\n第二行";
  h.get("draw-question").fire("input");
  assert.equal(h.get("draw-question-count").textContent, `${h.get("draw-question").value.length} / 200`);
  h.get("draw-ritual").fire("keydown", {key:"Enter", target:h.get("draw-question")});
  h.get("draw-ritual").fire("keydown", {key:"Escape", isComposing:true, target:h.get("draw-question")});
  assert.equal(h.controller.isOpen, true);
  assert.equal(h.controller.session, null);
  assert.equal(h.cancelled, 0);
});

test("a fast load still waits five visible seconds before backs materialize, with no early commit", async (t) => {
  const h = harness(t); await h.start("free-7"); h.controller.choose(9);
  assert.notEqual(h.controller.visual.journeyActive, true, "manual cutting still leads to choosing, not a forced draw");
  h.advance(400); h.controller.choose(); await h.settle();
  const session = h.controller.session, original = JSON.stringify([session.draws, session.cut]);
  assert.equal(session.draws.length, 7); assert.equal(h.preparations[0].indices.length, 8);
  assert.equal(h.controller.visual.journeyActive, true);
  h.advance(4999); await h.settle();
  assert.equal(h.controller.visual.journeyArrival, 0); assert.equal(h.commits.length, 0);
  h.advance(200); assert.ok(h.controller.visual.journeyArrival > 0);
  assert.equal(h.commits.length, 0, "the luminous arrival has its own time");
  h.advance(READING_JOURNEY_TIMING.arrivalMs); await h.settle();
  assert.equal(h.commits.length, 1); assert.equal(h.commits[0].session, session);
  assert.equal(JSON.stringify([session.draws, session.cut]), original);
  assert.equal(h.controller.visual.journeyActive, false);
});

test("slow textures loop the journey after five seconds and only arrive once ready", async (t) => {
  let release;
  const h = harness(t, { method: "starlight", prepareSelection: () => new Promise((resolve) => { release = resolve; }) });
  await h.start("free-7"); h.controller.choose(1); await h.settle();
  h.advance(10000); await h.settle();
  assert.equal(h.controller.visual.journeyElapsedMs, 10000);
  assert.equal(h.controller.visual.journeyArrival, 0); assert.equal(h.commits.length, 0);
  release(); await h.settle(); h.advance(READING_JOURNEY_TIMING.arrivalMs); await h.settle();
  assert.equal(h.commits.length, 1);
});

test("hidden time and stalled frames cannot skip pursuit; cancelling during arrival cannot commit", async (t) => {
  const h = harness(t, { method: "starlight" }); await h.start("single"); h.controller.choose(1); await h.settle();
  h.advance(1000);
  document.hidden = true; document.fire("visibilitychange"); h.advance(20000);
  document.hidden = false; document.fire("visibilitychange");
  assert.equal(h.controller.visual.journeyElapsedMs, 1000);
  h.stall(10000); assert.equal(h.controller.visual.journeyElapsedMs, 1100);
  h.advance(4500); assert.ok(h.controller.visual.journeyArrival > 0);
  h.controller.cancel(); h.advance(10000); await h.settle();
  assert.equal(h.commits.length, 0); assert.equal(h.controller.visual.journeyActive, false);
  await h.start("free-2"); assert.equal(h.controller.session.drawCount, 2);
  h.controller.cancel();
});
