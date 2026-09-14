import * as THREE from "three";

const vertexShader = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const glowFragment = `varying vec2 vUv; uniform float uOpacity; uniform float uTime; uniform vec3 uColor;
void main() {
  vec2 p = (vUv - .5) * 2.;
  float mist = exp(-dot(p,p)*4.7) * (1.-smoothstep(.4,1.,length(p)));
  float veil = .87 + .13*sin(p.x*5.+uTime*.6)*sin(p.y*4.-uTime*.4);
  gl_FragColor = vec4(uColor, mist * veil * uOpacity);
}`;
const backFragment = `varying vec2 vUv; uniform sampler2D uBack; uniform float uOpacity; uniform float uTime; uniform float uSeed;
void main() {
  float blur = .0025 + .003*(.5+.5*sin(uTime*.9+uSeed));
  vec4 ink = texture2D(uBack,vUv)*.4;
  ink += texture2D(uBack,vUv+vec2(blur,0.))*.15 + texture2D(uBack,vUv-vec2(blur,0.))*.15;
  ink += texture2D(uBack,vUv+vec2(0.,blur))*.15 + texture2D(uBack,vUv-vec2(0.,blur))*.15;
  float edge = smoothstep(0.,.04,min(min(vUv.x,1.-vUv.x),min(vUv.y,1.-vUv.y)));
  gl_FragColor = vec4(mix(ink.rgb,vec3(.85,.72,.43),.18), ink.a * edge * uOpacity);
}`;
const smooth = (n) => { const t = Math.min(1, Math.max(0, n)); return t * t * (3 - 2 * t); };

// An optical forward journey inside the existing renderer. The real camera and
// card identities never change. Only the already-loaded back texture is borrowed.
export function createReadingJourney(scene, { reducedMotion = false } = {}) {
  const root = new THREE.Group(), arrivals = new THREE.Group();
  root.name = "Starward reading journey";
  arrivals.name = "Reading position heartlights";
  root.visible = arrivals.visible = false;
  scene.add(root, arrivals);
  const geometry = new THREE.PlaneGeometry(1, 1);
  const materials = new Set();
  function shader(fragmentShader, uniforms, additive = true) {
    const material = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms,
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
  const cards = [], arrivalLights = [];
  let disposed = false;
  function ensureCount(count) {
    while (cards.length < count) {
      const material = shader(backFragment, { uBack: { value: null }, uOpacity: { value: 0 }, uTime: { value: 0 }, uSeed: { value: cards.length * 1.71 } }, false);
      const card = new THREE.Mesh(geometry, material);
      card.renderOrder = 504; card.frustumCulled = false; root.add(card);
      cards.push({ card, light: glow(root, 0xf7d290, 503) });
    }
    while (arrivalLights.length < count + 1) arrivalLights.push(glow(arrivals, 0xffdda0, 505));
  }
  function hide() { root.visible = arrivals.visible = false; }
  function clearArrival() { arrivalLights.forEach((mesh) => { mesh.visible = false; }); }
  function showArrival(slot, position, scale, strength) {
    const mesh = arrivalLights[slot];
    if (!mesh) return;
    mesh.visible = strength > .001;
    mesh.position.copy(position); mesh.position.z += .06;
    mesh.scale.set(scale * 1.9, scale * 2.6, 1);
    mesh.material.uniforms.uOpacity.value = strength;
  }
  function update({ active, elapsedMs = 0, arrival = 0, spread, backTexture, camera }) {
    if (disposed || !active || !spread || !backTexture) { hide(); return; }
    ensureCount(spread.count);
    root.visible = true; arrivals.visible = arrival > 0;
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
    const columns = Math.min(spread.count, aspect < .85 ? 3 : 7);
    const rows = Math.ceil(spread.count / columns);
    const width = Math.min(7.4, 5.2 * aspect), gap = width / Math.max(2, columns);
    const height = Math.min(1.9, gap * 1.15, 3.8 / (rows * 1.25));
    cards.forEach(({ card, light }, i) => {
      card.visible = light.visible = i < spread.count && exit > 0;
      if (!card.visible) return;
      const row = Math.floor(i / columns), rowCount = Math.min(columns, spread.count - row * columns);
      const x = ((i % columns) - (rowCount - 1) / 2) * gap;
      const y = ((rows - 1) / 2 - row) * height * 1.25;
      const shimmer = reducedMotion ? .6 : .48 + Math.sin(time * 1.65 + i * .87) * .19;
      card.position.set(x + (reducedMotion ? 0 : Math.sin(time * .74 + i) * .09), y + (reducedMotion ? 0 : Math.cos(time * .66 + i) * .10), -11 + (reducedMotion ? 0 : Math.sin(time * .85 + i * .3) * .65));
      card.rotation.set(reducedMotion ? 0 : Math.sin(time * .7 + i) * .09, reducedMotion ? 0 : Math.cos(time * .65 + i) * .19, reducedMotion ? 0 : Math.sin(time * .52 + i) * .055);
      card.scale.set(height * .604, height, 1);
      card.material.uniforms.uBack.value = backTexture;
      card.material.uniforms.uTime.value = time;
      card.material.uniforms.uOpacity.value = entry * exit * shimmer;
      light.position.copy(card.position); light.position.z += .01;
      light.scale.set(height * 1.7, height * 2.1, 1);
      light.material.uniforms.uOpacity.value = entry * exit * (shimmer * .45);
      light.material.uniforms.uTime.value = time + i;
    });
    arrivalLights.forEach((mesh) => { mesh.material.uniforms.uTime.value = time; });
  }
  function dispose() {
    if (disposed) return;
    disposed = true; hide(); root.removeFromParent(); arrivals.removeFromParent();
    geometry.dispose(); starsGeometry.dispose(); trailsGeometry.dispose(); runeGeometry.dispose(); starTexture.dispose();
    materials.forEach((material) => material.dispose());
    root.clear(); arrivals.clear(); // The shared deck back texture is not owned.
  }
  return { update, hide, clearArrival, showArrival, dispose };
}
