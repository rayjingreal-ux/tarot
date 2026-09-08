import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  autoPickDrawCard,
  createDrawSession,
  markDrawRevealed,
  pickDrawCard,
} from "../draw-session.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DECK_INDEX_PATH = resolve(ROOT, "assets", "decks-manifest.json");
const DECK_INDEX = JSON.parse(readFileSync(DECK_INDEX_PATH, "utf8"));

function loadRealDeck(deckKey) {
  const deck = DECK_INDEX.decks.find(({ id }) => id === deckKey);
  assert.ok(deck, `Expected ${deckKey} in the real deck manifest.`);

  const path = resolve(dirname(DECK_INDEX_PATH), deck.cardManifest);
  return JSON.parse(readFileSync(path, "utf8"));
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

test("real manifests produce one shuffled index per drawable concept", () => {
  const expectedConceptCounts = {
    unveiled: 80,
    woodland: 78,
    redvisions: 78,
    prosepoem: 78,
  };

  for (const [deckKey, expectedCount] of Object.entries(expectedConceptCounts)) {
    const cards = loadRealDeck(deckKey);
    const session = createDrawSession({
      deckKey,
      cards,
      random: seededRandom(20260909),
    });

    assert.equal(session.deckKey, deckKey);
    assert.equal(session.method, "manual");
    assert.equal(session.question, "");
    assert.equal(session.phase, "setup");
    assert.equal(session.selectedIndex, null);
    assert.equal(session.selectedId, null);
    assert.equal(session.order.length, expectedCount);
    assert.equal(new Set(session.order).size, expectedCount);
    assert.ok(session.order.every((index) => Number.isInteger(index) && index >= 0 && index < cards.length));
  }
});

test("Unveiled keeps both exclusive cards as independent draw concepts", () => {
  const cards = loadRealDeck("unveiled");
  const session = createDrawSession({ deckKey: "unveiled", cards, random: () => 0.5 });
  const names = new Set(session.order.map((index) => cards[index].name));

  assert.ok(names.has("The Mob"));
  assert.ok(names.has("The Puppeteer"));
  assert.equal(session.order.length, cards.length);
});

test("Prose Poem chooses exactly one equally selectable file from each explicit variant pair", () => {
  const cards = loadRealDeck("prosepoem");
  const hierophantA = cards.findIndex(({ name }) => name === "The Hierophant A");
  const hierophantB = cards.findIndex(({ name }) => name === "The Hierophant B");
  const swordsA = cards.findIndex(({ name }) => name === "10 of Swords A");
  const swordsB = cards.findIndex(({ name }) => name === "10 of Swords B");

  const low = createDrawSession({ deckKey: "prosepoem", cards, random: () => 0 });
  const high = createDrawSession({ deckKey: "prosepoem", cards, random: () => 0.999999 });

  assert.equal(low.order.length, 78);
  assert.equal(high.order.length, 78);
  assert.ok(low.order.includes(hierophantA));
  assert.ok(!low.order.includes(hierophantB));
  assert.ok(low.order.includes(swordsA));
  assert.ok(!low.order.includes(swordsB));
  assert.ok(!high.order.includes(hierophantA));
  assert.ok(high.order.includes(hierophantB));
  assert.ok(!high.order.includes(swordsA));
  assert.ok(high.order.includes(swordsB));

  low.phase = "selecting";
  high.phase = "selecting";
  pickDrawCard(low, low.order.indexOf(hierophantA));
  pickDrawCard(high, high.order.indexOf(hierophantB));
  assert.notEqual(low.selectedId, high.selectedId);
  assert.equal(low.canonicalId, high.canonicalId);
});

test("Fisher-Yates order is deterministic with an injected random source", () => {
  const cards = ["zero", "one", "two", "three"].map((name) => ({ name }));
  const session = createDrawSession({ deckKey: "sample", cards, random: () => 0 });

  assert.deepEqual(session.order, [1, 2, 3, 0]);
});

test("manual selection resolves the shuffled position once and records stable identity", () => {
  const cards = [
    { id: "explicit-zero", name: "Zero", file: "cards/zero.webp" },
    { name: "One", file: "cards/one.webp" },
    { name: "Two" },
  ];
  const session = createDrawSession({
    deckKey: "sample",
    cards,
    method: "starlight",
    question: "What should I notice?",
    random: () => 0.75,
  });

  assert.throws(() => pickDrawCard(session, 0), /only be selected.*selecting/i);

  session.phase = "selecting";
  const position = session.order.indexOf(1);
  assert.equal(pickDrawCard(session, position), 1);
  assert.equal(session.phase, "revealing");
  assert.equal(session.selectedIndex, 1);
  assert.equal(session.selectedId, "sample:cards/one.webp");
  assert.equal(session.canonicalId, session.selectedId);

  assert.throws(() => pickDrawCard(session, position), /only be selected.*selecting/i);
  session.phase = "selecting";
  assert.throws(() => pickDrawCard(session, position), /already has a selected card/i);
});

test("an explicit card id takes precedence over its file fallback", () => {
  const cards = [
    { id: "kept-id", name: "First", file: "cards/first.webp" },
    { name: "Second", file: "cards/second.webp" },
  ];
  const session = createDrawSession({ deckKey: "sample", cards, random: () => 0.999 });
  session.phase = "selecting";

  pickDrawCard(session, session.order.indexOf(0));
  assert.equal(session.selectedId, "kept-id");
});

test("automatic selection takes the first shuffled entry", () => {
  const cards = [{ name: "First" }, { name: "Second" }, { name: "Third" }];
  const session = createDrawSession({ deckKey: "sample", cards, random: seededRandom(7) });
  const expectedIndex = session.order[0];
  session.phase = "selecting";

  assert.equal(autoPickDrawCard(session), expectedIndex);
  assert.equal(session.selectedIndex, expectedIndex);
  assert.equal(session.phase, "revealing");
});

test("revealing advances to complete and complete is idempotent", () => {
  const session = createDrawSession({ deckKey: "sample", cards: [{ name: "Only" }] });
  assert.throws(() => markDrawRevealed(session), /only be completed.*revealing/i);

  session.phase = "selecting";
  autoPickDrawCard(session);
  assert.equal(markDrawRevealed(session), session);
  assert.equal(session.phase, "complete");
  assert.equal(markDrawRevealed(session), session);
  assert.equal(session.phase, "complete");
});

test("invalid session creation inputs fail explicitly", () => {
  assert.throws(() => createDrawSession(), /deckKey/i);
  assert.throws(() => createDrawSession({ deckKey: " ", cards: [] }), /deckKey/i);
  assert.throws(() => createDrawSession({ deckKey: "x", cards: null }), /cards must be an array/i);
  assert.throws(() => createDrawSession({ deckKey: "x", cards: [] }), /at least one card/i);
  assert.throws(
    () => createDrawSession({ deckKey: "x", cards: [{ name: "One" }], method: "automatic" }),
    /manual.*starlight/i,
  );
  assert.throws(
    () => createDrawSession({ deckKey: "x", cards: [{ name: "One" }], question: null }),
    /question must be a string/i,
  );
  assert.throws(
    () => createDrawSession({ deckKey: "x", cards: [{ name: "One" }], random: 0.5 }),
    /random must be a function/i,
  );
  assert.throws(() => createDrawSession({ deckKey: "x", cards: [null] }), /card object/i);
  assert.throws(() => createDrawSession({ deckKey: "x", cards: [{}] }), /id, file, or name/i);
  assert.throws(
    () => createDrawSession({ deckKey: "x", cards: [{ id: "same" }, { id: "same" }] }),
    /duplicate stable id/i,
  );
  assert.throws(
    () => createDrawSession({ deckKey: "x", cards: [{ name: "One" }, { name: "Two" }], random: () => 1 }),
    /0 \(inclusive\).*1 \(exclusive\)/i,
  );
});

test("invalid selection positions and foreign sessions are rejected", () => {
  assert.throws(() => pickDrawCard({}, 0), /not created by createDrawSession/i);

  for (const position of [-1, 0.5, 2]) {
    const session = createDrawSession({
      deckKey: "sample",
      cards: [{ name: "One" }, { name: "Two" }],
      random: () => 0.5,
    });
    session.phase = "selecting";
    assert.throws(
      () => pickDrawCard(session, position),
      Number.isInteger(position) ? /outside the shuffled draw order/i : /must be an integer/i,
    );
  }

  const corrupted = createDrawSession({ deckKey: "sample", cards: [{ name: "One" }] });
  corrupted.phase = "selecting";
  corrupted.order[0] = 99;
  assert.throws(() => autoPickDrawCard(corrupted), /valid catalog index/i);
});
