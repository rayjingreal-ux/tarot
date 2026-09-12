import test from 'node:test';
import assert from 'node:assert/strict';
import { getRitualCardPose } from '../ritual-layout.js';

test('all deck sizes and viewports produce finite, face-down ritual poses', () => {
  for (const count of [78, 80]) for (const aspect of [0.39, 0.58, 0.82, 1.64, 2.2]) {
    for (const phase of ['shuffling', 'selecting', 'revealing']) {
      for (let position = 0; position < count; position++) {
        const pose = getRitualCardPose({ phase, count, position, aspect, energy: 1, time: 9, focus: 40, selectedPosition: 40, progress: 0.8 });
        for (const key of ['x', 'y', 'z', 'rx', 'ry', 'rz', 'scale']) assert.ok(Number.isFinite(pose[key]), key);
        assert.ok(Math.cos(pose.ry) < -0.9, 'a face must never point at the camera');
        assert.ok(pose.scale > 0);
      }
    }
  }
});

test('every shuffled position can be brought to the center and selected', () => {
  for (const aspect of [0.58, 1.6]) for (let position = 0; position < 80; position++) {
    const pose = getRitualCardPose({ phase: 'selecting', position, count: 80, focus: position, aspect });
    assert.equal(pose.x, 0);
    assert.equal(pose.visible, true);
  }
});

test('portrait shuffle fits inside the fixed 32 degree stage camera', () => {
  for (const aspect of [0.39, 0.58, 0.82]) for (let position = 0; position < 80; position++) {
    const pose = getRitualCardPose({ phase: 'shuffling', position, count: 80, aspect, energy: 1, time: 5 });
    const halfWidth = (6.8 - pose.z) * Math.tan(16 * Math.PI / 180) * aspect;
    assert.ok(Math.abs(pose.x) + pose.scale * 0.36 <= halfWidth + 0.025);
  }
});

test('reveal converges the chosen back to the center and reduces other cards', () => {
  const chosen = getRitualCardPose({ phase: 'revealing', position: 70, count: 80, focus: 69, selectedPosition: 70, progress: 1 });
  const other = getRitualCardPose({ phase: 'revealing', position: 69, count: 80, focus: 69, selectedPosition: 70, progress: 1 });
  assert.equal(chosen.x, 0);
  assert.ok(Math.abs(chosen.rz) < 0.00001);
  assert.equal(chosen.scale, 1.4);
  assert.ok(other.scale < 0.3);
});

test('reduced motion poses are independent of elapsed time', () => {
  const input = { phase: 'shuffling', position: 10, count: 78, reducedMotion: true, energy: 1 };
  assert.deepEqual(getRitualCardPose({ ...input, time: 1 }), getRitualCardPose({ ...input, time: 100 }));
});

test('an existing pose may be reused without per-frame allocations', () => {
  const pose = {};
  assert.equal(getRitualCardPose({ phase: 'idle', position: 0, count: 78 }, pose), pose);
  assert.equal(pose.visible, false);
  assert.equal(getRitualCardPose({ phase: 'selecting', position: -1, count: 78 }).visible, false);
});
