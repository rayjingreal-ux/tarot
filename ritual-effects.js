import * as THREE from "three";

const PHASES = new Set(["idle", "setup", "shuffling", "selecting", "revealing"]);
const TAU = Math.PI * 2;
const EFFECT_CENTER = Object.freeze({ x: 0, y: 0.2, z: 0.6 });

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

function smoothstep(value, edge0 = 0, edge1 = 1) {
  const amount = clamp01((value - edge0) / Math.max(0.00001, edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function damp(current, target, rate, dt) {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

function defaultAspect() {
  if (typeof window === "undefined" || !Number.isFinite(window.innerWidth) || !Number.isFinite(window.innerHeight)) {
    return 1;
  }
  return window.innerWidth / Math.max(1, window.innerHeight);
}

function createSeededRandom() {
  let seed = 0x72a4f19d;
  return () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
}

function createDataGlowTexture(size) {
  const data = new Uint8Array(size * size * 4);
  const center = (size - 1) * 0.5;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const alpha = Math.round(255 * Math.pow(Math.max(0, 1 - distance), 2.6));
      const offset = (y * size + x) * 4;
      data[offset] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alpha;
    }
  }
  return new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
}

function createGlowTexture(size = 96) {
  let texture = null;
  if (typeof document !== "undefined") {
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    if (context) {
      const center = size * 0.5;
      const gradient = context.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, "rgba(255,255,255,0.96)");
      gradient.addColorStop(0.12, "rgba(255,255,255,0.72)");
      gradient.addColorStop(0.42, "rgba(255,255,255,0.2)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      context.fillStyle = gradient;
      context.fillRect(0, 0, size, size);
      texture = new THREE.CanvasTexture(canvas);
    }
  }
  if (!texture) texture = createDataGlowTexture(size);
  texture.name = "Ritual effects radial glow";
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Creates the self-contained Three.js effects used by the one-card ritual.
 * The caller owns phase timing and may pass the current camera aspect to setState.
 */
export function createRitualEffects(scene, { reducedMotion = false } = {}) {
  if (!scene || typeof scene.add !== "function") {
    throw new TypeError("createRitualEffects requires a Three.js scene or Object3D parent.");
  }

  const isReduced = Boolean(reducedMotion);
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const random = createSeededRandom();
  const gold = new THREE.Color(0xf0bd64);
  const paleGold = new THREE.Color(0xffdfa0);
  const teal = new THREE.Color(0x4fc7b5);

  const root = new THREE.Group();
  root.name = "Single-card ritual effects";
  root.position.set(EFFECT_CENTER.x, EFFECT_CENTER.y, EFFECT_CENTER.z);
  root.visible = false;
  root.renderOrder = 3;
  scene.add(root);

  const glowTexture = createGlowTexture();
  textures.add(glowTexture);

  const maxParticleCount = isReduced ? 320 : 760;
  const particlePositions = new Float32Array(maxParticleCount * 3);
  const particleColors = new Float32Array(maxParticleCount * 3);
  const particleAngles = new Float32Array(maxParticleCount);
  const particleRadii = new Float32Array(maxParticleCount);
  const particleHeights = new Float32Array(maxParticleCount);
  const particleDepths = new Float32Array(maxParticleCount);
  const particleSpeeds = new Float32Array(maxParticleCount);
  const particlePhases = new Float32Array(maxParticleCount);

  for (let index = 0; index < maxParticleCount; index += 1) {
    const offset = index * 3;
    const angle = random() * TAU;
    const radius = Math.pow(random(), 0.68);
    const height = random() * 2 - 1;
    const depth = random() * 2 - 1;
    const mix = clamp01(random() * 1.2 - 0.1);
    particleAngles[index] = angle;
    particleRadii[index] = radius;
    particleHeights[index] = height;
    particleDepths[index] = depth;
    particleSpeeds[index] = 0.7 + random() * 0.9;
    particlePhases[index] = random() * TAU;
    particlePositions[offset] = Math.cos(angle) * (0.28 + radius * 2.05);
    particlePositions[offset + 1] = height * 0.72;
    particlePositions[offset + 2] = depth * 0.48;
    particleColors[offset] = gold.r + (teal.r - gold.r) * mix;
    particleColors[offset + 1] = gold.g + (teal.g - gold.g) * mix;
    particleColors[offset + 2] = gold.b + (teal.b - gold.b) * mix;
  }

  const particleGeometry = new THREE.BufferGeometry();
  const particlePositionAttribute = new THREE.BufferAttribute(particlePositions, 3);
  particlePositionAttribute.setUsage(THREE.DynamicDrawUsage);
  particleGeometry.setAttribute("position", particlePositionAttribute);
  particleGeometry.setAttribute("color", new THREE.BufferAttribute(particleColors, 3));
  particleGeometry.setDrawRange(0, maxParticleCount);
  geometries.add(particleGeometry);

  const particleMaterial = new THREE.PointsMaterial({
    map: glowTexture,
    color: 0xffffff,
    vertexColors: true,
    size: isReduced ? 0.036 : 0.041,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    alphaTest: 0.012,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  materials.add(particleMaterial);
  const particles = new THREE.Points(particleGeometry, particleMaterial);
  particles.name = "Gold and teal ritual stardust";
  particles.frustumCulled = false;
  particles.renderOrder = 3;
  root.add(particles);

  const maxTrailCount = isReduced ? 18 : 48;
  const trailPositions = new Float32Array(maxTrailCount * 6);
  const trailColors = new Float32Array(maxTrailCount * 6);
  const trailAngles = new Float32Array(maxTrailCount);
  const trailSpeeds = new Float32Array(maxTrailCount);
  const trailPhases = new Float32Array(maxTrailCount);
  for (let index = 0; index < maxTrailCount; index += 1) {
    const color = index % 3 === 1 ? teal : paleGold;
    const offset = index * 6;
    trailAngles[index] = random() * TAU;
    trailSpeeds[index] = 0.65 + random() * 0.75;
    trailPhases[index] = random();
    trailColors[offset] = color.r;
    trailColors[offset + 1] = color.g;
    trailColors[offset + 2] = color.b;
    trailColors[offset + 3] = color.r * 0.32;
    trailColors[offset + 4] = color.g * 0.32;
    trailColors[offset + 5] = color.b * 0.32;
  }

  const trailGeometry = new THREE.BufferGeometry();
  const trailPositionAttribute = new THREE.BufferAttribute(trailPositions, 3);
  trailPositionAttribute.setUsage(THREE.DynamicDrawUsage);
  trailGeometry.setAttribute("position", trailPositionAttribute);
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
  trailGeometry.setDrawRange(0, maxTrailCount * 2);
  geometries.add(trailGeometry);

  const trailMaterial = new THREE.LineBasicMaterial({
    color: 0xffffff,
    vertexColors: true,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthTest: true,
    depthWrite: false,
    toneMapped: false,
  });
  materials.add(trailMaterial);
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
  trails.name = "Inward ritual meteors";
  trails.frustumCulled = false;
  trails.renderOrder = 3;
  root.add(trails);

  const arcGeometry = new THREE.TorusGeometry(1, 0.0065, 4, isReduced ? 72 : 128, Math.PI * 1.48);
  geometries.add(arcGeometry);
  const arcCount = isReduced ? 2 : 4;
  const arcs = [];
  for (let index = 0; index < arcCount; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index % 2 === 0 ? gold : teal,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    materials.add(material);
    const mesh = new THREE.Mesh(arcGeometry, material);
    mesh.name = `Ritual orbit arc ${index + 1}`;
    mesh.position.z = -0.16 + index * 0.025;
    mesh.rotation.x = (index - (arcCount - 1) * 0.5) * 0.045;
    mesh.rotation.z = index * 1.41;
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    root.add(mesh);
    arcs.push({ mesh, material, offset: index * 1.41, direction: index % 2 === 0 ? 1 : -1 });
  }

  const pulseGeometry = new THREE.TorusGeometry(1, 0.008, 4, isReduced ? 64 : 112);
  geometries.add(pulseGeometry);
  const pulseCount = isReduced ? 2 : 3;
  const pulses = [];
  for (let index = 0; index < pulseCount; index += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: index === 1 ? teal : gold,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    materials.add(material);
    const mesh = new THREE.Mesh(pulseGeometry, material);
    mesh.name = `Ritual gathering pulse ${index + 1}`;
    mesh.position.z = -0.2 + index * 0.018;
    mesh.scale.set(0.4, 0.18, 1);
    mesh.frustumCulled = false;
    mesh.renderOrder = 2;
    root.add(mesh);
    pulses.push({ mesh, material, delay: index / pulseCount });
  }

  function createGlowSprite(color, name, z) {
    const material = new THREE.SpriteMaterial({
      map: glowTexture,
      color,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
    });
    materials.add(material);
    const sprite = new THREE.Sprite(material);
    sprite.name = name;
    sprite.position.z = z;
    sprite.scale.set(1, 0.56, 1);
    sprite.frustumCulled = false;
    sprite.renderOrder = 2;
    root.add(sprite);
    return { sprite, material };
  }

  const goldGlow = createGlowSprite(0xe9a84f, "Warm ritual glow", -0.23);
  const tealGlow = createGlowSprite(0x329f91, "Teal ritual glow", -0.27);

  const state = {
    phase: "idle",
    progress: 0,
    holding: false,
    aspect: defaultAspect(),
  };
  let disposed = false;
  let energy = 0;
  let motionClock = 0;
  let motionSpeed = 0;
  let particleOpacity = 0;
  let trailOpacity = 0;
  let arcOpacity = 0;
  let glowOpacity = 0;
  let activeParticleCount = maxParticleCount;
  let activeTrailCount = maxTrailCount;

  function applyAspect(aspect) {
    const narrow = aspect < 0.8;
    root.scale.x = narrow ? 0.45 : 1;
    root.scale.y = 1;
    root.scale.z = 1;
    activeParticleCount = narrow ? Math.min(320, maxParticleCount) : maxParticleCount;
    activeTrailCount = narrow ? Math.min(18, maxTrailCount) : maxTrailCount;
    particleGeometry.setDrawRange(0, activeParticleCount);
    trailGeometry.setDrawRange(0, activeTrailCount * 2);
  }

  function hideImmediately() {
    energy = 0;
    particleOpacity = 0;
    trailOpacity = 0;
    arcOpacity = 0;
    glowOpacity = 0;
    motionSpeed = 0;
    particleMaterial.opacity = 0;
    trailMaterial.opacity = 0;
    for (const arc of arcs) arc.material.opacity = 0;
    for (const pulse of pulses) pulse.material.opacity = 0;
    goldGlow.material.opacity = 0;
    tealGlow.material.opacity = 0;
    root.visible = false;
  }

  applyAspect(state.aspect);

  function setState(next = {}) {
    if (disposed) return;
    if (!next || typeof next !== "object") {
      throw new TypeError("ritual effect state must be an object.");
    }
    if (next.phase !== undefined) {
      if (!PHASES.has(next.phase)) throw new RangeError(`Unknown ritual effect phase: ${next.phase}`);
      state.phase = next.phase;
    }
    if (next.progress !== undefined) {
      if (!Number.isFinite(next.progress)) throw new TypeError("ritual effect progress must be finite.");
      state.progress = clamp01(next.progress);
    }
    if (next.holding !== undefined) state.holding = Boolean(next.holding);
    if (next.aspect !== undefined) {
      if (!Number.isFinite(next.aspect) || next.aspect <= 0) {
        throw new RangeError("ritual effect aspect must be a positive finite number.");
      }
      state.aspect = next.aspect;
      applyAspect(state.aspect);
    }
    if (state.phase === "idle") hideImmediately();
    else root.visible = true;
  }

  function updateMotionClock(dt) {
    if (isReduced) {
      motionSpeed = 0;
      return;
    }

    let targetSpeed = 0.025;
    if (state.phase === "shuffling") targetSpeed = 0.07 + energy * 0.48;
    else if (state.phase === "selecting") targetSpeed = 0.035;
    else if (state.phase === "revealing") targetSpeed = 0.06 + energy * 0.08;
    motionSpeed = damp(motionSpeed, targetSpeed, 4.5, dt);
    motionClock = (motionClock + motionSpeed * dt) % 4096;
  }

  function updateParticles(dt, revealBloom) {
    const progress = state.progress;
    let movementRate = state.phase === "shuffling" ? 4 + energy * 7 : 3.5;
    if (state.phase === "revealing") movementRate = 7;
    if (isReduced) movementRate = 0;
    const blend = 1 - Math.exp(-movementRate * dt);

    for (let index = 0; index < activeParticleCount; index += 1) {
      const offset = index * 3;
      const baseAngle = particleAngles[index];
      const radiusSeed = particleRadii[index];
      const heightSeed = particleHeights[index];
      const depthSeed = particleDepths[index];
      const speed = particleSpeeds[index];
      const phase = particlePhases[index];
      let targetX;
      let targetY;
      let targetZ;

      if (isReduced) {
        targetX = Math.cos(baseAngle) * (0.28 + radiusSeed * 2.05);
        targetY = heightSeed * 0.72;
        targetZ = depthSeed * 0.48;
      } else if (state.phase === "setup") {
        const angle = baseAngle + motionClock * speed;
        targetX = Math.cos(angle) * (0.3 + radiusSeed * 2.02);
        targetY = heightSeed * 0.72 + Math.sin(motionClock * 12.8 + phase) * 0.025;
        targetZ = depthSeed * 0.43 - 0.05;
      } else if (state.phase === "shuffling") {
        const gather = 1 - progress * 0.34;
        const angle = baseAngle + motionClock * speed + progress * 1.15;
        const radius = (0.25 + radiusSeed * 2.05) * gather;
        targetX = Math.cos(angle) * radius;
        targetY = Math.sin(angle * 1.18 + phase) * (0.18 + radiusSeed * 0.52) + heightSeed * 0.1;
        targetZ = depthSeed * 0.32 + Math.sin(angle * 1.9 + phase) * 0.1;
      } else if (state.phase === "selecting") {
        const angle = baseAngle + motionClock * speed;
        const radius = 0.36 + radiusSeed * 1.9;
        targetX = Math.cos(angle) * radius;
        targetY = Math.sin(angle) * (0.28 + radiusSeed * 0.42) + heightSeed * 0.08;
        targetZ = depthSeed * 0.3 - 0.04;
      } else {
        const outward = 0.24 + smoothstep(progress, 0.02, 0.82) * 2.02;
        const radius = outward * (0.42 + radiusSeed * 0.58);
        const angle = baseAngle + motionClock * speed;
        targetX = Math.cos(angle) * radius;
        targetY = Math.sin(angle) * radius * 0.34 + heightSeed * 0.09 * (1 - progress);
        targetZ = depthSeed * (0.22 + revealBloom * 0.28);
      }

      particlePositions[offset] += (targetX - particlePositions[offset]) * blend;
      particlePositions[offset + 1] += (targetY - particlePositions[offset + 1]) * blend;
      particlePositions[offset + 2] += (targetZ - particlePositions[offset + 2]) * blend;
    }
    particlePositionAttribute.needsUpdate = true;
  }

  function updateTrails() {
    const progress = state.progress;
    for (let index = 0; index < activeTrailCount; index += 1) {
      const offset = index * 6;
      const seedAngle = trailAngles[index];
      const speed = trailSpeeds[index];
      let headRadius;
      let tailRadius;
      let headAngle;
      let tailAngle;

      if (isReduced) {
        headRadius = 1.15 + trailPhases[index] * 0.72;
        tailRadius = Math.min(2.08, headRadius + 0.18);
        headAngle = seedAngle;
        tailAngle = seedAngle - 0.035;
      } else if (state.phase === "revealing") {
        const staggered = clamp01(progress * 1.22 - trailPhases[index] * 0.2);
        headRadius = 0.22 + staggered * 2.05;
        tailRadius = Math.max(0.12, headRadius - 0.32);
        headAngle = seedAngle;
        tailAngle = seedAngle;
      } else {
        const cycle = (motionClock * 0.48 * speed + trailPhases[index]) % 1;
        headRadius = 0.38 + (1 - cycle) * (1.88 - progress * 0.32);
        tailRadius = Math.min(2.35, headRadius + 0.2 + energy * 0.13);
        headAngle = seedAngle + cycle * 4.2 + progress * 0.72;
        tailAngle = headAngle - (0.04 + energy * 0.055);
      }

      trailPositions[offset] = Math.cos(headAngle) * headRadius;
      trailPositions[offset + 1] = Math.sin(headAngle) * headRadius * 0.34;
      trailPositions[offset + 2] = 0.04 + Math.sin(headAngle * 1.7) * 0.13;
      trailPositions[offset + 3] = Math.cos(tailAngle) * tailRadius;
      trailPositions[offset + 4] = Math.sin(tailAngle) * tailRadius * 0.34;
      trailPositions[offset + 5] = Math.sin(tailAngle * 1.7) * 0.13;
    }
    trailPositionAttribute.needsUpdate = true;
  }

  function updateArcs(dt, revealBloom) {
    const progress = state.progress;
    for (let index = 0; index < arcs.length; index += 1) {
      const arc = arcs[index];
      const shimmer = isReduced ? 1 : 0.9 + Math.sin(motionClock * 1.6 + index * 1.7) * 0.1;
      let width = 1.55 + index * 0.18;
      let height = 0.62 + index * 0.055;
      if (!isReduced && state.phase === "shuffling") {
        width *= 1 - progress * 0.12;
        height *= 1 - progress * 0.08;
      } else if (!isReduced && state.phase === "revealing") {
        width *= 0.72 + progress * 0.55;
        height *= 0.72 + progress * 0.55;
      }
      arc.mesh.scale.set(width, height, 1);
      arc.mesh.rotation.z = isReduced
        ? arc.offset
        : arc.offset + motionClock * 0.46 * arc.direction + progress * 0.28 * arc.direction;
      arc.material.opacity = damp(arc.material.opacity, arcOpacity * shimmer * (0.92 - index * 0.09), 8, dt);
      if (state.phase === "revealing") arc.material.opacity *= 0.78 + revealBloom * 0.22;
    }
  }

  function updatePulses(dt, revealBloom) {
    const progress = state.progress;
    for (let index = 0; index < pulses.length; index += 1) {
      const pulse = pulses[index];
      let scale;
      let opacity;
      if (isReduced) {
        scale = 1.55 + index * 0.24;
        opacity = arcOpacity * (state.phase === "revealing" ? revealBloom * 0.16 : 0.09);
      } else if (state.phase === "shuffling") {
        const cycle = (motionClock * 0.5 + pulse.delay + progress * 0.22) % 1;
        scale = 2.4 - cycle * 1.7;
        opacity = Math.sin(cycle * Math.PI) * arcOpacity * (state.holding ? 0.72 : 0.34);
      } else if (state.phase === "revealing") {
        const local = clamp01(progress * 1.25 - pulse.delay * 0.38);
        scale = 0.35 + smoothstep(local) * 2.2;
        opacity = (1 - local) * revealBloom * (isReduced ? 0.12 : 0.28);
      } else if (state.phase === "selecting") {
        scale = 1.55 + index * 0.24;
        opacity = arcOpacity * 0.12;
      } else {
        scale = 1.65 + index * 0.22;
        opacity = arcOpacity * 0.06;
      }
      pulse.mesh.scale.set(scale, scale * 0.38, 1);
      pulse.material.opacity = damp(pulse.material.opacity, opacity, 9, dt);
    }
  }

  function updateGlows(dt, revealBloom) {
    let goldWidth = 1.15 + energy * 0.72;
    let goldHeight = 0.6 + energy * 0.34;
    let tealWidth = 1.45 + energy * 0.65;
    let tealHeight = 0.72 + energy * 0.3;
    let goldTarget = glowOpacity;
    let tealTarget = glowOpacity * 0.55;

    if (isReduced) {
      goldWidth = 1.32;
      goldHeight = 0.68;
      tealWidth = 1.58;
      tealHeight = 0.78;
      if (state.phase === "revealing") {
        goldTarget *= 0.72 + revealBloom * 0.28;
        tealTarget *= 0.58;
      }
    } else if (state.phase === "revealing") {
      goldWidth = 0.72 + smoothstep(state.progress, 0, 0.88) * 2.55;
      goldHeight = 0.42 + smoothstep(state.progress, 0, 0.88) * 1.18;
      tealWidth = goldWidth * 0.83;
      tealHeight = goldHeight * 1.06;
      goldTarget *= 0.72 + revealBloom * 0.28;
      tealTarget *= 0.58;
    } else {
      goldTarget *= 0.96 + Math.sin(motionClock * 1.75) * 0.04;
      tealTarget *= 0.95 + Math.sin(motionClock * 1.37 + 1.7) * 0.05;
    }

    goldGlow.sprite.scale.set(goldWidth, goldHeight, 1);
    tealGlow.sprite.scale.set(tealWidth, tealHeight, 1);
    goldGlow.material.opacity = damp(goldGlow.material.opacity, goldTarget, 8, dt);
    tealGlow.material.opacity = damp(tealGlow.material.opacity, tealTarget, 7, dt);
  }

  function update(dt, _time) {
    if (disposed || state.phase === "idle") return;
    const safeDt = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;

    const progress = state.progress;
    const revealBloom = state.phase === "revealing" ? Math.sin(Math.PI * smoothstep(progress)) : 0;
    const revealFade = state.phase === "revealing" ? 1 - smoothstep(progress, 0.68, 1) : 1;
    let targetEnergy = 0.06;
    let targetParticles = 0.045;
    let targetTrails = 0;
    let targetArcs = 0.022;
    let targetGlow = 0.025;

    if (state.phase === "shuffling") {
      targetEnergy = 0.17 + progress * 0.4 + (state.holding ? 0.29 : 0.07);
      targetParticles = 0.1 + targetEnergy * (state.holding ? 0.42 : 0.24);
      targetTrails = 0.025 + targetEnergy * (state.holding ? 0.5 : 0.17);
      targetArcs = 0.06 + targetEnergy * (state.holding ? 0.37 : 0.2);
      targetGlow = 0.035 + targetEnergy * 0.13;
    } else if (state.phase === "selecting") {
      targetEnergy = 0.18;
      targetParticles = 0.11;
      targetTrails = 0.018;
      targetArcs = 0.13;
      targetGlow = 0.055;
    } else if (state.phase === "revealing") {
      targetEnergy = (0.14 + revealBloom * 0.66) * revealFade;
      targetParticles = (0.08 + revealBloom * 0.36) * revealFade;
      targetTrails = (0.02 + revealBloom * 0.24) * revealFade;
      targetArcs = (0.07 + revealBloom * 0.24) * revealFade;
      targetGlow = (0.055 + revealBloom * 0.2) * revealFade;
    }

    if (isReduced) {
      targetEnergy *= 0.56;
      targetParticles *= 0.68;
      targetTrails *= 0.44;
      targetArcs *= 0.62;
      targetGlow *= 0.62;
    }

    energy = damp(energy, clamp01(targetEnergy), 5.5, safeDt);
    particleOpacity = damp(particleOpacity, targetParticles, 6, safeDt);
    trailOpacity = damp(trailOpacity, targetTrails, 7, safeDt);
    arcOpacity = damp(arcOpacity, targetArcs, 6, safeDt);
    glowOpacity = damp(glowOpacity, targetGlow, 5.5, safeDt);
    particleMaterial.opacity = particleOpacity;
    trailMaterial.opacity = trailOpacity;

    updateMotionClock(safeDt);
    updateParticles(safeDt, revealBloom);
    updateTrails();
    updateArcs(safeDt, revealBloom);
    updatePulses(safeDt, revealBloom);
    updateGlows(safeDt, revealBloom);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    hideImmediately();
    root.removeFromParent();
    root.clear();
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    geometries.clear();
    materials.clear();
    textures.clear();
  }

  return { setState, update, dispose };
}
