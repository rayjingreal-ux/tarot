import test from 'node:test';
import assert from 'node:assert/strict';
import { getRitualCardPose, getShuffleEnvelope, SHUFFLE_TIMING } from '../ritual-layout.js';

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

test('shuffle expands, gathers tightly and bursts into a stationary spread', () => {
  assert.equal(getShuffleEnvelope(0).radius, 0.64);
  assert.equal(getShuffleEnvelope(SHUFFLE_TIMING.gatherStartMs / SHUFFLE_TIMING.durationMs).radius, 1);
  assert.ok(getShuffleEnvelope(SHUFFLE_TIMING.chargeStartMs / SHUFFLE_TIMING.durationMs).radius < 0.09);
  assert.equal(getShuffleEnvelope(1).radius, 1);
  const input = { phase: 'shuffling', position: 12, count: 78, energy: 1, aspect: 1.6, progress: 1 };
  assert.deepEqual(getRitualCardPose({ ...input, time: 3 }), getRitualCardPose({ ...input, time: 30 }));
  assert.deepEqual(getRitualCardPose({ ...input, reducedMotion: true, progress: 0 }), getRitualCardPose({ ...input, reducedMotion: true, progress: 1 }));
});

test('shared timing holds a fully gathered, brilliant centre for 800 ms before any burst', () => {
  const { durationMs, chargeStartMs, burstStartMs } = SHUFFLE_TIMING;
  assert.ok(burstStartMs - chargeStartMs >= 650);
  const options = { phase: 'shuffling', position: 12, count: 78, energy: 1, aspect: 1.6 };
  const heldPose = getRitualCardPose({ ...options, progress: chargeStartMs / durationMs, time: 3 });
  assert.equal(heldPose.x, 0);
  assert.equal(heldPose.y, -0.02);
  for (let elapsed = chargeStartMs; elapsed <= burstStartMs; elapsed += 25) {
    const wave = getShuffleEnvelope(elapsed / durationMs);
    assert.equal(wave.gather, 1); assert.equal(wave.charge, 1); assert.equal(wave.burst, 0);
    assert.equal(wave.halo, 0); assert.equal(wave.stage, '聚光停留');
    assert.deepEqual(getRitualCardPose({ ...options, progress: elapsed / durationMs, time: elapsed }), heldPose);
  }
  assert.ok(getShuffleEnvelope((burstStartMs + 100) / durationMs).burst > 0);
  assert.equal(getShuffleEnvelope(1).halo, 1);
});

test('every shuffle phase stays bounded, finite and face down on phones and wide screens', () => {
  for (const aspect of [0.39, 0.58, 0.82, 1.64, 2.2]) for (let progress = 0; progress <= 1; progress += 0.025) {
    for (let position = 0; position < 36; position++) {
      const pose = getRitualCardPose({ phase: 'shuffling', position, count: 80, aspect, energy: 1, time: 5, progress });
      const halfWidth = (6.8 - pose.z) * Math.tan(16 * Math.PI / 180) * aspect;
      assert.ok(Math.abs(pose.x) + pose.scale * 0.46 <= halfWidth + 0.025);
      assert.ok(Math.cos(pose.ry) < -0.9);
      assert.ok(Math.abs(pose.y) < 0.7);
    }
  }
});
