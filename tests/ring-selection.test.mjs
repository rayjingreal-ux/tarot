import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "../vendor/three/three.module.js";
import { createRingSelection, getRingLayout } from "../ring-selection.js";

const order = (count) => Array.from({ length: count }, (_, i) => i);
const screens = [
  { width: 320, height: 568, top: 110, bottom: 410 },
  { width: 390, height: 844, top: 140, bottom: 650 },
  { width: 667, height: 375, top: 85, bottom: 270 },
  { width: 1440, height: 900, top: 140, bottom: 710 },
];
const project = (x, y, target) => target.set((x - 195) / 100, (420 - y) / 100, 1.05);

test("all remaining deck positions are real bounded rectangles in both rings at every rotation", () => {
  for (const count of [78, 80, 156]) for (const screen of screens) for (const rotation of [-19, 0, 0.61, 2.7, 41]) {
    const positions = order(count).filter((position) => position !== 13);
    const layout = getRingLayout({ ...screen, count, positions, rotation });
    assert.equal(layout.cards.length, count - 1);
    assert.equal(new Set(layout.cards.map((card) => card.position)).size, count - 1);
    assert.deepEqual(new Set(layout.cards.map((card) => card.lane)), new Set([0, 1]));
    for (const card of layout.cards) {
      for (const key of ["x", "y", "width", "height", "rotation"]) assert.ok(Number.isFinite(card[key]));
      assert.ok(card.height > 0 && card.width > 0);
      assert.ok(Math.abs(card.width / card.height - 0.61 / 1.01) < 1e-10);
      const halfX = (Math.abs(Math.cos(card.rotation)) * card.width + Math.abs(Math.sin(card.rotation)) * card.height) / 2;
      const halfY = (Math.abs(Math.sin(card.rotation)) * card.width + Math.abs(Math.cos(card.rotation)) * card.height) / 2;
      assert.ok(card.x - halfX >= layout.bounds.left - 0.001);
      assert.ok(card.x + halfX <= layout.bounds.right + 0.001);
      assert.ok(card.y - halfY >= layout.bounds.top - 0.001);
      assert.ok(card.y + halfY <= layout.bounds.bottom + 0.001);
    }
  }
});

test("cut and drawn positions leave holes without reordering any remaining card", () => {
  const options = { positions: order(80), count: 80, rotation: 1.3 };
  const full = getRingLayout(options);
  const remaining = getRingLayout({ ...options, positions: options.positions.filter((p) => ![0, 12, 39, 65, 79].includes(p)) });
  for (const card of remaining.cards) assert.deepEqual(card, full.cards.find((entry) => entry.position === card.position));
  const afterFullTurn = getRingLayout({ ...options, rotation: options.rotation + Math.PI * 2 });
  for (let i = 0; i < full.cards.length; i++) {
    assert.ok(Math.abs(full.cards[i].x - afterFullTurn.cards[i].x) < 1e-8);
    assert.ok(Math.abs(full.cards[i].y - afterFullTurn.cards[i].y) < 1e-8);
  }
});

test("every back keeps an exposed picking area and the central preview is separate from both rings", () => {
  const contains = (card, x, y) => {
    const dx = x - card.x, dy = y - card.y;
    const cosine = Math.cos(card.rotation), sine = Math.sin(card.rotation);
    return Math.abs(dx * cosine + dy * sine) < card.width / 2 && Math.abs(-dx * sine + dy * cosine) < card.height / 2;
  };
  for (const screen of screens) for (const count of [78, 80]) for (const rotation of [0, 0.7, 2.2]) {
    const { cards, preview } = getRingLayout({ ...screen, count, positions: order(count), rotation });
    assert.ok(preview.height > Math.max(...cards.map((card) => card.height)), "central preview is larger than ring backs");
    for (const card of cards) {
      let exposed = false;
      for (const u of [-0.42, -0.2, 0, 0.2, 0.42]) for (const v of [-0.42, -0.2, 0, 0.2, 0.42]) {
        const x = card.x + u * card.width * Math.cos(card.rotation) - v * card.height * Math.sin(card.rotation);
        const y = card.y + u * card.width * Math.sin(card.rotation) + v * card.height * Math.cos(card.rotation);
        if (!cards.some((other) => other.position > card.position && contains(other, x, y))) exposed = true;
      }
      assert.ok(exposed, `${screen.width}/${screen.height} position ${card.position} must not be completely occluded`);
      const dx = card.x - preview.x, dy = card.y - preview.y;
      const c = Math.cos(card.rotation), s = Math.sin(card.rotation), ac = Math.abs(c), as = Math.abs(s);
      const separated = Math.abs(dx) >= preview.width / 2 + ac * card.width / 2 + as * card.height / 2
        || Math.abs(dy) >= preview.height / 2 + as * card.width / 2 + ac * card.height / 2
        || Math.abs(dx * c + dy * s) >= card.width / 2 + preview.width / 2 * ac + preview.height / 2 * as
        || Math.abs(-dx * s + dy * c) >= card.height / 2 + preview.width / 2 * as + preview.height / 2 * ac;
      assert.ok(separated, `${screen.width}/${screen.height} central preview must not cover a ring card`);
    }
  }
});

