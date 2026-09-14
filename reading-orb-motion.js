const smooth = (n) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };

// Cosmetic seeds are sampled once per journey, independently of the draw session.
// Every frame samples the same smooth path, never a fresh random coordinate.
export function createReadingOrbSeeds(count, random = Math.random) {
  const hue = random();
  return Array.from({ length: count }, (_, index) => ({
    hue: (hue + index * .61803398875 + random() * .16) % 1,
    phase: random() * Math.PI * 2 + index * 2.399963,
    drift: random() * Math.PI * 2,
    speedX: .52 + random() * .46, speedY: .43 + random() * .39,
    depth: 10.2 + random() * 2.2, size: .85 + random() * .3,
    wander: random() * 1000, turn: random() * Math.PI * 2,
    arcX: (random() - .5) * .8, arcY: (random() - .5) * .6,
  }));
}

const noise = (seed, key) => {
  const value = Math.sin(seed * 127.1 + key * 311.7) * 43758.5453;
  return (value - Math.floor(value)) * 2 - 1;
};
// Catmull-Rom keeps the tangent continuous through each random waypoint; unlike
// easing between stops, a comet does not pause at every change of direction.
function wander(seed, time, channel) {
  const phase = time / 4.8 + seed.drift, segment = Math.floor(phase), t = phase - segment;
  const sample = (offset) => noise(seed.wander + channel * 53, segment + offset);
  const a = sample(-1), b = sample(0), c = sample(1), d = sample(2);
  return .5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
}

export function getReadingOrbPose(seed, { elapsedMs = 0, aspect = 1.6, fov = 32, reducedMotion = false }, pose = {}) {
  const time = reducedMotion ? 0 : elapsedMs / 1000;
  // Recede continuously, never wrap back toward the viewer on a slow load.
  // Keep lateral radii at a fixed reference depth: multiplying them by the
  // current distance would cancel perspective and make this a flat orbit.
  const flight = 1 - Math.exp(-Math.max(0, time) / (2.9 + seed.speedX));
  const near = 9.8 + (seed.depth - 10.2) * .32, far = 25.2 + seed.speedY;
  const z = -(near + (far - near) * flight);
  const halfHeight = 11 * Math.tan(fov * Math.PI / 360);
  const halfWidth = halfHeight * Math.max(.35, Math.min(3.5, aspect));
  const heading = seed.phase + time * (.45 + seed.speedX * .32) + wander(seed, time * .55, 0) * .45;
  const x = Math.cos(heading) * .94 + wander(seed, time * .7, 0) * .16;
  const y = Math.sin(heading) * .64 + wander(seed, time * .7, 1) * .09 - .13;
  const depthOpacity = 1 - flight * .32;
  return Object.assign(pose, { x: x * halfWidth, y: y * halfHeight, z,
    size: seed.size * Math.min(1, Math.max(.6, aspect)) * (1 - flight * .18),
    depthOpacity, shimmer: (.88 + Math.sin(time * 1.65 + seed.phase) * .12) * depthOpacity });
}

// Screen-near lights share bounded, reciprocal vortices. Evaluate every base
// first, then all pairs, so the result is independent of iteration order/FPS.
export function getReadingOrbFieldPoses(seeds, options, poses = []) {
  const aspect = Math.max(.35, Math.min(3.5, options.aspect ?? 1.6));
  const time = options.reducedMotion ? 0 : (options.elapsedMs ?? 0) / 1000;
  const tangent = Math.tan((options.fov ?? 32) * Math.PI / 360);
  for (let i = 0; i < seeds.length; i++) {
    const p = poses[i] ??= {};
    getReadingOrbPose(seeds[i], options, p);
    p.bx = p.x / (-p.z * tangent); p.by = p.y / (-p.z * tangent);
    p.dx = p.dy = p.weight = 0;
  }
  const weight = (a, b) => (1 - smooth((Math.hypot(a.bx - b.bx, a.by - b.by) - .06) / .64))
    * (1 - smooth((Math.abs(a.z - b.z) - 1.5) / 7));
  for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) {
    const w = weight(poses[i], poses[j]); poses[i].weight += w; poses[j].weight += w;
  }
  for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) {
    const a = poses[i], b = poses[j], w = weight(a, b);
    if (!w) continue;
    const phase = time * 1.65 + seeds[i].turn + seeds[j].turn;
    const angle = w * 3.5 * Math.sin(phase);
    const radius = 1 + w * .34 * Math.sin(phase + Math.PI / 2);
    let x = (a.bx - b.bx) / 2, y = (a.by - b.by) / 2;
    if (Math.hypot(x, y) < .001) {
      const side = Math.sign(seeds[i].phase - seeds[j].phase);
      x = Math.cos(phase) * .001 * side; y = Math.sin(phase) * .001 * side;
    }
    const c = Math.cos(angle), s = Math.sin(angle), divisor = Math.max(1, a.weight, b.weight);
    const dx = ((x * c - y * s) * radius - x) / divisor;
    const dy = ((x * s + y * c) * radius - y) / divisor;
    a.dx += dx; a.dy += dy; b.dx -= dx; b.dy -= dy;
  }
  for (let i = 0; i < seeds.length; i++) {
    const p = poses[i], halfHeight = -p.z * tangent;
    // Smooth bounds keep passing comets inside the view without edge impacts.
    p.x = .72 * Math.tanh((p.bx + p.dx) / (aspect * .72)) * aspect * halfHeight;
    p.y = .56 * Math.tanh((p.by + p.dy) / .56) * halfHeight;
  }
  poses.length = seeds.length;
  return poses;
}

export function createReadingCometHistory(capacity = 48) {
  return { positions: new Float32Array(capacity * 3), times: new Float64Array(capacity),
    capacity, count: 0, head: -1, sampledAt: -Infinity, now: 0 };
}

export function recordReadingCometHead(history, position, time) {
  if (time < history.now) { history.count = 0; history.head = -1; history.sampledAt = -Infinity; }
  if (!history.count || time - history.sampledAt >= 25) {
    history.head = (history.head + 1) % history.capacity;
    history.count = Math.min(history.capacity, history.count + 1); history.sampledAt = time;
  }
  history.now = time;
  const offset = history.head * 3;
  history.positions[offset] = position.x; history.positions[offset + 1] = position.y; history.positions[offset + 2] = position.z;
  history.times[history.head] = time;
}

export function getReadingOrbReturnPose(from, target, progress, seed, reducedMotion = false, pose = {}) {
  if (progress <= 0) return Object.assign(pose, { x: from.x, y: from.y, z: from.z });
  if (progress >= 1) return Object.assign(pose, { x: target.x, y: target.y, z: target.z });
  const t = smooth(progress), arc = reducedMotion ? 0 : Math.sin(Math.PI * t);
  return Object.assign(pose, { x: from.x + (target.x - from.x) * t + seed.arcX * arc,
    y: from.y + (target.y - from.y) * t + seed.arcY * arc,
    z: from.z + (target.z - from.z) * t - arc * .45 });
}
