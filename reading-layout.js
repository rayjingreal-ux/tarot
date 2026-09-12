const CARD_RATIO = 0.61 / 1.01;
const GAP = 8;
const NAME_GAP = 8;

export function readingNameWidth(width, spread, { cut = false, detail = false } = {}) {
  if (detail) return Math.min(380, width - 32);
  if (cut) return Math.min(120, width * 0.28);
  const xs = spread.slots.map((slot) => slot.x);
  const span = Math.max(...xs) - Math.min(...xs);
  // Leave a clear gutter for the native scrollbar without covering card names.
  return Math.min(240, (width - 48 - span * GAP) / (span + 1));
}

// Screen-space fitting keeps original semantic slots and 3D card proportions.
// Label heights come from the rendered, fully wrapped names, not character guesses.
export function fitReadingLayout({ width, height, top = 120, footerTop = height - 80, bottomPadding = 16,
  spread, mainLabelHeight = 34, cutLabelHeight = 34, detailLabelHeight = 34, detail = false }) {
  const xs = spread.slots.map((slot) => slot.x), ys = spread.slots.map((slot) => slot.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = maxX - minX, spanY = maxY - minY;
  const cutHeight = Math.min(110, Math.max(54, height * 0.11));
  const cut = { x: 16 + readingNameWidth(width, spread, { cut: true }) / 2, y: height - bottomPadding - cutHeight / 2,
    width: cutHeight * CARD_RATIO, height: cutHeight };
  const cutTop = cut.y - cut.height / 2 - cutLabelHeight - NAME_GAP;
  const bottom = Math.min(footerTop - 12, detail ? height - bottomPadding : cutTop - 12);
  const availableHeight = Math.max(1, bottom - top);
  if (detail) {
    const cardHeight = Math.max(1, Math.min(availableHeight - detailLabelHeight - NAME_GAP, (width - 32) / CARD_RATIO));
    return { detail: { x: width / 2, y: top + (availableHeight + detailLabelHeight + NAME_GAP) / 2,
      width: cardHeight * CARD_RATIO, height: cardHeight }, cut, cards: [] };
  }
  const columnWidth = readingNameWidth(width, spread);
  const fittedHeight = (availableHeight - spanY * GAP) / (spanY + 1) - mainLabelHeight - NAME_GAP;
  const minimumHeight = Math.min(84, columnWidth / CARD_RATIO, Math.max(24, availableHeight - mainLabelHeight - NAME_GAP));
  const cardHeight = Math.max(minimumHeight, Math.min(330, columnWidth / CARD_RATIO, fittedHeight));
  const cardWidth = cardHeight * CARD_RATIO;
  const columnStep = Math.max(cardWidth, columnWidth) + GAP;
  const rowStep = cardHeight + mainLabelHeight + NAME_GAP + GAP;
  const groupHeight = spanY * rowStep + cardHeight + mainLabelHeight + NAME_GAP;
  const scrollable = groupHeight > availableHeight + 0.5;
  const firstCenterY = top + (scrollable ? 0 : (availableHeight - groupHeight) / 2) + mainLabelHeight + NAME_GAP + cardHeight / 2;
  return { cut, scrollable, top, bottom, contentHeight: groupHeight, viewportHeight: availableHeight,
    cards: spread.slots.map((slot) => ({
    x: width / 2 + (slot.x - (minX + maxX) / 2) * columnStep,
    y: firstCenterY + (slot.y - minY) * rowStep, width: cardWidth, height: cardHeight,
  })) };
}
