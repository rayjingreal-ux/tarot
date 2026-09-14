const RATIO = 0.61 / 1.01;
const FONT = '"Noto Serif TC", "Microsoft JhengHei", sans-serif';

// Export describes this reading, never the viewport, scroll position or detail card.
export function createReadingExportModel({ session, cards, deckName, displayName }) {
  const entryModel = (entry) => ({ index: entry.index, faceUp: Boolean(entry.faceUp),
    reversed: Boolean(entry.faceUp && entry.reversed),
    name: entry.faceUp ? displayName(cards[entry.index]) : "尚未翻牌",
    orientation: entry.faceUp ? (entry.reversed ? "逆位" : "正位") : "" });
  return { deckName, spreadId: session.spreadId,
    question: typeof session.question === "string" ? session.question.trim() : "",
    draws: session.draws.map(entryModel),
    cut: session.cut ? entryModel(session.cut) : null };
}

export function wrapExportText(text, maxWidth, measure) {
  const lines = []; let line = "";
  for (const char of String(text ?? "")) {
    if (char === "\n") { lines.push(line); line = ""; continue; }
    if (line && measure(line + char) > maxWidth) { lines.push(line); line = char; }
    else line += char;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}

function layoutQuestionExport({ text, width, contentBottom, measure }) {
  if (!text) return null;
  const x = 64, y = contentBottom + 40, boxWidth = width - x * 2;
  const inset = 32, fontSize = 27, lineHeight = 38, columnGap = 28;
  const titleY = y + 28, textY = titleY + 40 + 14;
  const availableHeight = 4096 - y - 64;
  // Most questions use a single full-width column. Unusually newline-heavy
  // input flows into columns instead of clipping words or shrinking the font.
  for (let columnCount = 1; columnCount <= 8; columnCount++) {
    const columnWidth = (boxWidth - inset * 2 - columnGap * (columnCount - 1)) / columnCount;
    const lines = wrapExportText(text, columnWidth, (value) => measure(value, fontSize));
    const rows = Math.ceil(lines.length / columnCount);
    const height = textY - y + rows * lineHeight + 28;
    if (height > availableHeight) continue;
    const columns = Array.from({ length: columnCount }, (_, index) => ({
      x: x + inset + index * (columnWidth + columnGap), y: textY, width: columnWidth,
      lines: lines.slice(index * rows, (index + 1) * rows),
    })).filter((column) => column.lines.length);
    return { title: "當時的問題", x, y, width: boxWidth, height, titleY,
      fontSize, lineHeight, columns };
  }
  throw new RangeError("問題文字過長，無法在安全圖片尺寸內輸出。");
}

// Fixed, bounded output size is independent of phone DPR. Text expands its row
// rather than being clipped. Original semantic slot positions stay unchanged.
export function layoutReadingExport({ model, spread, measure = (text, size) => [...text].length * size, width = 1600 }) {
  width = Math.max(1000, Math.min(2000, width));
  const padding = 64, xs = spread.slots.map((slot) => slot.x), ys = spread.slots.map((slot) => slot.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const cellWidth = (width - padding * 2) / (maxX - minX + 1);
  const cardHeight = Math.min(420, (cellWidth - 64) / RATIO), cardWidth = cardHeight * RATIO;
  const textWidth = cellWidth - 28;
  const lines = (text, size) => wrapExportText(text, textWidth, (value) => measure(value, size));
  const cards = model.draws.map((entry, i) => ({ ...entry, position: spread.slots[i].label,
    topLines: lines(spread.slots[i].label, 25), bottomLines: lines(entry.name, 29),
    width: cardWidth, height: cardHeight, x: width / 2 + (spread.slots[i].x - (minX + maxX) / 2) * cellWidth,
    slotY: spread.slots[i].y }));
  const topHeight = Math.max(1, ...cards.map((card) => card.topLines.length)) * 34;
  const bottomHeight = Math.max(1, ...cards.map((card) => card.bottomLines.length)) * 38 + 34;
  const blockHeight = topHeight + 12 + cardHeight + 12 + bottomHeight;
  const rowStep = blockHeight + 32;
  const titleLines = wrapExportText(spread.name, width - padding * 2, (value) => measure(value, 48));
  const deckLines = wrapExportText(model.deckName, width - padding * 2, (value) => measure(value, 21));
  const headerHeight = 65 + titleLines.length * 64 + deckLines.length * 32 + 30;
  for (const card of cards) card.y = headerHeight + (card.slotY - minY) * rowStep + topHeight + 12 + cardHeight / 2;
  const mainBottom = headerHeight + (maxY - minY) * rowStep + blockHeight;
  const cutTextWidth = Math.min(textWidth, 280);
  const cut = model.cut ? { ...model.cut, position: "切牌", topLines: ["切牌"],
    bottomLines: wrapExportText(model.cut.name, cutTextWidth, (value) => measure(value, 29)),
    width: 185 * RATIO, height: 185, x: padding + cutTextWidth / 2,
    y: mainBottom + 80 + 185 / 2 } : null;
  const contentBottom = cut ? cut.y + cut.height / 2 + 16 + cut.bottomLines.length * 38 + 34 : mainBottom;
  const question = layoutQuestionExport({ text: typeof model.question === "string" ? model.question.trim() : "",
    width, contentBottom, measure });
  const height = Math.ceil(question ? question.y + question.height + 64 : contentBottom + 64);
  if (height > 4096) throw new RangeError("牌陣文字過長，無法在安全圖片尺寸內輸出。");
  return { width, height, cards, cut, titleLines, deckLines, topHeight, bottomHeight, mainBottom, question };
}

export function renderReadingExport(canvas, { model, spread, images }) {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("此瀏覽器無法建立牌陣圖片。");
  const layout = layoutReadingExport({ model, spread, measure(text, size) {
    context.font = `${size}px ${FONT}`; return context.measureText(text).width;
  } });
  canvas.width = layout.width; canvas.height = layout.height;
  const { width, height } = layout;
  const background = context.createRadialGradient(width * 0.5, height * 0.38, 0, width * 0.5, height * 0.38, height * 0.8);
  background.addColorStop(0, "#18352e"); background.addColorStop(0.48, "#091a17"); background.addColorStop(1, "#030a09");
  context.fillStyle = background; context.fillRect(0, 0, width, height);
  for (let i = 0; i < 95; i++) {
    const x = 30 + ((i * 733) % (width - 60)), y = 30 + ((i * 391) % (height - 60));
    context.fillStyle = i % 3 ? "#c9b77a28" : "#f4dfaa50";
    context.beginPath(); context.arc(x, y, i % 3 ? 1 : 1.7, 0, Math.PI * 2); context.fill();
  }
  context.strokeStyle = "#d6bd7e45"; context.lineWidth = 1;
  context.strokeRect(24, 24, width - 48, height - 48);
  context.textAlign = "center"; context.textBaseline = "top";
  function drawLines(lines, x, y, size, lineHeight, color) {
    context.fillStyle = color; context.font = `${size}px ${FONT}`;
    lines.forEach((line, i) => context.fillText(line, x, y + i * lineHeight));
  }
  drawLines(layout.titleLines, width / 2, 60, 48, 64, "#f5deb0");
  drawLines(layout.deckLines, width / 2, 65 + layout.titleLines.length * 64, 21, 32, "#c4c2ae");
  for (const card of [...layout.cards, ...(layout.cut ? [layout.cut] : [])]) {
    const image = images.get(card.index);
    if (!image) throw new Error("部分牌面尚未備妥，請稍後重試。");
    const imageWidth = image.naturalWidth || image.width, imageHeight = image.naturalHeight || image.height;
    if (!imageWidth || !imageHeight) throw new Error("牌面圖片無法讀取。");
    const scale = Math.min(card.width / imageWidth, card.height / imageHeight);
    const drawWidth = imageWidth * scale, drawHeight = imageHeight * scale;
    drawLines(card.topLines, card.x, card.y - card.height / 2 - 12 - card.topLines.length * 34, 25, 34, "#d8d2bd");
    context.save(); context.translate(card.x, card.y);
    if (card.faceUp && card.reversed) context.rotate(Math.PI);
    context.shadowColor = "#00000088"; context.shadowBlur = 18;
    context.drawImage(image, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    context.restore();
    drawLines(card.bottomLines, card.x, card.y + card.height / 2 + 12, 29, 38, "#f5deb0");
    drawLines([card.orientation], card.x, card.y + card.height / 2 + 12 + card.bottomLines.length * 38,
      23, 30, card.reversed ? "#f3c49e" : "#a6ddc5");
  }
  if (layout.question) {
    const question = layout.question;
    context.fillStyle = "#10231ed9";
    context.fillRect(question.x, question.y, question.width, question.height);
    context.strokeStyle = "#d6bd7e70"; context.lineWidth = 1;
    context.strokeRect(question.x, question.y, question.width, question.height);
    drawLines([question.title], width / 2, question.titleY, 28, 40, "#f5deb0");
    drawLines(["✦"], question.x + 32, question.titleY, 23, 40, "#cfb97c");
    drawLines(["✦"], question.x + question.width - 32, question.titleY, 23, 40, "#cfb97c");
    context.textAlign = "left";
    for (const column of question.columns) {
      drawLines(column.lines, column.x, column.y, question.fontSize, question.lineHeight, "#eee9d7");
    }
    context.textAlign = "center";
  }
  return layout;
}

export function readingExportBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("圖片建立失敗，請重新儲存。")), "image/png");
  });
}
