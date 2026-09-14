import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DRAW_SPREADS } from "../draw-spreads.js";
import { readingArrivalEnvelope } from "../reading-journey-timing.js";
import { createReadingOrbSeeds, getReadingOrbPose, getReadingOrbReturnPose,
  getReadingOrbFieldPoses, createReadingCometHistory, recordReadingCometHead } from "../reading-orb-motion.js";

const threeUrl = pathToFileURL(resolve("vendor/three/three.module.js")).href;
const THREE = await import(threeUrl);
const source = readFileSync(new URL("../reading-journey.js", import.meta.url), "utf8")
  .replace('from "three"', `from ${JSON.stringify(threeUrl)}`)
  .replace(/from "\.\/(reading-(?:orb-motion|journey-timing)\.js)\?[^\"]+"/g,
    (_, file) => `from ${JSON.stringify(pathToFileURL(resolve(file)).href)}`);
const { createReadingJourney } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
const seeded = () => { let value = 41; return () => ((value = Math.imul(value, 1664525) + 1013904223 >>> 0) / 4294967296); };
function harness(reducedMotion = false) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1.7, .05, 30);
  camera.position.set(0, .25, 6.8); camera.lookAt(0, .1, .4); camera.updateMatrixWorld();
  const backTexture = new THREE.Texture();
  let samples = 0; const random = seeded();
  const effect = createReadingJourney(scene, { reducedMotion, random: () => { samples++; return random(); } });
  const update = (spread, elapsedMs, arrival = 0, journeyId = 1) => effect.update({ active: true, spread, elapsedMs, arrival, journeyId, backTexture, camera });
  const orbs = () => {
    const result = []; scene.traverse((node) => { if (node.userData.readingSlot !== undefined && node.visible) result.push(node); });
    return result.sort((a, b) => a.userData.readingSlot - b.userData.readingSlot);
  };
  return { scene, camera, backTexture, effect, update, orbs, samples: () => samples };
}
const back = (orb) => orb.children.find((child) => child.material?.uniforms.uBack);
const halo = (orb) => orb.children.find((child) => child.renderOrder === 503);
const core = (orb) => orb.children.find((child) => child.renderOrder === 505);
const color = (orb) => halo(orb).material.uniforms.uColor.value.toArray();

test("all spreads wait as exactly N coloured points, no backs or extra cut, inside phone and desktop views", () => {
  const h = harness();
  for (const spread of DRAW_SPREADS) for (const aspect of [.35, .46, .75, 1, 1.8, 3.5]) {
    h.camera.aspect = aspect; h.camera.updateProjectionMatrix();
    for (const time of [500, 2000, 8000, 60000]) {
      h.update(spread, time); h.scene.updateMatrixWorld(true);
      const veil = h.scene.children[0].children.find((node) => node.renderOrder === 490);
      const veilCenter = new THREE.Vector3().applyMatrix4(veil.matrixWorld).project(h.camera);
      assert.ok(veilCenter.z > -1 && veilCenter.z < 1, "veil stays inside the real camera clip range");
      assert.equal(h.orbs().length, spread.count);
      for (const orb of h.orbs()) {
        assert.equal(back(orb).visible, false, "no rectangular back while loading");
        const point = orb.getWorldPosition(new THREE.Vector3()).project(h.camera);
        assert.ok(Math.abs(point.x) < .73 && Math.abs(point.y) < .57 && Math.abs(point.z) < 1,
          `${spread.id}/${aspect} point fits: ${point.x},${point.y}`);
        assert.ok(orb.position.z < -9, "points remain in the distance until ready");
      }
    }
  }
  h.effect.dispose();
});

test("colours and crossing paths are seeded once per journey, not per frame, independently of card identities", () => {
  assert.deepEqual(createReadingOrbSeeds(7, seeded()), createReadingOrbSeeds(7, seeded()));
  const h = harness(), spread = DRAW_SPREADS.find((item) => item.id === "free-7");
  h.update(spread, 1000);
  const initial = h.orbs().map((orb) => orb.position.toArray()), colours = h.orbs().map(color), samples = h.samples();
  assert.equal(new Set(colours.map((value) => JSON.stringify(value))).size, 7);
  h.update(spread, 1016);
  h.orbs().forEach((orb, index) => {
    assert.ok(orb.position.distanceTo(new THREE.Vector3(...initial[index])) < .1, "smooth frame, no random teleport");
  });
  h.update(spread, 5000);
  assert.notDeepEqual(h.orbs().map((orb) => orb.position.toArray()), initial);
  assert.deepEqual(h.orbs().map(color), colours); assert.equal(h.samples(), samples);
  h.update(spread, 1000, 0, 2);
  assert.notDeepEqual(h.orbs().map(color), colours); assert.ok(h.samples() > samples);
  h.effect.dispose();
});

