const smooth = (n) => { const t = Math.max(0, Math.min(1, n)); return t * t * (3 - 2 * t); };

// Cosmetic seeds are sampled once per journey, independently of the draw session.
// Every frame samples the same smooth path, never a fresh random coordinate.
export function createReadingOrbSeeds(count, random = Math.random, mainCount = count) {
  const hue = random(), rotation = random() * Math.PI * 2;
  const orbitSpeed = .48 + random() * .12, orbitDirection = random() < .5 ? -1 : 1;
  const step = Math.PI * 2 / Math.max(1, mainCount);
  return Array.from({ length: count }, (_, index) => ({
    orbitId: index, orbitSpeed, orbitDirection, orbitStep: step,
    orbitPhase: rotation + (index % Math.max(1, mainCount)) * step + (random() - .5) * step * .18,
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
function outerOrbit(seed, time, pose = {}) {
  // Bound individual drift by the spacing of this spread, so independent
  // wandering cannot accumulate into three or more lights chasing one point.
  const spacing = Math.min(1, seed.orbitStep);
  const breathingRoom = smooth((seed.orbitStep - .5) / .4);
  const heading = seed.orbitPhase + seed.orbitDirection * seed.orbitSpeed * time
    + spacing * (.14 + .06 * breathingRoom) * (Math.sin(time * .8 + seed.drift) - Math.sin(seed.drift))
    + spacing * (.035 + .01 * breathingRoom) * (Math.sin(time * .43 + seed.turn) - Math.sin(seed.turn));
  const cycle = time / (3.5 + seed.speedY) + seed.turn / (Math.PI * 2);
  const epoch = Math.floor(cycle), phase = cycle - epoch;
  const pulse = noise(seed.wander, epoch + 19) > -.3
    ? Math.sin(Math.PI * phase) ** 2 * smooth(time / .65) : 0;
  const radius = .90 + .035 * Math.sin(seed.phase) + .02 * Math.sin(time * .65 + seed.drift)
    + pulse * (.17 + .05 * noise(seed.wander, epoch + 43));
  return Object.assign(pose, { u: Math.cos(heading) * radius, v: Math.sin(heading) * radius, orbitPulse: pulse });
}

export function getReadingOrbPose(seed, { elapsedMs = 0, aspect = 1.6, fov = 32, reducedMotion = false }, pose = {}) {
  const time = reducedMotion ? 0 : elapsedMs / 1000;
  // Recede without collapsing the whole field into the centre. The outer
  // orbit expands partially in world space, while heads retain true 1/z size.
  const flight = 1 - Math.exp(-Math.max(0, time) / (2.9 + seed.speedX));
  const near = 9.8 + (seed.depth - 10.2) * .32, far = 25.2 + seed.speedY;
  const z = -(near + (far - near) * flight);
  const halfHeight = -z * Math.tan(fov * Math.PI / 360);
  const halfWidth = halfHeight * Math.max(.35, Math.min(3.5, aspect));
  outerOrbit(seed, time, pose);
  const perspective = (near / -z) ** .16;
  pose.u *= perspective; pose.v *= perspective;
  const depthOpacity = 1 - flight * .32;
  return Object.assign(pose, { x: pose.u * .86 * halfWidth, y: (pose.v * .68 - .08) * halfHeight, z,
    size: seed.size * Math.min(1, Math.max(.6, aspect)) * (1 - flight * .18),
    depthOpacity, shimmer: (.88 + Math.sin(time * 1.65 + seed.phase) * .12) * depthOpacity });
}

// Short encounters are reconstructed from an analytic window start. That makes
// choices stable across frame rates, resize, long waits and direct time samples.
// Only nearby pairs qualify; each light has at most one partner, then a cooldown.
export function getReadingOrbFieldPoses(seeds, options, poses = []) {
  const aspect = Math.max(.35, Math.min(3.5, options.aspect ?? 1.6));
  const time = options.reducedMotion ? 0 : (options.elapsedMs ?? 0) / 1000;
  const tangent = Math.tan((options.fov ?? 32) * Math.PI / 360);
  for (let i = 0; i < seeds.length; i++) {
    const p = poses[i] ??= {};
    getReadingOrbPose(seeds[i], options, p);
    p.bx = p.u; p.by = p.v;
    p.dx = p.dy = p.encounterWeight = 0;
    p.partner = -1; p.encounterMode = 0;
  }
  const windowSeconds = 2.15, duration = 1.55, epoch = Math.floor(time / windowSeconds);
  const local = time - epoch * windowSeconds;
  if (local < duration && !options.reducedMotion) {
    const anchors = seeds.map((seed) => getReadingOrbPose(seed, { ...options, elapsedMs: epoch * windowSeconds * 1000 }));
    const candidates = [];
    for (let i = 0; i < seeds.length; i++) for (let j = i + 1; j < seeds.length; j++) {
      const distance = Math.hypot(anchors[i].u - anchors[j].u, anchors[i].v - anchors[j].v);
      if (distance < .34 && Math.abs(anchors[i].z - anchors[j].z) < 3) candidates.push({ i, j, distance,
        low: Math.min(seeds[i].orbitId, seeds[j].orbitId), high: Math.max(seeds[i].orbitId, seeds[j].orbitId) });
    }
    candidates.sort((a, b) => a.distance - b.distance || a.low - b.low || a.high - b.high);
    const taken = new Set(), progress = local / duration, envelope = Math.sin(Math.PI * progress) ** 2;
    for (const pair of candidates) {
      const { i, j } = pair;
      if (taken.has(i) || taken.has(j)) continue;
      taken.add(i); taken.add(j);
      const a = poses[i], b = poses[j];
      const key = seeds[i].wander + seeds[j].wander + pair.low * 97 + pair.high * 113;
      const choice = noise(key, epoch * 7 + 3), mode = choice > -.15 ? 1 : -1;
      const x = (a.bx - b.bx) / 2, y = (a.by - b.by) / 2, distance = Math.hypot(x, y) * 2;
      const proximity = 1 - smooth((distance - .30) / .25);
      a.partner = seeds[j].orbitId; b.partner = seeds[i].orbitId;
      a.encounterMode = b.encounterMode = mode;
      a.encounterWeight = b.encounterWeight = envelope * proximity;
      if (mode < 0) {
        const angle = (noise(key, epoch + 11) < 0 ? -1 : 1) * 3.8 * envelope;
        const radius = 1 - .28 * envelope, c = Math.cos(angle), s = Math.sin(angle);
        const dx = ((x * c - y * s) * radius - x) * proximity;
        const dy = ((x * s + y * c) * radius - y) * proximity;
        a.dx += dx; a.dy += dy; b.dx -= dx; b.dy -= dy;
      } else {
        // Use the stable contact direction if the base paths cross exactly.
        const contactX = anchors[i].u - anchors[j].u, contactY = anchors[i].v - anchors[j].v;
        const contactLength = Math.max(.001, Math.hypot(contactX, contactY));
        const push = envelope * proximity * (.07 + .025 * choice);
        a.dx += contactX / contactLength * push; a.dy += contactY / contactLength * push;
        b.dx -= contactX / contactLength * push; b.dy -= contactY / contactLength * push;
      }
      const release = Math.sin(Math.PI * smooth((progress - .5) / .5)) ** 2;
      const outward = mode > 0 ? envelope * proximity * .19 : release * proximity * .17;
      for (const p of [a, b]) {
        const radius = Math.max(.001, Math.hypot(p.bx, p.by));
        p.dx += p.bx / radius * outward; p.dy += p.by / radius * outward;
      }
    }
  }
  for (let i = 0; i < seeds.length; i++) {
    const p = poses[i], halfHeight = -p.z * tangent;
    const x = p.bx + p.dx, y = p.by + p.dy, radius = Math.hypot(x, y);
    const heading = radius > .001 ? Math.atan2(y, x) : seeds[i].orbitPhase;
    // A soft annulus stops attraction from pulling the field into the centre;
    // the generous outer bound leaves room for release pulses and broad arcs.
    const bounded = .66 + .37 * smooth((radius - .58) / .53);
    p.u = Math.cos(heading) * bounded; p.v = Math.sin(heading) * bounded;
    p.x = p.u * .86 * aspect * halfHeight;
    p.y = (p.v * .68 - .08) * halfHeight;
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
