import * as THREE from "three";
import { createReadingOrbSeeds, getReadingOrbFieldPoses, getReadingOrbReturnPose,
  createReadingCometHistory, recordReadingCometHead } from "./reading-orb-motion.js?v=20260915-02";
import { readingArrivalEnvelope } from "./reading-journey-timing.js?v=20260914-03";

const vertexShader = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const clipFragment = `uniform vec2 uClipY;
void clipViewport() { if (uClipY.x >= 0. && (gl_FragCoord.y < uClipY.x || gl_FragCoord.y > uClipY.y)) discard; }`;
const glowFragment = `varying vec2 vUv; uniform float uOpacity; uniform float uTime; uniform vec3 uColor;
${clipFragment}
void main() {
  clipViewport();
  vec2 p = (vUv - .5) * 2.;
  float mist = exp(-dot(p,p)*4.7) * (1.-smoothstep(.4,1.,length(p)));
  float veil = .87 + .13*sin(p.x*5.+uTime*.6)*sin(p.y*4.-uTime*.4);
  gl_FragColor = vec4(uColor, mist * veil * uOpacity);
}`;
const backFragment = `varying vec2 vUv; uniform sampler2D uBack; uniform float uOpacity; uniform float uBlur; uniform vec3 uColor; uniform float uTint;
${clipFragment}
void main() {
  clipViewport();
  float blur = uBlur;
  vec4 ink = texture2D(uBack,vUv)*.4;
  ink += texture2D(uBack,vUv+vec2(blur,0.))*.15 + texture2D(uBack,vUv-vec2(blur,0.))*.15;
  ink += texture2D(uBack,vUv+vec2(0.,blur))*.15 + texture2D(uBack,vUv-vec2(0.,blur))*.15;
  float edge = smoothstep(0.,.04,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
  gl_FragColor = vec4(mix(ink.rgb,uColor,uTint), ink.a * edge * uOpacity);
  #include <colorspace_fragment>
}`;
const cometFragment = `varying vec2 vUv; uniform float uOpacity; uniform vec3 uColor;
void main() {
  float across = (vUv.y - .5) * 2.;
  float feather = exp(-across*across*5.) * (1.-smoothstep(.65,1.,abs(across)));
  float wake = pow(max(0.,vUv.x),1.45);
  gl_FragColor = vec4(uColor + vec3(.16)*exp(-across*across*32.), feather * wake * uOpacity);
}`;
const smooth = (n) => { const t = Math.min(1, Math.max(0, n)); return t * t * (3 - 2 * t); };

