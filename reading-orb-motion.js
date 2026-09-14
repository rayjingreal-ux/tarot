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
    arcX: (random() - .5) * .8, arcY: (random() - .5) * .6,
  }));
}

export function getReadingOrbPose(seed, { elapsedMs = 0, aspect = 1.6, fov = 32, reducedMotion = false }, pose = {}) {
  const time = reducedMotion ? 0 : elapsedMs / 1000;
  const z = -seed.depth + Math.sin(time * .48 + seed.drift) * .65;
  const halfHeight = -z * Math.tan(fov * Math.PI / 360);
  const halfWidth = halfHeight * Math.max(.35, Math.min(3.5, aspect));
  const x = Math.sin(time * seed.speedX + seed.phase) * .61 + Math.sin(time * .27 + seed.drift) * .1;
  const y = Math.sin(time * seed.speedY + seed.drift) * .35 + Math.cos(time * .31 + seed.phase) * .08 - .13;
  return Object.assign(pose, { x: x * halfWidth, y: y * halfHeight, z,
    size: seed.size * Math.min(1, Math.max(.6, aspect)), shimmer: .88 + Math.sin(time * 1.65 + seed.phase) * .12 });
}

export function getReadingOrbReturnPose(from, target, progress, seed, reducedMotion = false, pose = {}) {
  if (progress <= 0) return Object.assign(pose, { x: from.x, y: from.y, z: from.z });
  if (progress >= 1) return Object.assign(pose, { x: target.x, y: target.y, z: target.z });
  const t = smooth(progress), arc = reducedMotion ? 0 : Math.sin(Math.PI * t);
  return Object.assign(pose, { x: from.x + (target.x - from.x) * t + seed.arcX * arc,
    y: from.y + (target.y - from.y) * t + seed.arcY * arc,
    z: from.z + (target.z - from.z) * t - arc * .45 });
}
