// Deterministic 180-degree turn, independent of layout/scroll interpolation.
export function getCardFlipPose({ from = Math.PI, to = 0, elapsed = 0, delay = 0, duration = 720 }, pose = {}) {
  const progress = duration <= 0 ? 1 : Math.max(0, Math.min(1, (elapsed - delay) / duration));
  const eased = progress * progress * (3 - 2 * progress);
  return Object.assign(pose, { rotationY: from + (to - from) * eased, progress, done: progress === 1 });
}