test("return preserves the last displayed position, size and brightness, then unfolds exactly at the final slot", () => {
  const h = harness(), spread = DRAW_SPREADS.find((item) => item.id === "free-7");
  h.update(spread, 6200);
  const previous = h.orbs().map((orb) => ({ position: orb.getWorldPosition(new THREE.Vector3()).clone(),
    haloSize: halo(orb).scale.x, coreSize: core(orb).scale.x,
    haloOpacity: halo(orb).material.uniforms.uOpacity.value, coreOpacity: core(orb).material.uniforms.uOpacity.value }));
  const scratch = {}, targets = [];
  for (let i = 0; i <= spread.count; i++) {
    Object.assign(scratch, { x: (i - 3) * .3, y: -.4, z: 1.05, scale: .35 });
    targets.push({ ...scratch }); h.effect.setTarget(i, scratch, i === spread.count ? null : [100, 600]);
  }
  Object.assign(scratch, { x: 999, scale: 999 });
  h.camera.position.x += .2; h.camera.updateMatrixWorld();
  h.update(spread, 9300, 1e-9);
  h.orbs().slice(0, spread.count).forEach((orb, i) => {
    assert.ok(orb.position.distanceTo(previous[i].position) < 1e-7, "departure must not resample the path or follow a changed camera");
    for (const [actual, expected] of [[halo(orb).scale.x, previous[i].haloSize], [core(orb).scale.x, previous[i].coreSize],
      [halo(orb).material.uniforms.uOpacity.value, previous[i].haloOpacity], [core(orb).material.uniforms.uOpacity.value, previous[i].coreOpacity]]) {
      assert.ok(Math.abs(actual - expected) < 1e-7, "no size or brightness jump at departure");
    }
    assert.equal(back(orb).visible, false);
  });
  for (const progress of [.3, .7, .9, .999, 1]) {
    h.update(spread, 9300 + progress * 3200, progress);
    h.orbs().forEach((orb, i) => {
      const envelope = readingArrivalEnvelope(progress, i, spread.count + 1), card = back(orb);
      if (envelope.unfold > 0) {
        assert.ok(orb.position.distanceTo(new THREE.Vector3(targets[i].x, targets[i].y, targets[i].z)) < 1e-8);
        assert.ok(Math.abs(card.scale.y - targets[i].scale * 1.01 * envelope.unfold) < 1e-8);
        assert.equal(card.material.uniforms.uBack.value, h.backTexture);
        assert.deepEqual(card.material.uniforms.uClipY.value.toArray(), i === spread.count ? [-1, -1] : [100, 600]);
      }
      if (envelope.clarify > 0) {
        assert.equal(envelope.visible, true, "real back appears behind the clearing mist");
        assert.equal(card.material.uniforms.uOpacity.value, 1 - envelope.clarify);
      }
      if (progress === 1) { assert.equal(card.visible, false); assert.equal(envelope.visible, true); }
    });
  }
  h.effect.setTarget(0, { ...targets[0], x: 2, scale: .22 }); h.update(spread, 13000, .9);
  assert.equal(h.orbs()[0].position.x, 2, "resize changes the destination without resampling the path");
  h.effect.hide(); h.update(spread, 1000, 0, 2);
  assert.equal(h.orbs().length, 7); assert.ok(h.orbs().every((orb) => orb.parent === h.scene.children[0] && !back(orb).visible));
  h.effect.dispose();
});

