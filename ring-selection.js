const TAU = Math.PI * 2;
const CARD_WIDTH = 0.61;
const CARD_HEIGHT = 1.01;
const CARD_RATIO = CARD_WIDTH / CARD_HEIGHT;
const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
const wrap = (value) => ((value % 1) + 1) % 1;

// Equal arc-length spacing keeps the short ends of a wide phone ellipse usable.
// Using original deck positions, rather than the remaining array index, leaves a
// stable empty slot whenever a card is cut or drawn.
function ellipseTable(rx, ry) {
  const steps = 256;
  const distances = [0];
  let previousX = 0, previousY = -ry;
  for (let i = 1; i <= steps; i++) {
    const angle = i / steps * TAU - Math.PI / 2;
    const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry;
    distances.push(distances[i - 1] + Math.hypot(x - previousX, y - previousY));
    previousX = x; previousY = y;
  }
  return { distances, total: distances[steps], steps };
}

function ellipseAngle(table, fraction) {
  const distance = wrap(fraction) * table.total;
  let low = 0, high = table.steps;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (table.distances[middle] <= distance) low = middle;
    else high = middle;
  }
  const segment = table.distances[high] - table.distances[low];
  return (low + (segment ? (distance - table.distances[low]) / segment : 0)) / table.steps * TAU - Math.PI / 2;
}

function clearPreviewHeight(rx, ry, cardHeight) {
  const halfWidth = cardHeight * CARD_RATIO / 2, halfHeight = cardHeight / 2;
  let fit = 220;
  // Separating-axis limits for an upright center rectangle against the entire
  // inner ellipse. Sampling the full path keeps preview size steady while the
  // ring rotates or loses cards. The final inset covers spaces between samples.
  for (let i = 0; i < 128; i++) {
    const angle = i / 128 * TAU;
    const x = Math.cos(angle) * rx, y = Math.sin(angle) * ry;
    const rotation = Math.atan2(y, x) + Math.PI / 2;
    const c = Math.cos(rotation), s = Math.sin(rotation), ac = Math.abs(c), as = Math.abs(s);
    const threshold = Math.max(
      (Math.abs(x) - ac * halfWidth - as * halfHeight) / (CARD_RATIO / 2),
      (Math.abs(y) - as * halfWidth - ac * halfHeight) / 0.5,
      (Math.abs(x * c + y * s) - halfWidth) / (CARD_RATIO / 2 * ac + 0.5 * as),
      (Math.abs(-x * s + y * c) - halfHeight) / (CARD_RATIO / 2 * as + 0.5 * ac));
    fit = Math.min(fit, threshold);
  }
  return Math.max(1, fit * 0.9);
}

/** Screen-space rectangles for every remaining card; rotation is in radians. */
export function getRingLayout({ positions = [], count = 78, rotation = 0, focusPosition = null,
  width = 390, height = 700, top = 100, bottom = height - 110 } = {}) {
  width = Math.max(1, finite(width, 390));
  height = Math.max(1, finite(height, 700));
  top = Math.max(0, Math.min(height - 1, finite(top, 100)));
  bottom = Math.max(top + 1, Math.min(height, finite(bottom, height - 110)));
  count = Math.max(1, Math.floor(finite(count, 78)));
  rotation = finite(rotation, 0);
  const margin = Math.min(16, width * 0.04);
  const usableWidth = Math.max(1, width - margin * 2);
  const usableHeight = bottom - top;
  const cardHeight = Math.min(80, usableWidth * 0.11, usableHeight * 0.14);
  const outerDiagonal = Math.hypot(cardHeight, cardHeight * CARD_RATIO);
  const rx = Math.max(0, (usableWidth - outerDiagonal) / 2);
  const ry = Math.max(0, (usableHeight - outerDiagonal) / 2);
  const center = { x: width / 2, y: (top + bottom) / 2 };
  const outerCount = Math.ceil(count * 0.6);
  const innerCount = count - outerCount;
  const rings = [
    { rx, ry, count: outerCount, height: cardHeight, table: ellipseTable(rx, ry) },
    { rx: rx * 0.60, ry: ry * 0.60, count: innerCount, height: cardHeight * 0.76,
      table: ellipseTable(rx * 0.60, ry * 0.60) },
  ];
  const seen = new Set();
  const cards = [];
  for (const position of positions) {
    if (!Number.isInteger(position) || position < 0 || position >= count || seen.has(position)) continue;
    seen.add(position);
    const lane = position < outerCount ? 0 : 1;
    const ring = rings[lane];
    const slot = lane ? position - outerCount : position;
    const angle = ellipseAngle(ring.table, (slot + lane * 0.5) / ring.count + rotation / TAU);
    const x = center.x + Math.cos(angle) * ring.rx;
    const y = center.y + Math.sin(angle) * ring.ry;
    // Long edges point out from the ellipse; fronts are never used in this batch.
    const rz = Math.atan2(y - center.y, x - center.x) + Math.PI / 2;
    cards.push({ position, lane, x, y, width: ring.height * CARD_RATIO, height: ring.height,
      rotation: rz, focused: position === focusPosition });
  }
  const previewHeight = clearPreviewHeight(rx * 0.60, ry * 0.60, cardHeight * 0.76);
  return { cards, center, preview: { ...center, width: previewHeight * CARD_RATIO, height: previewHeight },
    bounds: { left: margin, right: width - margin, top, bottom } };
}

