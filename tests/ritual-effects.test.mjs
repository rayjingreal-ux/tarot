import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SHUFFLE_TIMING } from "../ritual-layout.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const THREE_URL = pathToFileURL(resolve(ROOT, "vendor", "three", "three.module.js")).href;
const THREE = await import(THREE_URL);

const effectSource = readFileSync(resolve(ROOT, "ritual-effects.js"), "utf8");
const bareImportPattern = /import\s+\*\s+as\s+THREE\s+from\s+["']three["'];?/g;
assert.equal(effectSource.match(bareImportPattern)?.length, 1, "Expected one bare Three.js import in ritual-effects.js.");
const runnableSource = effectSource.replace(
  bareImportPattern,
  `import * as THREE from ${JSON.stringify(THREE_URL)};`,
).replace(/(["'])\.\/ritual-layout\.js(?:\?v=[^"']+)?\1/g, JSON.stringify(pathToFileURL(resolve(ROOT, "ritual-layout.js")).href));
const effectModuleUrl = `data:text/javascript;base64,${Buffer.from(runnableSource).toString("base64")}`;
const { createRitualEffects } = await import(effectModuleUrl);

function createHarness(options) {
  const scene = new THREE.Scene();
  const effects = createRitualEffects(scene, options);
  assert.equal(scene.children.length, 1);
  return { scene, root: scene.children[0], effects };
}

function assertFiniteNumber(value, label) {
  assert.equal(Number.isFinite(value), true, `${label} must remain finite; received ${value}.`);
}

function assertFiniteTree(root, label) {
  root.traverse((object) => {
    for (const [key, value] of [
      ["position.x", object.position.x],
      ["position.y", object.position.y],
      ["position.z", object.position.z],
      ["rotation.x", object.rotation.x],
      ["rotation.y", object.rotation.y],
      ["rotation.z", object.rotation.z],
      ["scale.x", object.scale.x],
      ["scale.y", object.scale.y],
      ["scale.z", object.scale.z],
    ]) {
      assertFiniteNumber(value, `${label} / ${object.name || object.type} / ${key}`);
    }

    const attributes = object.geometry?.attributes ?? {};
    for (const [attributeName, attribute] of Object.entries(attributes)) {
      for (let index = 0; index < attribute.array.length; index += 1) {
        assertFiniteNumber(
          attribute.array[index],
          `${label} / ${object.name || object.type} / ${attributeName}[${index}]`,
        );
      }
    }

    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of objectMaterials) {
      assertFiniteNumber(material.opacity, `${label} / ${object.name || object.type} / material.opacity`);
      if (material.color) {
        assertFiniteNumber(material.color.r, `${label} / ${object.name || object.type} / material.color.r`);
        assertFiniteNumber(material.color.g, `${label} / ${object.name || object.type} / material.color.g`);
        assertFiniteNumber(material.color.b, `${label} / ${object.name || object.type} / material.color.b`);
      }
    }
  });
}

function motionSnapshot(root) {
  const snapshot = [];
  root.traverse((object) => {
    snapshot.push({
      name: object.name,
      position: object.position.toArray(),
      rotation: [object.rotation.x, object.rotation.y, object.rotation.z, object.rotation.order],
      scale: object.scale.toArray(),
      geometryPositions: object.geometry?.attributes?.position
        ? Array.from(object.geometry.attributes.position.array)
        : null,
    });
  });
  return snapshot;
}

test("every ritual phase keeps geometry, transforms, and material values finite", () => {
  const { root, effects } = createHarness({ reducedMotion: false });
  const states = [
    { phase: "setup", progress: 0, holding: false, aspect: 1.6 },
    { phase: "shuffling", progress: 0.2, holding: false, aspect: 1.6 },
    { phase: "shuffling", progress: 0.75, holding: true, aspect: 1.6 },
    { phase: "selecting", progress: 1, holding: false, aspect: 0.62 },
    { phase: "revealing", progress: 0, holding: false, aspect: 0.62 },
    { phase: "revealing", progress: 0.5, holding: false, aspect: 1.6 },
    { phase: "revealing", progress: 1, holding: false, aspect: 1.6 },
  ];

  let elapsed = 0;
  for (const state of states) {
    effects.setState(state);
    for (let frame = 0; frame < 8; frame += 1) {
      elapsed += 1 / 60;
      effects.update(1 / 60, elapsed);
    }
    assert.equal(root.visible, true);
    assertFiniteTree(root, state.phase);
  }

  effects.dispose();
});

test("changing holding state cannot change decorative positions at zero delta time", () => {
  const { root, effects } = createHarness({ reducedMotion: false });
  effects.setState({ phase: "shuffling", progress: 0.42, holding: false, aspect: 1.5 });
  for (let frame = 0; frame < 30; frame += 1) effects.update(1 / 60, frame / 60);

  const before = motionSnapshot(root);
  const arcs = root.children.filter((object) => object.name.startsWith("Ritual orbit arc"));
  const arcRotations = arcs.map((arc) => arc.rotation.z);
  effects.setState({ holding: true });
  effects.update(0, 987654.321);

  assert.deepEqual(motionSnapshot(root), before);
  effects.update(1 / 60, 987654.321 + 1 / 60);
  arcs.forEach((arc, index) => {
    assert.ok(
      Math.abs(arc.rotation.z - arcRotations[index]) < 0.02,
      "The first holding frame must continue the existing arc phase without teleporting.",
    );
  });
  assertFiniteTree(root, "holding transition");

  effects.dispose();
});

test("reduced motion keeps all decorative transforms and dynamic positions fixed", () => {
  const { root, effects } = createHarness({ reducedMotion: true });
  effects.setState({ phase: "shuffling", progress: 0.7, holding: true, aspect: 0.58 });
  effects.update(1 / 60, 1);
  const fixed = motionSnapshot(root);

  for (let frame = 1; frame <= 120; frame += 1) {
    effects.update(1 / 60, 1 + frame / 60);
  }
  assert.deepEqual(motionSnapshot(root), fixed);

  effects.setState({ phase: "revealing", progress: 0.58, holding: false, aspect: 0.58 });
  for (let frame = 1; frame <= 24; frame += 1) effects.update(1 / 60, 4 + frame / 60);
  assert.deepEqual(motionSnapshot(root), fixed, "Reveal may fade in reduced motion, but must not move decorations.");
  assertFiniteTree(root, "reduced motion");

  effects.dispose();
});

test("idle hides immediately and dispose releases owned resources exactly once", () => {
  const { scene, root, effects } = createHarness({ reducedMotion: false });
  effects.setState({ phase: "setup", progress: 0, holding: false, aspect: 1.4 });
  effects.update(1 / 60, 0);
  assert.equal(root.visible, true);

  effects.setState({ phase: "idle", progress: 0, holding: false });
  assert.equal(root.visible, false);

  const resources = new Set();
  root.traverse((object) => {
    // Sprite geometry is managed internally by Three.js, not by this module.
    if (!object.isSprite && object.geometry) resources.add(object.geometry);
    const objectMaterials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : [];
    for (const material of objectMaterials) {
      resources.add(material);
      if (material.map) resources.add(material.map);
    }
  });

  const disposeCounts = new Map([...resources].map((resource) => [resource, 0]));
  for (const resource of resources) {
    resource.addEventListener("dispose", () => disposeCounts.set(resource, disposeCounts.get(resource) + 1));
  }

  effects.dispose();
  assert.equal(scene.children.includes(root), false);
  for (const count of disposeCounts.values()) assert.equal(count, 1);

  assert.doesNotThrow(() => effects.dispose());
  for (const count of disposeCounts.values()) assert.equal(count, 1, "Repeated dispose must remain idempotent.");
});

test("centre light stays brilliant before the synchronized outward burst and peripheral aura persists", () => {
  const { root, effects } = createHarness({ reducedMotion: false });
  const core = root.getObjectByName("Concentrated ritual heartlight");
  const gold = root.getObjectByName("Warm ritual glow");
  const arc = root.getObjectByName("Ritual orbit arc 1");
  const pulse = root.getObjectByName("Ritual gathering pulse 1");
  let brightHeldMs = 0, chargeWidth = 0;
  for (let elapsed = 10; elapsed <= SHUFFLE_TIMING.durationMs; elapsed += 10) {
    effects.setState({ phase: "shuffling", progress: elapsed / SHUFFLE_TIMING.durationMs, holding: true, aspect: 1.6 });
    effects.update(0.01, elapsed / 1000);
    if (elapsed >= SHUFFLE_TIMING.chargeStartMs && elapsed <= SHUFFLE_TIMING.burstStartMs) {
      if (core.material.opacity >= 0.9) brightHeldMs += 10;
      assert.ok(gold.scale.x < 2, "background expansion waits until the central hold is finished");
      chargeWidth = gold.scale.x;
    }
  }
  assert.ok(brightHeldMs >= 650, `brilliant visible hold was ${brightHeldMs} ms`);
  assert.ok(gold.scale.x >= chargeWidth * 4 && gold.scale.x > 7);
  assert.ok(gold.scale.y > 4 && pulse.scale.x > 3, "the light reaches the periphery, not just the card pile");
  effects.setState({ phase: "selecting", progress: 1, holding: false });
  const rotation = arc.rotation.z;
  for (let frame = 0; frame < 120; frame++) effects.update(1 / 60, 6 + frame / 60);
  assert.ok(gold.scale.x > 7 && gold.material.opacity > 0.2, "a broad halo stays after the explosion");
  assert.ok(arc.material.opacity > 0.2 && arc.rotation.z !== rotation, "peripheral arcs remain bright and orbit continuously");
  assertFiniteTree(root, "charged burst and persistent aura");
  effects.dispose();
});