test("long loads remain finite, stars move in perspective, and return paths have exact endpoints", () => {
  const h = harness(), spread = DRAW_SPREADS.find((item) => item.id === "free-7");
  let first;
  for (const time of [500, 1000, 4999, 8000, 60000, 3600000]) {
    h.update(spread, time);
    const stars = h.scene.children[0].children.find((node) => node.isPoints);
    if (!first) first = Array.from(stars.geometry.attributes.position.array);
    else assert.notDeepEqual(Array.from(stars.geometry.attributes.position.array), first);
    h.scene.traverse((node) => {
      for (const attribute of Object.values(node.geometry?.attributes ?? {})) assert.ok(Array.from(attribute.array).every(Number.isFinite));
      assert.ok([...node.position.toArray(), ...node.scale.toArray(), ...node.rotation.toArray().slice(0, 3)].every(Number.isFinite));
    });
  }
  const seed = createReadingOrbSeeds(1, seeded())[0], from = { x: 3, y: 2, z: -11 }, to = { x: -1, y: 0, z: 1.05 };
  assert.deepEqual(getReadingOrbReturnPose(from, to, 0, seed), from);
  for (const axis of ["x", "y", "z"]) assert.ok(Math.abs(getReadingOrbReturnPose(from, to, 1, seed)[axis] - to[axis]) < 1e-10);
  assert.notDeepEqual(getReadingOrbPose(seed, { elapsedMs: 0 }), getReadingOrbPose(seed, { elapsedMs: 4000 }));
  h.effect.dispose();
});

test("reduced motion freezes waiting geometry; hide/retry reset paths and dispose owns no deck textures", () => {
  const h = harness(true), spread = DRAW_SPREADS.at(-1);
  h.update(spread, 1000);
  const positions = () => {
    const data = []; h.scene.traverse((node) => data.push({ p: node.position.toArray(), r: node.rotation.toArray(), s: node.scale.toArray(), vertices: Array.from(node.geometry?.attributes.position?.array ?? []) })); return data;
  };
  const before = positions(); h.update(spread, 30000); assert.deepEqual(positions(), before);
  assert.ok(h.effect.arrivalLayer.children.filter((node) => node.name.startsWith("Comet wake")).every((node) => !node.visible));
  const firstColours = h.orbs().map(color);
  let borrowedDisposed = false; h.backTexture.addEventListener("dispose", () => { borrowedDisposed = true; });
  h.effect.hide(); assert.ok(h.scene.children.every((node) => !node.visible));
  h.update(spread, 1000); assert.notDeepEqual(h.orbs().map(color), firstColours);
  h.effect.dispose(); h.effect.dispose(); assert.equal(h.scene.children.length, 0); assert.equal(borrowedDisposed, false);
});

test("nearby lights spiral with reciprocal contraction and separation, without frame-dependent random jumps", () => {
  const seeds = createReadingOrbSeeds(2, seeded());
  Object.assign(seeds[1], { wander: seeds[0].wander, drift: seeds[0].drift, phase: seeds[0].phase + .7 });
  let angleMax = 0, radiusMin = Infinity, radiusMax = 0;
  for (let elapsedMs = 0; elapsedMs < 16000; elapsedMs += 32) {
    const options = { elapsedMs, aspect: 1.7 }, [a, b] = getReadingOrbFieldPoses(seeds, options);
    const x = a.bx - b.bx, y = a.by - b.by;
    const tx = x + a.dx - b.dx, ty = y + a.dy - b.dy;
    if (Math.hypot(x, y) > .005) {
      angleMax = Math.max(angleMax, Math.abs(Math.atan2(x * ty - y * tx, x * tx + y * ty)));
      const radius = Math.hypot(tx, ty) / Math.hypot(x, y);
      radiusMin = Math.min(radiusMin, radius); radiusMax = Math.max(radiusMax, radius);
    }
    assert.ok(Math.abs(a.dx + b.dx) < 1e-10 && Math.abs(a.dy + b.dy) < 1e-10);
    const [later] = getReadingOrbFieldPoses(seeds, { ...options, elapsedMs: elapsedMs + 1 });
    assert.ok(Math.hypot(a.x - later.x, a.y - later.y, a.z - later.z) < .04, "continuous through random waypoint boundaries");
    getReadingOrbFieldPoses([...seeds].reverse(), options).reverse().forEach((pose, i) => {
      for (const key of Object.keys(pose)) assert.ok(Math.abs(pose[key] - [a, b][i][key]) < 1e-9, "pair order cannot change the motion");
    });
  }
  assert.ok(angleMax > 1.5, "visible winding, not only independent translation");
  assert.ok(radiusMin < .85 && radiusMax > 1.1, "the pair both attracts and separates");
});