test("one instanced back batch shares its texture and holds finite matrices for every remaining card", () => {
  const ring = createRingSelection({ THREE });
  const texture = new THREE.Texture();
  ring.setTexture(texture);
  const layout = ring.update({ ...screens[1], positions: order(80).filter((p) => p !== 23), count: 80, project });
  assert.equal(ring.group.children.length, 1);
  const batch = ring.group.children[0];
  assert.equal(batch.isInstancedMesh, true);
  assert.equal(batch.count, 79);
  assert.equal(batch.material.map, texture);
  assert.equal(batch.castShadow, false);
  assert.ok(layout.cards.every((card) => card.position !== 23));
  const matrix = new THREE.Matrix4();
  for (let i = 0; i < batch.count; i++) {
    batch.getMatrixAt(i, matrix);
    assert.ok(matrix.elements.every(Number.isFinite));
    assert.ok(Math.abs(matrix.determinant()) > 1e-8);
  }
  const uv = batch.geometry.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    assert.ok(uv.getX(i) >= -1e-6 && uv.getX(i) <= 1 + 1e-6);
    assert.ok(uv.getY(i) >= -1e-6 && uv.getY(i) <= 1 + 1e-6);
  }
  const version = batch.material.version;
  ring.setTexture(texture);
  assert.equal(batch.material.version, version, "same shared texture needs no shader rebuild");
  ring.dispose();
});

test("ray hits return original session positions even when instance IDs have compacted", () => {
  const ring = createRingSelection({ THREE });
  const layout = ring.update({ ...screens[1], positions: [4, 37, 69], count: 78, project });
  const raycaster = new THREE.Raycaster();
  const center = new THREE.Vector3();
  ring.group.visible = true;
  for (const card of layout.cards) {
    project(card.x, card.y, center);
    raycaster.set(new THREE.Vector3(center.x, center.y, 8), new THREE.Vector3(0, 0, -1));
    assert.equal(ring.pick(raycaster), card.position);
  }
  ring.group.visible = false;
  assert.equal(ring.pick(raycaster), null);
  ring.dispose();
});

test("batch expands for future decks and disposal never releases a borrowed shared texture", () => {
  const ring = createRingSelection({ THREE, capacity: 4 });
  const texture = new THREE.Texture();
  let textureDisposals = 0, geometryDisposals = 0, materialDisposals = 0, oldBatchDisposals = 0;
  texture.addEventListener("dispose", () => textureDisposals++);
  const first = ring.group.children[0];
  first.addEventListener("dispose", () => oldBatchDisposals++);
  first.geometry.addEventListener("dispose", () => geometryDisposals++);
  first.material.addEventListener("dispose", () => materialDisposals++);
  ring.setTexture(texture);
  ring.update({ ...screens[1], positions: order(156), count: 156, project });
  assert.equal(ring.group.children.length, 1);
  assert.equal(ring.group.children[0].count, 156);
  assert.equal(ring.group.children[0].material.map, texture);
  assert.equal(oldBatchDisposals, 1);
  ring.dispose();
  ring.dispose();
  assert.equal(textureDisposals, 0);
  assert.equal(geometryDisposals, 1);
  assert.equal(materialDisposals, 1);
  assert.equal(ring.group.children.length, 0);
  assert.equal(ring.update({ positions: [0], project }), null);
});

test("empty and malformed position lists do not render placeholder cards", () => {
  const ring = createRingSelection({ THREE });
  const layout = ring.update({ positions: [0, 0, -1, 78, 1.5, NaN], count: 78, project });
  assert.deepEqual(layout.cards.map((card) => card.position), [0]);
  ring.update({ positions: [], count: 78, project });
  assert.equal(ring.group.children[0].count, 0);
  ring.dispose();
});
