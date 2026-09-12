import test from "node:test";
import assert from "node:assert/strict";
import { createDrawSession, cutDrawDeck, pickDrawCard, autoPickDrawCard, availableDrawPositions, markDrawRevealed } from "../draw-session.js";
import { DRAW_SPREADS, getDrawSpread, getReadingCardPose } from "../draw-spreads.js";

const cards = Array.from({ length: 78 }, (_, index) => ({ id: `card-${index}`, name: `Card ${index}` }));
function seeded(seed) { let value = seed; return () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value / 2 ** 32; }; }
function setup(count = 3, random = seeded(24)) { return createDrawSession({ deckKey: "sample", cards, drawCount: count, requireCut: true, random }); }

test("exactly fourteen options have confirmed main-card counts, excluding cutting", () => {
  assert.equal(DRAW_SPREADS.length, 14);
  assert.deepEqual(DRAW_SPREADS.map((spread) => spread.count), [1,2,3,5,7,3,4,4,5,7,5,7,5,13]);
  assert.equal(new Set(DRAW_SPREADS.map((spread) => spread.id)).size, 14);
  assert.throws(() => getDrawSpread("unknown"), /Unknown spread/);
});

test("cut rotates the shuffled deck, excludes cut card, and can only happen once", () => {
  const session = setup(); const original = [...session.order];
  assert.throws(() => cutDrawDeck(session, 12), /once before drawing/);
  session.phase = "cutting";
  const cut = cutDrawDeck(session, 12);
  assert.equal(cut.index, original[12]);
  assert.deepEqual(session.order, [...original.slice(13), ...original.slice(0,12)]);
  assert.equal(session.order.length, 77);
  assert.ok(!session.order.includes(cut.index));
  assert.equal(session.draws.length, 0);
  assert.throws(() => cutDrawDeck(session, 0), /once before drawing/);
});

test("all spreads draw exact distinct main cards plus one separate cut, never in catalog order", () => {
  for (const spread of DRAW_SPREADS) {
    const session = setup(spread.count); session.phase = "cutting"; cutDrawDeck(session, 8);
    const expected = [...session.order].slice(0, spread.count);
    while (session.phase === "selecting") autoPickDrawCard(session);
    assert.deepEqual(session.draws.map((entry) => entry.index), expected);
    assert.equal(session.draws.length, spread.count);
    assert.equal(new Set([...expected, session.cut.index]).size, spread.count + 1);
    assert.equal(session.phase, "revealing");
    assert.throws(() => autoPickDrawCard(session), /only be selected/);
  }
});

test("manual picking records click order, rejects duplicates, and auto-fill keeps earlier picks", () => {
  const session = setup(5); session.phase = "cutting"; cutDrawDeck(session, 10);
  const expected = [session.order[30], session.order[5], session.order[0], session.order[1], session.order[2]];
  pickDrawCard(session, 30); pickDrawCard(session, 5);
  assert.throws(() => pickDrawCard(session, 5), /already been selected/);
  assert.ok(!availableDrawPositions(session).includes(30));
  while (session.phase === "selecting") autoPickDrawCard(session);
  assert.deepEqual(session.draws.map((entry) => entry.index), expected);
});

test("random orientations are independent and may be all upright, all reversed or mixed", () => {
  for (const [random, reversed] of [[() => 0.1, true], [() => 0.9, false]]) {
    const session = setup(13, random); session.phase = "cutting"; cutDrawDeck(session, 0);
    while (session.phase === "selecting") autoPickDrawCard(session);
    assert.ok([...session.draws, session.cut].every((entry) => entry.reversed === reversed));
  }
  const session = setup(13); session.phase = "cutting"; cutDrawDeck(session, 4);
  while (session.phase === "selecting") autoPickDrawCard(session);
  assert.equal(new Set(session.draws.map((entry) => entry.reversed)).size, 2);
  const frozen = session.draws.map((entry) => entry.reversed);
  session.draws.forEach((entry) => markDrawRevealed(session, entry.index));
  assert.deepEqual(session.draws.map((entry) => entry.reversed), frozen);
  assert.equal(session.phase, "revealing", "cut is also waiting to be revealed");
  markDrawRevealed(session, session.cut.index);
  assert.equal(session.phase, "complete");
});

test("draw requires cutting and reserves capacity for the extra cut card", () => {
  const session = setup(); session.phase = "selecting";
  assert.throws(() => pickDrawCard(session, 0), /must be cut/);
  for (const drawCount of [0, 78, 1.5]) assert.throws(() => setup(drawCount), /drawCount/);
});

test("spread and cut poses stay finite and within portrait and desktop stage bounds", () => {
  for (const aspect of [390/667, 820/500, 1707/932, 0.35, 3.5]) {
    const frameH = 2 * 5.75 * Math.tan(16 * Math.PI / 180), frameW = frameH * aspect;
    for (const spread of DRAW_SPREADS) {
      const poses = spread.slots.map((_, slot) => getReadingCardPose({ spread, slot, aspect }));
      for (const pose of poses) {
        for (const field of ["x","y","z","rx","ry","rz","scale"]) assert.ok(Number.isFinite(pose[field]));
        assert.ok(Math.abs(pose.x) + pose.scale * .305 < frameW / 2);
        assert.ok(Math.abs(pose.y) + pose.scale * .505 < frameH / 2);
        assert.equal(pose.ry, Math.PI);
      }
      const cut = getReadingCardPose({ spread, aspect, cut: true });
      assert.ok(cut.x < 0 && cut.y < 0);
      assert.ok(cut.x - cut.scale * .305 > -frameW / 2);
      assert.ok(cut.y - cut.scale * .505 > -frameH / 2);
      const detail = getReadingCardPose({ spread, aspect, detail: true, faceUp: true });
      assert.equal(detail.x, 0); assert.equal(detail.ry, 0);
      const cutDetail = getReadingCardPose({ spread, aspect, cut: true, detail: true, faceUp: true });
      assert.equal(cutDetail.x, 0);
      assert.ok(cutDetail.scale > cut.scale);
    }
  }
});