// An optical forward journey inside the existing renderer. The real camera and
// card identities never change. Only the already-loaded back texture is borrowed.
export function createReadingJourney(scene, { reducedMotion = false, random = Math.random } = {}) {
  const root = new THREE.Group(), arrivals = new THREE.Group();
  root.name = "Starward reading journey";
  arrivals.name = "Returning reading lights";
  root.visible = arrivals.visible = false;
  scene.add(root, arrivals);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials = new Set();
  function shader(fragmentShader, uniforms, additive = true) {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: { ...uniforms, uClipY: { value: new THREE.Vector2(-1, -1) } },
      transparent: true, depthWrite: false, depthTest: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
    materials.add(material);
    return material;
  }
  function glow(parent, color, order = 502) {
    const material = shader(glowFragment, { uOpacity: { value: 0 }, uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = order;
    mesh.frustumCulled = false;
    parent.add(mesh);
    return mesh;
  }
  const veilMaterial = new THREE.MeshBasicMaterial({ color: 0x010609, transparent: true, opacity: 0,
    depthTest: false, depthWrite: false, toneMapped: false });
  materials.add(veilMaterial);
  const veil = new THREE.Mesh(geometry, veilMaterial);
  veil.position.z = -28; veil.scale.set(200, 200, 1); veil.renderOrder = 490; veil.frustumCulled = false; root.add(veil);
  const nebula = [glow(root, 0x216e6b, 495), glow(root, 0x976636, 495), glow(root, 0x304c7c, 495)];
  nebula.forEach((mesh, i) => { mesh.position.set((i - 1) * 6, (i % 2 - .5) * 3, -20); mesh.scale.set(20, 14, 1); });
  const starCount = reducedMotion ? 90 : 360;
  const starPositions = new Float32Array(starCount * 3), trailPositions = new Float32Array(starCount * 6);
  const starColors = new Float32Array(starCount * 3), trailColors = new Float32Array(starCount * 6);
  for (let i = 0; i < starCount; i++) {
    const tint = new THREE.Color(i % 4 === 0 ? 0xf6d48c : i % 3 === 0 ? 0x88d6d5 : 0xcbdfff);
    tint.toArray(starColors, i * 3); tint.toArray(trailColors, i * 6);
    tint.multiplyScalar(.02).toArray(trailColors, i * 6 + 3);
  }
  const starsGeometry = new THREE.BufferGeometry(), trailsGeometry = new THREE.BufferGeometry();
  starsGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3).setUsage(THREE.DynamicDrawUsage));
  starsGeometry.setAttribute("color", new THREE.BufferAttribute(starColors, 3));
  trailsGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage));
  trailsGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
  const glowPixels = new Uint8Array(32 * 32 * 4);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const r = Math.hypot((x - 15.5) / 15.5, (y - 15.5) / 15.5);
    const offset = (y * 32 + x) * 4;
    glowPixels[offset] = glowPixels[offset + 1] = glowPixels[offset + 2] = 255;
    glowPixels[offset + 3] = Math.round(255 * Math.exp(-r * r * 5) * (1 - smooth(r)));
  }
  const starTexture = new THREE.DataTexture(glowPixels, 32, 32);
  starTexture.needsUpdate = true; starTexture.magFilter = starTexture.minFilter = THREE.LinearFilter;
  const starsMaterial = new THREE.PointsMaterial({ size: .04, vertexColors: true, transparent: true,
    map: starTexture, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false });
  const trailsMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false });
  materials.add(starsMaterial); materials.add(trailsMaterial);
  const stars = new THREE.Points(starsGeometry, starsMaterial), trails = new THREE.LineSegments(trailsGeometry, trailsMaterial);
  stars.renderOrder = 500; trails.renderOrder = 500; stars.frustumCulled = trails.frustumCulled = false;
  root.add(stars, trails);
  const runeCount = reducedMotion ? 8 : 28;
  const runePositions = new Float32Array(runeCount * 36);
  const runeGeometry = new THREE.BufferGeometry();
  runeGeometry.setAttribute("position", new THREE.BufferAttribute(runePositions, 3).setUsage(THREE.DynamicDrawUsage));
  const runeMaterial = new THREE.LineBasicMaterial({ color: 0xdcc28c, transparent: true,
    blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: false });
  materials.add(runeMaterial);
  const runes = new THREE.LineSegments(runeGeometry, runeMaterial);
  runes.name = "Fleeting astral sigils"; runes.renderOrder = 501; runes.frustumCulled = false; root.add(runes);
  const runeVertices = [[0,1],[.6,0],[.6,0],[0,-1],[0,-1],[-.6,0],[-.6,0],[0,1],[0,1.5],[0,-1.5],[-1,0],[1,0]];
  const cards = [], targets = new Map(), identity = new THREE.Quaternion(), fieldPoses = [];
  const trailPoint = new THREE.Vector3(), trailTangent = new THREE.Vector3(), trailView = new THREE.Vector3();
  const trailSide = new THREE.Vector3(), lastTrailSide = new THREE.Vector3();
  let fieldSeeds = [];
  let disposed = false, currentJourney = null, currentCount = 0, returning = false;
  function ensureCount(count) {
    while (cards.length < count + 1) {
      const carrier = new THREE.Group();
      carrier.name = `Reading light ${cards.length + 1}`;
      carrier.userData.readingSlot = cards.length;
      root.add(carrier);
      const material = shader(backFragment, { uBack: { value: null }, uOpacity: { value: 0 }, uBlur: { value: .05 }, uColor: { value: new THREE.Color() }, uTint: { value: 0 } }, false);
      const card = new THREE.Mesh(geometry, material);
      card.name = "Mist becoming a card back";
      card.renderOrder = 504; card.frustumCulled = false; card.visible = false; carrier.add(card);
      const history = createReadingCometHistory();
      const cometGeometry = new THREE.BufferGeometry();
      cometGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(history.capacity * 6), 3).setUsage(THREE.DynamicDrawUsage));
      cometGeometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(history.capacity * 4), 2).setUsage(THREE.DynamicDrawUsage));
      const indices = [];
      for (let i = 0; i < history.capacity - 1; i++) indices.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
      cometGeometry.setIndex(indices); cometGeometry.setDrawRange(0, 0);
      const comet = new THREE.Mesh(cometGeometry, shader(cometFragment, { uColor: { value: new THREE.Color() }, uOpacity: { value: 0 } }));
      comet.material.side = THREE.DoubleSide;
      comet.name = `Comet wake ${cards.length + 1}`; comet.renderOrder = 502; comet.frustumCulled = false; comet.visible = false;
      arrivals.add(comet);
      cards.push({ carrier, card, light: glow(carrier, 0xffffff, 503), core: glow(carrier, 0xffffff, 505),
        from: new THREE.Vector3(), fromQuaternion: new THREE.Quaternion(), pose: {}, seed: null,
        size: 1, lightOpacity: 0, coreOpacity: 0, cometOpacity: 0, comet, history });
    }
  }
  function hide() {
    root.visible = arrivals.visible = false;
    currentJourney = null; returning = false; targets.clear();
    cards.forEach(({ comet, history }) => { comet.visible = false; history.count = 0; history.head = -1; history.sampledAt = -Infinity; });
  }
  // App poses use shared scratch storage; take a copy, never retain that reference.
  function setTarget(slot, pose, clipY = null) {
    const target = targets.get(slot) ?? {};
    Object.assign(target, { x: pose.x, y: pose.y, z: pose.z, scale: pose.scale,
      clipBottom: clipY?.[0] ?? -1, clipTop: clipY?.[1] ?? -1 });
    targets.set(slot, target);
  }
  function begin(journeyId, count) {
    currentJourney = journeyId; currentCount = count; returning = false;
    const seeds = createReadingOrbSeeds(count + 1, random);
    fieldSeeds = seeds.slice(0, count);
    cards.forEach((orb, i) => {
      root.add(orb.carrier); orb.carrier.position.set(0, 0, 0); orb.carrier.quaternion.identity();
      orb.carrier.visible = i < count; orb.card.visible = false;
      orb.comet.visible = false; orb.history.count = 0; orb.history.head = -1; orb.history.sampledAt = -Infinity;
      if (i > count) return;
      orb.seed = seeds[i];
      const color = new THREE.Color().setHSL(orb.seed.hue, .74, .65);
      orb.light.material.uniforms.uColor.value.copy(color);
      orb.comet.material.uniforms.uColor.value.copy(color);
      orb.card.material.uniforms.uColor.value.copy(color);
      orb.core.material.uniforms.uColor.value.copy(color).lerp(new THREE.Color(0xffffff), .72);
      for (const mesh of [orb.light, orb.core, orb.card]) mesh.material.uniforms.uClipY.value.set(-1, -1);
    });
  }
  function updateComet(orb, position, time, camera, opacity, width) {
    const { comet, history } = orb;
    comet.visible = !reducedMotion && opacity > .001;
    if (!comet.visible) return;
    recordReadingCometHead(history, position, time);
    const ageAt = (i) => time - history.times[(history.head - i + history.capacity) % history.capacity];
    let count = history.count;
    for (let i = 1; i < count; i++) if (ageAt(i) >= 950) { count = i + 1; break; }
    const ageSpan = Math.max(1, Math.min(950, ageAt(count - 1)));
    const positions = comet.geometry.attributes.position.array, uv = comet.geometry.attributes.uv.array;
    const offsetAt = (i) => ((history.head - i + history.capacity) % history.capacity) * 3;
    lastTrailSide.setFromMatrixColumn(camera.matrixWorld, 0);
    for (let i = 0; i < count; i++) {
      const offset = offsetAt(i), before = offsetAt(Math.max(0, i - 1)), after = offsetAt(Math.min(count - 1, i + 1));
      trailPoint.fromArray(history.positions, offset);
      trailTangent.fromArray(history.positions, before).sub(trailSide.fromArray(history.positions, after));
      trailView.copy(camera.position).sub(trailPoint);
      trailSide.crossVectors(trailTangent, trailView);
      if (trailSide.lengthSq() < 1e-10) trailSide.copy(lastTrailSide);
      else trailSide.normalize();
      if (trailSide.dot(lastTrailSide) < 0) trailSide.negate();
      lastTrailSide.copy(trailSide);
      const life = Math.max(0, 1 - ageAt(i) / ageSpan), radius = width * Math.pow(life, .65);
      for (let side = 0; side < 2; side++) {
        const vertex = i * 6 + side * 3, sign = side ? 1 : -1;
        positions[vertex] = trailPoint.x + trailSide.x * radius * sign;
        positions[vertex + 1] = trailPoint.y + trailSide.y * radius * sign;
        positions[vertex + 2] = trailPoint.z + trailSide.z * radius * sign;
        uv[i * 4 + side * 2] = life; uv[i * 4 + side * 2 + 1] = side;
      }
    }
    comet.geometry.attributes.position.needsUpdate = comet.geometry.attributes.uv.needsUpdate = true;
    comet.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    comet.material.uniforms.uOpacity.value = opacity;
  }
  function update({ active, elapsedMs = 0, arrival = 0, journeyId = 0, spread, backTexture, camera }) {
    if (disposed || !active || !spread || !backTexture) { hide(); return; }
    ensureCount(spread.count);
    const fresh = currentJourney !== journeyId || currentCount !== spread.count;
    if (fresh) begin(journeyId, spread.count);
    root.visible = arrivals.visible = true;
    root.position.copy(camera.position); root.quaternion.copy(camera.quaternion);
    const depth = Math.max(16, Math.min(48, camera.far - 4));
    veil.position.z = -Math.min(60, camera.far - 1);
    const time = reducedMotion ? 0 : elapsedMs / 1000;
    const entry = smooth(elapsedMs / 500), exit = 1 - smooth(arrival / .62);
    veilMaterial.opacity = entry * .95 * (1 - smooth(arrival / .22));
    starsMaterial.opacity = entry * exit * (reducedMotion ? .3 : .95);
    trailsMaterial.opacity = reducedMotion ? 0 : entry * exit * .65;
    runeMaterial.opacity = entry * exit * (reducedMotion ? .12 : .42);
    const aspect = Math.max(.35, Math.min(3.5, camera.aspect));
    for (let i = 0; i < starCount; i++) {
      const seed = (i * .61803398875) % 1;
      const angle = i * 2.399963;
      const radius = 1.4 + ((i * .41421356) % 1) * 13;
      const z = -2 - ((seed * depth - time * (9 + i % 7)) % depth + depth) % depth;
      const x = Math.cos(angle) * radius * Math.min(1.5, aspect), y = Math.sin(angle) * radius;
      const p = i * 3, t = i * 6;
      starPositions[p] = trailPositions[t] = trailPositions[t + 3] = x;
      starPositions[p + 1] = trailPositions[t + 1] = trailPositions[t + 4] = y;
      starPositions[p + 2] = trailPositions[t + 2] = z;
      trailPositions[t + 5] = Math.max(-camera.far + .1, z - (reducedMotion ? 0 : 1.1 + (depth + 2 + z) * .07));
    }
    starsGeometry.attributes.position.needsUpdate = trailsGeometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < runeCount; i++) {
      const star = (i * 11 + 7) % starCount, p = star * 3;
      const angle = i * 1.7 + time * .13, c = Math.cos(angle), s = Math.sin(angle);
      for (let j = 0; j < runeVertices.length; j++) {
        const [x, y] = runeVertices[j], offset = i * 36 + j * 3;
        runePositions[offset] = starPositions[p] + (x * c - y * s) * .10;
        runePositions[offset + 1] = starPositions[p + 1] + (x * s + y * c) * .10;
        runePositions[offset + 2] = starPositions[p + 2];
      }
    }
    runeGeometry.attributes.position.needsUpdate = true;
    nebula.forEach((mesh, i) => {
      mesh.material.uniforms.uTime.value = time;
      mesh.material.uniforms.uOpacity.value = entry * exit * (.18 + .025 * Math.sin(time * .55 + i));
      mesh.rotation.z = reducedMotion ? 0 : Math.sin(time * .12 + i) * .3;
    });
    if (!returning && (arrival <= 0 || fresh)) {
      root.updateMatrixWorld(true);
      getReadingOrbFieldPoses(fieldSeeds, { elapsedMs, aspect, fov: camera.fov, reducedMotion }, fieldPoses);
      cards.forEach((orb, i) => {
        if (i >= spread.count) return;
        const pose = fieldPoses[i];
        orb.carrier.position.set(pose.x, pose.y, pose.z); orb.size = pose.size;
        orb.light.scale.setScalar(pose.size * 1.25); orb.core.scale.setScalar(pose.size * .23);
        orb.light.material.uniforms.uOpacity.value = entry * pose.shimmer * .68;
        orb.core.material.uniforms.uOpacity.value = entry * pose.shimmer * 1.7;
        orb.lightOpacity = orb.light.material.uniforms.uOpacity.value;
        orb.coreOpacity = orb.core.material.uniforms.uOpacity.value;
        orb.light.material.uniforms.uTime.value = orb.core.material.uniforms.uTime.value = time + i;
        // Capture the transform actually presented on this waiting frame. Do not
        // resample the random path when loading finishes or the camera changes.
        orb.carrier.getWorldPosition(orb.from); orb.carrier.getWorldQuaternion(orb.fromQuaternion);
        orb.cometOpacity = entry * .85 * pose.depthOpacity;
        updateComet(orb, orb.from, elapsedMs, camera, orb.cometOpacity, orb.size * .12);
      });
    }
    if (arrival > 0) {
      if (!returning) {
        returning = true;
        cards.forEach((orb, i) => { if (i <= spread.count) arrivals.add(orb.carrier); });
      }
      cards.forEach((orb, i) => {
        const target = targets.get(i);
        orb.carrier.visible = i <= spread.count && Boolean(target);
        if (!orb.carrier.visible) return;
        const envelope = readingArrivalEnvelope(arrival, i, spread.count + 1, reducedMotion);
        const isCut = i === spread.count;
        const { carrier, card, light, core } = orb;
        const pose = getReadingOrbReturnPose(isCut ? target : orb.from, target, envelope.travel,
          isCut ? { arcX: 0, arcY: 0 } : orb.seed, reducedMotion || isCut, orb.pose);
        carrier.position.set(pose.x, pose.y, pose.z);
        carrier.quaternion.copy(isCut ? identity : orb.fromQuaternion).slerp(identity, smooth(envelope.travel));
        const travel = smooth(envelope.travel);
        if (!isCut) updateComet(orb, carrier.position, elapsedMs, camera,
          orb.cometOpacity * (1 - envelope.unfold), orb.size * .12 * (1 - travel) + target.scale * .08 * travel);
        const glowSize = (isCut ? target.scale : orb.size * 1.25) * (1 - travel) + target.scale * 1.9 * travel;
        light.scale.set(glowSize * (1 + envelope.unfold * .25), glowSize * (1 + envelope.unfold * .7), 1);
        light.material.uniforms.uOpacity.value = (isCut ? envelope.unfold : orb.lightOpacity * (1 - travel) + .7 * travel) * (1 - envelope.clarify);
        core.scale.setScalar((orb.size * .23 * (1 - travel) + target.scale * .34 * travel) * (1 - envelope.unfold));
        core.material.uniforms.uOpacity.value = isCut ? 0 : orb.coreOpacity * (1 - envelope.unfold);
        card.visible = envelope.unfold > 0 && envelope.local < 1;
        card.scale.set(target.scale * .61 * envelope.unfold, target.scale * 1.01 * envelope.unfold, 1);
        card.position.z = target.scale * .00555;
        card.material.uniforms.uBack.value = backTexture;
        card.material.uniforms.uOpacity.value = envelope.unfold * (1 - envelope.clarify);
        card.material.uniforms.uBlur.value = .035 * (1 - envelope.clarify);
        card.material.uniforms.uTint.value = .24 * (1 - envelope.clarify);
        for (const mesh of [card, light, core]) {
          // Main cards share the final mobile viewport; the separate cut is not
          // clipped. Travelling points stay free until they reach their slots.
          mesh.material.uniforms.uClipY.value.set(envelope.travel >= 1 ? target.clipBottom : -1, target.clipTop);
          if (mesh !== card) mesh.material.uniforms.uTime.value = time + i;
        }
      });
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true; hide(); root.removeFromParent(); arrivals.removeFromParent();
    geometry.dispose(); starsGeometry.dispose(); trailsGeometry.dispose(); runeGeometry.dispose(); starTexture.dispose();
    materials.forEach((material) => material.dispose());
    cards.forEach(({ comet }) => comet.geometry.dispose());
    root.clear(); arrivals.clear(); // The shared deck back texture is not owned.
  }
  return { update, hide, setTarget, dispose, arrivalLayer: arrivals };
}