function createBackGeometry(THREE) {
  const x = -CARD_WIDTH / 2, y = -CARD_HEIGHT / 2, radius = 0.025;
  const shape = new THREE.Shape();
  shape.moveTo(x + radius, y);
  shape.lineTo(x + CARD_WIDTH - radius, y);
  shape.quadraticCurveTo(x + CARD_WIDTH, y, x + CARD_WIDTH, y + radius);
  shape.lineTo(x + CARD_WIDTH, y + CARD_HEIGHT - radius);
  shape.quadraticCurveTo(x + CARD_WIDTH, y + CARD_HEIGHT, x + CARD_WIDTH - radius, y + CARD_HEIGHT);
  shape.lineTo(x + radius, y + CARD_HEIGHT);
  shape.quadraticCurveTo(x, y + CARD_HEIGHT, x, y + CARD_HEIGHT - radius);
  shape.lineTo(x, y + radius);
  shape.quadraticCurveTo(x, y, x + radius, y);
  const geometry = new THREE.ShapeGeometry(shape, 5);
  const vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++) {
    geometry.attributes.uv.setXY(i, vertices.getX(i) / CARD_WIDTH + 0.5, vertices.getY(i) / CARD_HEIGHT + 0.5);
  }
  geometry.attributes.uv.needsUpdate = true;
  return geometry;
}

/** One draw call, one shared back texture, and no face-image requests.
 * project(screenX, screenY, targetVector) must fill/return a THREE.Vector3 on the
 * existing card plane. The owner retains texture ownership across deck switches.
 */
export function createRingSelection({ THREE, capacity = 80 } = {}) {
  if (!THREE) throw new TypeError("createRingSelection requires THREE");
  const group = new THREE.Group();
  group.name = "ring-selection-backs";
  group.visible = false;
  const geometry = createBackGeometry(THREE);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, alphaTest: 0.08,
    side: THREE.DoubleSide, toneMapped: false });
  let allocated = Math.max(1, Math.ceil(finite(capacity, 80)));
  const makeBatch = () => {
    const next = new THREE.InstancedMesh(geometry, material, allocated);
    next.name = "all-remaining-card-backs";
    next.count = 0;
    next.frustumCulled = false;
    next.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    return next;
  };
  let batch = makeBatch();
  group.add(batch);
  const center = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const normal = new THREE.Vector3(), matrix = new THREE.Matrix4();
  const normalColor = new THREE.Color(0xffffff), focusColor = new THREE.Color(0xffe6bc);
  let positions = [], disposed = false;
  const projectInto = (project, x, y, target) => {
    const value = project(x, y, target);
    if (value && value !== target) target.copy(value);
    return target;
  };

  function update(options = {}) {
    if (disposed) return null;
    if (typeof options.project !== "function") throw new TypeError("ring update requires a screen-to-world project function");
    const layout = getRingLayout(options);
    if (layout.cards.length > allocated) {
      while (allocated < layout.cards.length) allocated *= 2;
      group.remove(batch);
      batch.dispose();
      batch = makeBatch();
      group.add(batch);
    }
    positions = layout.cards.map((card) => card.position);
    batch.count = positions.length;
    for (let i = 0; i < layout.cards.length; i++) {
      const card = layout.cards[i];
      const cosine = Math.cos(card.rotation), sine = Math.sin(card.rotation);
      projectInto(options.project, card.x, card.y, center);
      projectInto(options.project, card.x + cosine * card.width / 2, card.y + sine * card.width / 2, right);
      projectInto(options.project, card.x + sine * card.height / 2, card.y - cosine * card.height / 2, up);
      right.sub(center).multiplyScalar(2 / CARD_WIDTH);
      up.sub(center).multiplyScalar(2 / CARD_HEIGHT);
      normal.crossVectors(right, up).normalize();
      // Tiny deterministic depth offsets avoid z-fighting between overlapping backs.
      center.addScaledVector(normal, card.position * 0.000015);
      matrix.makeBasis(right, up, normal).setPosition(center);
      batch.setMatrixAt(i, matrix);
      batch.setColorAt(i, card.focused ? focusColor : normalColor);
    }
    batch.instanceMatrix.needsUpdate = true;
    if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    batch.computeBoundingSphere();
    group.updateMatrixWorld(true);
    return layout;
  }

  function setTexture(texture) {
    if (disposed || material.map === texture) return;
    const presenceChanged = Boolean(material.map) !== Boolean(texture);
    material.map = texture || null;
    if (presenceChanged) material.needsUpdate = true;
  }

  function pick(raycaster) {
    if (disposed || !group.visible || !batch.count) return null;
    const hit = raycaster.intersectObject(batch, false)[0];
    return hit && Number.isInteger(hit.instanceId) ? positions[hit.instanceId] ?? null : null;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    group.visible = false;
    group.remove(batch);
    batch.dispose();
    geometry.dispose();
    material.dispose();
    // Texture is shared with the main 3D cards, so never dispose it here.
    positions = [];
  }
  return { group, update, setTexture, pick, dispose };
}