test("comet history remains bounded and captures the real current head, resetting for a fresh timeline", () => {
  const history = createReadingCometHistory();
  for (let time = 0; time <= 60000; time += 8) recordReadingCometHead(history, { x: time / 1000, y: 1, z: -12 }, time);
  assert.equal(history.count, 48); assert.equal(history.positions.length, 144);
  assert.equal(history.positions[history.head * 3], 60); assert.equal(history.times[history.head], 60000);
  recordReadingCometHead(history, { x: -3, y: 2, z: -10 }, 0);
  assert.equal(history.count, 1); assert.equal(history.head, 0);
  assert.deepEqual(Array.from(history.positions.slice(0, 3)), [-3, 2, -10]);
});

test("each same-colour comet follows its actual world head through return, then fades before materialization", () => {
  const h = harness(), spread = DRAW_SPREADS.find((item) => item.id === "free-7");
  for (let time = 1000; time <= 2504; time += 16) h.update(spread, time);
  const wakes = () => h.effect.arrivalLayer.children.filter((node) => node.name.startsWith("Comet wake") && node.visible);
  assert.equal(wakes().length, 7, "cut has no extra waiting comet");
  const checkHeads = () => wakes().forEach((wake, i) => {
    const positions = wake.geometry.attributes.position.array;
    const centre = new THREE.Vector3((positions[0] + positions[3]) / 2, (positions[1] + positions[4]) / 2, (positions[2] + positions[5]) / 2);
    assert.ok(centre.distanceTo(h.orbs()[i].getWorldPosition(new THREE.Vector3())) < .00001);
    assert.deepEqual(wake.material.uniforms.uColor.value.toArray(), color(h.orbs()[i]));
    assert.ok(wake.geometry.drawRange.count > 0 && wake.geometry.drawRange.count <= 47 * 6);
    assert.ok(Array.from(positions).every(Number.isFinite));
  });
  checkHeads();
  const departingBrightness = wakes().map((wake) => wake.material.uniforms.uOpacity.value);
  for (let i = 0; i <= 7; i++) h.effect.setTarget(i, { x: (i - 3) * .3, y: -.4, z: 1.05, scale: .35 });
  h.update(spread, 2520, .01); checkHeads();
  wakes().forEach((wake, i) => assert.equal(wake.material.uniforms.uOpacity.value, departingBrightness[i], "distant tail brightness cannot jump at return"));
  h.update(spread, 5000, .9); assert.equal(wakes().length, 0);
  h.effect.hide(); h.update(spread, 0, 0, 2);
  assert.ok(h.effect.arrivalLayer.children.filter((node) => node.name.startsWith("Comet wake")).every((node) => !node.visible || node.geometry.drawRange.count === 0));
  h.effect.dispose();
});

test("wide arcs actually recede and shrink in the final camera view, without resetting on long loads", () => {
  for (const count of [1, 7, 13]) for (const aspect of [.46, 1.7]) {
    const seeds = createReadingOrbSeeds(count, seeded());
    const options = { aspect, fov: 32, elapsedMs: 0 };
    const start = getReadingOrbFieldPoses(seeds, options);
    let previous = start;
    for (const elapsedMs of [500, 2000, 5000, 60000, 3600000]) {
      const current = getReadingOrbFieldPoses(seeds, { ...options, elapsedMs });
      current.forEach((pose, i) => {
        assert.ok(pose.z <= previous[i].z && pose.z > -27, "always further away, still within the 30-unit camera clip");
        if (elapsedMs >= 5000) assert.ok(pose.size / -pose.z < start[i].size / -start[i].z * .5, "head size has real perspective contraction within five seconds");
        assert.ok(pose.depthOpacity >= .67, "far lights retain a readable presence");
      });
      previous = current;
    }
    const radius = (p) => Math.hypot(p.x / (aspect * -p.z), p.y / -p.z);
    const nearRadius = start.reduce((sum, p) => sum + radius(p), 0);
    const farRadius = previous.reduce((sum, p) => sum + radius(p), 0);
    assert.ok(farRadius < nearRadius * .8, "final field does not undo the vanishing-point contraction");
  }
});
