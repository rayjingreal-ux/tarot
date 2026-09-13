import test from "node:test";
import assert from "node:assert/strict";
import { getCardFlipPose } from "../card-flip.js";

test("front and back turns visibly pass through the edge instead of appearing instantly", () => {
  for (const [from, to] of [[Math.PI, 0], [0, Math.PI]]) {
    assert.equal(getCardFlipPose({ from, to, elapsed: 0 }).rotationY, from);
    const middle = getCardFlipPose({ from, to, elapsed: 360 });
    assert.ok(Math.abs(middle.rotationY - Math.PI / 2) < 1e-9);
    assert.equal(middle.done, false);
    assert.equal(getCardFlipPose({ from, to, elapsed: 720 }).rotationY, to);
    assert.equal(getCardFlipPose({ from, to, elapsed: 900 }).done, true);
  }
});

test("all-card reveal can stagger without changing identities or skipping the flip", () => {
  const early = getCardFlipPose({ elapsed: 300, delay: 0 });
  const later = getCardFlipPose({ elapsed: 300, delay: 400 });
  assert.ok(early.progress > 0); assert.equal(later.rotationY, Math.PI);
  assert.equal(getCardFlipPose({ elapsed: 1120, delay: 400 }).rotationY, 0);
});

test("reduced motion completes immediately and repeated sampling reuses its output", () => {
  const output = {};
  assert.equal(getCardFlipPose({ elapsed: 0, duration: 0 }, output), output);
  assert.equal(output.rotationY, 0); assert.equal(output.done, true);
});
