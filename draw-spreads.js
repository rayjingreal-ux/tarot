const spread = (id, name, labels, points, description) => Object.freeze({
  id, name, count: labels.length, description,
  slots: Object.freeze(labels.map((label, index) => Object.freeze({ label, x: points[index][0], y: points[index][1] }))),
});
const free = (count) => spread(count === 1 ? "single" : `free-${count}`, `抽${["", "單", "兩", "三", "四", "五", "六", "七"][count]}張`,
  Array.from({ length: count }, (_, index) => `第 ${index + 1} 張`),
  Array.from({ length: count }, (_, index) => [index % (count > 3 ? Math.ceil(count / 2) : count), Math.floor(index / (count > 3 ? Math.ceil(count / 2) : count))]), "依抽取順序排列，自由閱讀。");

// Slot structure is informed by the user's reference; labels are concise paraphrases.
// The reference's extra attitude card is not duplicated: this app has the user's separate cut card.
export const DRAW_SPREADS = Object.freeze([
  ...[1, 2, 3, 5, 7].map(free),
  spread("body-mind-spirit", "身心靈", ["身體狀態", "內心狀態", "靈性指引"], [[1,1],[3,1],[2,0]], "從身體、內心與靈性看見此刻。"),
  spread("elements", "四元素", ["目標與行動", "資源與享受", "難題與傷處", "關係與感受"], [[0,0],[0,2],[2,2],[2,0]], "四個面向彼此對照。"),
  spread("general", "通用牌陣", ["主要訊息", "補充一", "補充二", "補充三"], [[0,0],[1,1],[2,1],[3,1]], "一個核心，三個補充角度。"),
  spread("choice-two", "二擇一", ["當前處境", "A 的發展", "A 的結果", "B 的發展", "B 的結果"], [[2,2],[1,1],[0,0],[3,1],[4,0]], "從同一個起點比較兩條路。"),
  spread("choice-three", "三擇一", ["當前處境", "A 的發展", "A 的結果", "B 的發展", "B 的結果", "C 的發展", "C 的結果"], [[2,2],[1,1],[0,0],[2,1],[2,0],[3,1],[4,0]], "並列比較三種選擇的發展與結果。"),
  spread("seasons", "四季牌陣", ["行動與工作", "情感與直覺", "人際互動", "物質與健康", "整體趨勢"], [[0,1],[1,2],[2,1],[1,0],[1,1]], "四個生活面向，圍繞整體趨勢。"),
  spread("annual", "年度發展指引", ["今年的回顧", "今年的課題", "來年的基調", "可迎接的機會", "需留意的阻礙", "可培養的能力", "行動方向"], [[0,0],[0,2],[2,1],[3,1],[1,1],[2,2],[2,0]], "回顧今年，整理下一年的行動方向。"),
  spread("horseshoe", "處境馬蹄鐵", ["當前處境", "已知因素", "未知因素", "接下來的發展", "可能的結果"], [[0,2],[0,1],[1,0],[2,1],[2,2]], "以馬蹄形展開處境到結果的線索。"),
  spread("houses", "十二宮位", ["自我與個性", "金錢與資源", "手足與溝通", "家庭與根基", "戀愛與子女", "日常與健康", "婚姻與伴侶", "共享資源與親密", "旅行與學習", "事業與方向", "朋友與社群", "隱藏與變動", "整體指引"], [[0,3],[1,3],[2,3],[3,3],[3,2],[3,1],[3,0],[2,0],[1,0],[0,0],[0,1],[0,2],[1.5,1.5]], "十二個生活宮位，加上一張整體指引。"),
]);

export function getDrawSpread(id = "single") {
  const selected = DRAW_SPREADS.find((item) => item.id === id);
  if (!selected) throw new RangeError(`Unknown spread: ${id}`);
  return selected;
}

/** Existing card geometry, fitted inside the fixed stage camera with HUD-safe margins. */
export function getReadingCardPose({ spread: layout, slot = 0, aspect = 1.6, cut = false, detail = false, faceUp = false }, pose = {}) {
  const ratio = Math.max(0.35, Math.min(3.5, aspect));
  const frameHeight = 2 * (6.8 - 1.05) * Math.tan(16 * Math.PI / 180);
  const frameWidth = frameHeight * ratio;
  const xs = layout.slots.map((entry) => entry.x);
  const ys = layout.slots.map((entry) => entry.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min(1.24, (frameWidth - 0.28) / ((maxX - minX) * 0.84 + 0.7), frameHeight * (ratio < 0.85 ? 0.4 : 0.52) / ((maxY - minY) * 1.34 + 1.32));
  const point = layout.slots[slot] ?? layout.slots[0];
  Object.assign(pose, {
    x: (point.x - (minX + maxX) / 2) * 0.84 * scale,
    y: 0.16 + ((minY + maxY) / 2 - point.y) * 1.34 * scale,
    z: 1.05, rx: 0, ry: faceUp ? 0 : Math.PI, rz: 0, scale, visible: true,
  });
  if (cut) {
    const cutScale = ratio < 0.85 ? 0.48 : 0.58;
    Object.assign(pose, { x: -frameWidth / 2 + cutScale * 0.36 + 0.1, y: -frameHeight / 2 + cutScale * 0.58 + 0.3, scale: cutScale });
  }
  // Overview always keeps the cut lower-left; explicit inspection can enlarge any card.
  if (detail) Object.assign(pose, { x: 0, y: 0.17, scale: Math.min(1.7, frameWidth / 0.83) });
  return pose;
}
