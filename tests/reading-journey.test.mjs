import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { DRAW_SPREADS } from "../draw-spreads.js";
import { readingArrivalEnvelope } from "../reading-journey-timing.js";

const threeUrl = pathToFileURL(resolve("vendor/three/three.module.js")).href;
const THREE = await import(threeUrl);
const source = readFileSync(new URL("../reading-journey.js", import.meta.url), "utf8")
  .replace('from "three"', `from ${JSON.stringify(threeUrl)}`);
const { createReadingJourney } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
function harness(reducedMotion = false) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(32, 1.7, .05, 30);
  camera.position.set(0, .25, 6.8); camera.lookAt(0, .1, .4); camera.updateMatrixWorld();
  const backTexture = new THREE.Texture();
  const effect = createReadingJourney(scene, { reducedMotion });
  const update = (spread, elapsedMs, arrival = 0) => effect.update({ active: true, spread, elapsedMs, arrival, backTexture, camera });
  return { scene, camera, backTexture, effect, update };
}

test("all spread counts use only borrowed backs and fit the distant stage on phones and desktop", () => {
  const h = harness();
  for (const spread of DRAW_SPREADS) for (const aspect of [.35, .46, .75, 1, 1.8, 3.5]) {
    h.camera.aspect = aspect; h.camera.updateProjectionMatrix(); h.update(spread, 2000);
    h.scene.updateMatrixWorld(true);
    const veil = h.scene.children[0].children.find((node) => node.renderOrder === 490);
    const veilCenter = new THREE.Vector3().applyMatrix4(veil.matrixWorld).project(h.camera);
    assert.ok(veilCenter.z > -1 && veilCenter.z < 1, "full-stage veil must be inside the real camera clip range");
    const cards = h.scene.children[0].children.filter((node) => node.material?.uniforms?.uBack && node.visible);
    assert.equal(cards.length, spread.count, "cut is not a distant main card");
    for (const card of cards) {
      assert.equal(card.material.uniforms.uBack.value, h.backTexture);
      assert.ok(card.position.z < -9, "pursued cards remain in the distance");
      for (const x of [-.5, .5]) for (const y of [-.5, .5]) {
        const point = new THREE.Vector3(x, y, 0).applyMatrix4(card.matrixWorld).project(h.camera);
        assert.ok(Math.abs(point.x) < .95 && Math.abs(point.y) < .85, `${spread.id}/${aspect} card corner fits: ${point.x},${point.y}`);
      }
    }
  }
  h.effect.dispose();
});

test("long loading loops stay finite, stars move in perspective and arrival lights are bounded", () => {
  const h = harness(), spread = DRAW_SPREADS.find((spread) => spread.id === "free-7");
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
  for (let i = 0; i <= 8; i++) for (const progress of [0, .1, .4, .8, 1]) {
    const pose = readingArrivalEnvelope(progress, i, 8);
    assert.ok(pose.scale >= 0 && pose.scale <= 1 && pose.glow >= 0 && pose.glow <= .9);
  }
  assert.equal(readingArrivalEnvelope(0, 0, 8).visible, false);
  assert.equal(readingArrivalEnvelope(1, 7, 8).scale, 1);
  h.effect.dispose();
});

test("reduced motion freezes distant geometry; idle and dispose clear owned resources only", () => {
  const h = harness(true), spread = DRAW_SPREADS.at(-1);
  h.update(spread, 1000);
  const positions = () => h.scene.children[0].children.map((node) => ({ p: node.position.toArray(), r: node.rotation.toArray(), s: node.scale.toArray(), vertices: Array.from(node.geometry?.attributes.position?.array ?? []) }));
  const before = positions(); h.update(spread, 30000); assert.deepEqual(positions(), before);
  let borrowedDisposed = false; h.backTexture.addEventListener("dispose", () => { borrowedDisposed = true; });
  h.effect.hide(); assert.ok(h.scene.children.every((node) => !node.visible));
  h.effect.dispose(); h.effect.dispose(); assert.equal(h.scene.children.length, 0); assert.equal(borrowedDisposed, false);
});
