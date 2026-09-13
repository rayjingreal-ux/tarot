const DEFAULT_MOTION = Object.freeze({
  minPitch: -0.06,
  maxPitch: -0.01,
  maxFloat: 0.022,
  edgeScale: 1.004,
  coverGap: 0.015,
  frameFill: 0.9,
  yawSamples: 180,
  pitchSamples: 9,
  distancePadding: 0.025,
});

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function getPreviewBoxes(definition, motion) {
  const width = positiveNumber(definition?.width, 1);
  const height = positiveNumber(definition?.height, 1.54);
  const depth = positiveNumber(definition?.depth, 0.4);
  const coverDepth = Math.max(0, finiteNumber(definition?.coverDepth, 0));
  const edgeScale = positiveNumber(motion.edgeScale, DEFAULT_MOTION.edgeScale);
  const boxes = [{
    centerZ: 0,
    halfWidth: width * edgeScale / 2,
    halfHeight: height * edgeScale / 2,
    halfDepth: depth * edgeScale / 2,
  }];

  if (definition?.bookStyle && coverDepth > 0) {
    boxes.push({
      centerZ: depth / 2 + coverDepth / 2 + Math.max(0, finiteNumber(motion.coverGap, DEFAULT_MOTION.coverGap)),
      halfWidth: width * edgeScale / 2,
      halfHeight: height * edgeScale / 2,
      halfDepth: coverDepth * edgeScale / 2,
    });
  }
  return boxes;
}

function visitPreviewCorners(definition, options, visitor) {
  const motion = { ...DEFAULT_MOTION, ...options };
  const boxes = getPreviewBoxes(definition, motion);
  const yawSamples = Math.max(8, Math.round(positiveNumber(motion.yawSamples, DEFAULT_MOTION.yawSamples)));
  const pitchSamples = Math.max(2, Math.round(positiveNumber(motion.pitchSamples, DEFAULT_MOTION.pitchSamples)));
  const minPitch = finiteNumber(motion.minPitch, DEFAULT_MOTION.minPitch);
  const maxPitch = finiteNumber(motion.maxPitch, DEFAULT_MOTION.maxPitch);
  const maxFloat = Math.max(0, finiteNumber(motion.maxFloat, DEFAULT_MOTION.maxFloat));

  for (let yawIndex = 0; yawIndex < yawSamples; yawIndex += 1) {
    const yaw = yawIndex / yawSamples * Math.PI * 2;
    const cosYaw = Math.cos(yaw);
    const sinYaw = Math.sin(yaw);
    for (let pitchIndex = 0; pitchIndex < pitchSamples; pitchIndex += 1) {
      const pitchProgress = pitchIndex / (pitchSamples - 1);
      const pitch = minPitch + (maxPitch - minPitch) * pitchProgress;
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      for (const floatY of [-maxFloat, maxFloat]) {
        for (const box of boxes) {
          for (const sideX of [-1, 1]) {
            const localX = sideX * box.halfWidth;
            for (const sideY of [-1, 1]) {
              const localY = sideY * box.halfHeight;
              for (const sideZ of [-1, 1]) {
                const localZ = box.centerZ + sideZ * box.halfDepth;
                // Three.js Euler order YXZ with z rotation fixed at zero.
                const pitchedY = cosPitch * localY - sinPitch * localZ;
                const pitchedZ = sinPitch * localY + cosPitch * localZ;
                visitor(
                  cosYaw * localX + sinYaw * pitchedZ,
                  pitchedY + floatY,
                  -sinYaw * localX + cosYaw * pitchedZ,
                );
              }
            }
          }
        }
      }
    }
  }
}

export function calculateDeckCarouselCameraFit(definition, aspect, options = {}) {
  const motion = { ...DEFAULT_MOTION, ...options };
  const safeAspect = positiveNumber(aspect, 1);
  const verticalFov = positiveNumber(options.verticalFovDegrees, 28) * Math.PI / 180;
  const halfVertical = Math.tan(verticalFov / 2);
  const frameFill = Math.min(0.96, Math.max(0.5, positiveNumber(motion.frameFill, DEFAULT_MOTION.frameFill)));
  const horizontalSlope = halfVertical * safeAspect * frameFill;
  const verticalSlope = halfVertical * frameFill;
  let distance = 0;

  visitPreviewCorners(definition, motion, (x, y, z) => {
    distance = Math.max(
      distance,
      z + Math.abs(x) / horizontalSlope,
      z + Math.abs(y) / verticalSlope,
    );
  });

  distance += Math.max(0, finiteNumber(motion.distancePadding, DEFAULT_MOTION.distancePadding));
  return {
    distance,
    frameFill,
    verticalFovDegrees: verticalFov * 180 / Math.PI,
    aspect: safeAspect,
  };
}

export function measureDeckCarouselFrameOccupancy(definition, aspect, distance, options = {}) {
  const safeAspect = positiveNumber(aspect, 1);
  const safeDistance = positiveNumber(distance, 1);
  const verticalFov = positiveNumber(options.verticalFovDegrees, 28) * Math.PI / 180;
  const halfVertical = Math.tan(verticalFov / 2);
  let width = 0;
  let height = 0;

  visitPreviewCorners(definition, options, (x, y, z) => {
    const cameraDepth = safeDistance - z;
    if (cameraDepth <= 0) {
      width = Infinity;
      height = Infinity;
      return;
    }
    width = Math.max(width, Math.abs(x) / (cameraDepth * halfVertical * safeAspect));
    height = Math.max(height, Math.abs(y) / (cameraDepth * halfVertical));
  });

  return { width, height, maximum: Math.max(width, height) };
}

export { DEFAULT_MOTION as DECK_CAROUSEL_FIT_DEFAULTS };
