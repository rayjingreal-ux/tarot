const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const smooth = (value) => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

// A held-progress envelope, shared by cards and light. No per-frame randomness.
export function getShuffleEnvelope(progress, wave = {}) {
  const p = clamp(progress, 0, 1);
  const scatter = smooth((p - 0.25) / 0.25);
  const gather = smooth((p - 0.5) / 0.27);
  const burst = smooth((p - 0.77) / 0.17);
  return Object.assign(wave, { scatter, gather, burst, radius: 0.64 + 0.36 * scatter - 0.92 * gather + 0.92 * burst });
}
const shuffleWave = {};

// Poses for the existing 0.61 × 1.01 card meshes, never turning a face toward the camera.
export function getRitualCardPose(options, pose = {}) {
  const { phase, position, count, reducedMotion = false } = options;
  const aspect = clamp(options.aspect ?? 1.6, 0.35, 3.5);
  const mobile = aspect < 0.85;
  const energy = clamp(options.energy ?? 0, 0, 1);
  const progress = clamp(options.progress ?? 0, 0, 1);
  const time = reducedMotion ? 0 : options.time || 0;
  const focus = clamp(options.focus ?? 0, 0, Math.max(0, count - 1));
  const compact = Math.min(1, aspect / 1.65);
  Object.assign(pose, { x: 0, y: 0, z: 0.7, rx: 0, ry: Math.PI, rz: 0, scale: 0.5, visible: true });
  if (!Number.isInteger(position) || position < 0 || position >= count) {
    pose.visible = false;
    return pose;
  }
  if (phase === "shuffling") {
    const visibleCount = Math.min(count, 36);
    if (position >= visibleCount) { pose.visible = false; return pose; }
    const lane = position % 2;
    const angle = position / visibleCount * Math.PI * 2 + time * (lane ? -0.8 : 1);
    const radius = (lane ? 1.75 : 2.32) * (0.82 + energy * 0.18);
    pose.x = Math.cos(angle) * radius * compact;
    pose.y = -0.02 + Math.sin(angle) * (lane ? 0.4 : 0.65);
    pose.z = 0.6 + Math.sin(angle) * 0.38 + lane * 0.2;
    pose.rx = reducedMotion ? 0 : Math.sin(angle) * 0.13;
    pose.ry = Math.PI + (reducedMotion ? 0 : Math.cos(angle) * 0.18);
    pose.rz = Math.sin(angle + lane) * 0.32;
    pose.scale = (mobile ? 0.36 : 0.49) * (0.92 + energy * 0.08);
    if (!reducedMotion) {
      const wave = getShuffleEnvelope(progress, shuffleWave);
      const seed = ((position * 17 + 11) % 37) / 36;
      const finalAngle = position / visibleCount * Math.PI * 2 + seed * 0.24;
      const finalRadius = (lane ? 1.75 : 2.32) * (0.8 + seed * 0.2);
      const finalX = Math.cos(finalAngle) * finalRadius * compact;
      const finalY = Math.sin(finalAngle) * (lane ? 0.4 : 0.65);
      pose.x = (pose.x * (1 - wave.burst) + finalX * wave.burst) * wave.radius;
      pose.y = -0.02 + ((pose.y + 0.02) * (1 - wave.burst) + finalY * wave.burst) * wave.radius;
      const closed = wave.gather * (1 - wave.burst);
      pose.z = pose.z * (1 - closed) + (0.6 + position * 0.003) * closed;
      pose.z = pose.z * (1 - wave.burst) + (0.6 + Math.sin(finalAngle) * 0.38 + lane * 0.2) * wave.burst;
      pose.rx = wave.burst === 1 ? 0 : pose.rx * (1 - closed) * (1 - wave.burst);
      pose.ry = Math.PI + (pose.ry - Math.PI) * (1 - closed) * (1 - wave.burst);
      pose.rz = pose.rz * (1 - closed) * (1 - wave.burst) + Math.sin(finalAngle + lane) * 0.32 * wave.burst;
    }
  } else if (phase === "selecting" || phase === "revealing") {
    const relative = position - focus;
    const spacing = mobile ? Math.max(0.22, aspect * 0.51) : 0.46 * compact;
    const reach = mobile ? 3 : 5;
    pose.visible = Math.abs(relative) <= reach;
    pose.x = relative * spacing;
    pose.y = 0.18 - Math.pow(Math.min(Math.abs(relative), 7), 1.7) * 0.018;
    pose.z = 1.06 - Math.abs(relative) * 0.055;
    pose.rz = -relative * 0.038;
    pose.scale = mobile ? 0.92 : 1.17;
    if (phase === "revealing") {
      const selected = position === options.selectedPosition;
      const eased = 1 - Math.pow(1 - progress, 3);
      if (selected) {
        pose.visible = true;
        pose.x *= 1 - eased;
        pose.y += (0.2 - pose.y) * eased;
        pose.z += (1.55 - pose.z) * eased;
        pose.rz *= 1 - eased;
        pose.scale += (1.4 - pose.scale) * eased;
      } else {
        pose.y -= eased * 1.1;
        pose.z -= eased * 0.9;
        pose.scale *= 1 - eased * 0.8;
      }
    }
  } else pose.visible = false;
  return pose;
}
