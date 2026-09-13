const CARD_RATIO = 0.61 / 1.01;

// Twelve houses keeps its original four-row ring, including the centre guide card.
// Compact text is measured by the caller; unusually long labels still get a
// scrollable layout instead of being clipped or squeezed below a usable size.
export function readingLayoutMetrics(width, spread, { detail = false } = {}) {
  const compact = width <= 680 && spread.id === "houses" && !detail;
  return compact
    ? { compact, gap: 4, labelGap: 3, headerGap: 6, footerGap: 8 }
    : { compact, gap: 8, labelGap: 8, headerGap: 16, footerGap: 12 };
}

export function readingNameWidth(width, spread, { cut = false, detail = false } = {}) {
  if (detail) return Math.min(380, width - 32);
  // The mobile toolbar starts at 30%; keep both cut captions to its left.
  if (cut) return Math.min(120, Math.max(56, width * 0.3 - 24));
  const { gap } = readingLayoutMetrics(width, spread);
  const xs = spread.slots.map((slot) => slot.x);
  const span = Math.max(...xs) - Math.min(...xs);
  // Leave a clear gutter for the native scrollbar without covering card names.
  return Math.min(240, (width - 48 - span * gap) / (span + 1));
}

// Screen-space fitting keeps original semantic slots and 3D card proportions.
// Label heights come from the rendered, fully wrapped names, not character guesses.
export function fitReadingLayout({ width, height, top = 120, footerTop = height - 80, bottomPadding = 16,
  spread, mainLabelHeight = 34, cutLabelHeight = 34, detailLabelHeight = 34,
  mainTopLabelHeight = mainLabelHeight, mainBottomLabelHeight = 0,
  cutTopLabelHeight = cutLabelHeight, cutBottomLabelHeight = 0,
  detailTopLabelHeight = detailLabelHeight, detailBottomLabelHeight = 0, detail = false }) {
  const xs = spread.slots.map((slot) => slot.x), ys = spread.slots.map((slot) => slot.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanY = maxY - minY;
  const { compact, gap, labelGap, footerGap } = readingLayoutMetrics(width, spread, { detail });
  const topSpace = mainTopLabelHeight + (mainTopLabelHeight ? labelGap : 0);
  const bottomSpace = mainBottomLabelHeight + (mainBottomLabelHeight ? labelGap : 0);
  const cutBottomSpace = cutBottomLabelHeight + (cutBottomLabelHeight ? labelGap : 0);
  const cutHeight = compact ? Math.min(78, Math.max(60, height * 0.095)) : Math.min(110, Math.max(54, height * 0.11));
  const cut = { x: 16 + readingNameWidth(width, spread, { cut: true }) / 2, y: height - bottomPadding - cutBottomSpace - cutHeight / 2,
    width: cutHeight * CARD_RATIO, height: cutHeight };
  const cutTop = cut.y - cut.height / 2 - cutTopLabelHeight - (cutTopLabelHeight ? labelGap : 0);
  const bottom = Math.min(footerTop - footerGap, detail ? height - bottomPadding : cutTop - footerGap);
  const availableHeight = Math.max(1, bottom - top);
  if (detail) {
    const detailTopSpace = detailTopLabelHeight + (detailTopLabelHeight ? labelGap : 0);
    const detailBottomSpace = detailBottomLabelHeight + (detailBottomLabelHeight ? labelGap : 0);
    const cardHeight = Math.max(1, Math.min(availableHeight - detailTopSpace - detailBottomSpace, (width - 32) / CARD_RATIO));
    return { compact, gap, labelGap, detail: { x: width / 2, y: top + (availableHeight + detailTopSpace - detailBottomSpace) / 2,
      width: cardHeight * CARD_RATIO, height: cardHeight }, cut, cards: [] };
  }
  const columnWidth = readingNameWidth(width, spread);
  const fittedHeight = (availableHeight - spanY * gap) / (spanY + 1) - topSpace - bottomSpace;
  const minimumHeight = Math.min(compact ? 68 : 84, columnWidth / CARD_RATIO, Math.max(24, availableHeight - topSpace - bottomSpace));
  const cardHeight = Math.max(minimumHeight, Math.min(330, columnWidth / CARD_RATIO, fittedHeight));
  const cardWidth = cardHeight * CARD_RATIO;
  const columnStep = Math.max(cardWidth, columnWidth) + gap;
  const rowStep = cardHeight + topSpace + bottomSpace + gap;
  const groupHeight = spanY * rowStep + cardHeight + topSpace + bottomSpace;
  const scrollable = groupHeight > availableHeight + 0.5;
  const firstCenterY = top + (scrollable ? 0 : (availableHeight - groupHeight) / 2) + topSpace + cardHeight / 2;
  return { compact, gap, labelGap, cut, scrollable, top, bottom, contentHeight: groupHeight, viewportHeight: availableHeight,
    cards: spread.slots.map((slot) => ({
    x: width / 2 + (slot.x - (minX + maxX) / 2) * columnStep,
    y: firstCenterY + (slot.y - minY) * rowStep, width: cardWidth, height: cardHeight,
  })) };
}
