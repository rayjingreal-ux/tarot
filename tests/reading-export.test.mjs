import test from "node:test";
import assert from "node:assert/strict";
import { DRAW_SPREADS } from "../draw-spreads.js";
import { createReadingExportModel, layoutReadingExport, renderReadingExport, readingExportBlob, wrapExportText } from "../reading-export.js";

function fixture(spread, hidden = false) {
  const cards = Array.from({length: spread.count + 1}, (_, i) => ({ name: `中文牌名${i}` }));
  const session = { spreadId: spread.id, draws: spread.slots.map((_, index) => ({ index, faceUp: !hidden, reversed: index % 2 === 0 })),
    cut: { index: spread.count, faceUp: !hidden, reversed: true } };
  return { session, cards, model: createReadingExportModel({ session, cards, deckName: "測試牌組", displayName: (card) => card.name }) };
}

test("all fourteen exports contain the full semantic layout plus separate cut, independent of phone view", () => {
  for (const spread of DRAW_SPREADS) {
    const { model } = fixture(spread);
    const layout = layoutReadingExport({ model, spread });
    assert.equal(layout.cards.length, spread.count);
    assert.equal(layout.cut.index, spread.count);
    assert.ok(layout.width <= 2000 && layout.height <= 4096);
    for (const [i, card] of layout.cards.entries()) {
      assert.equal(card.position, spread.slots[i].label);
      assert.ok(card.x - card.width / 2 >= 24 && card.x + card.width / 2 <= layout.width - 24);
      assert.ok(card.y - card.height / 2 - card.topLines.length * 34 - 12 > 0);
      assert.ok(card.y + card.height / 2 + card.bottomLines.length * 38 + 46 < layout.height);
    }
    assert.ok(layout.cut.x < layout.width / 2);
    assert.ok(layout.cut.y - layout.cut.height / 2 > layout.mainBottom);
  }
});

test("export snapshot does not expose hidden names or directions, mutate the draw, or follow later flips", () => {
  const { session, model } = fixture(DRAW_SPREADS[2], true);
  const snapshot = JSON.stringify(session);
  assert.ok(!JSON.stringify(model).includes("中文牌名"));
  assert.ok([...model.draws, model.cut].every((entry) => entry.name === "尚未翻牌" && !entry.reversed && !entry.orientation));
  layoutReadingExport({ model, spread: DRAW_SPREADS[2] });
  assert.equal(JSON.stringify(session), snapshot);
  session.draws[0].faceUp = true;
  assert.equal(model.draws[0].faceUp, false);
});

test("export wraps complete Chinese titles instead of truncating text", () => {
  const text = "共享資源與親密以及完整的額外牌位文字";
  const lines = wrapExportText(text, 100, (s) => [...s].length * 20);
  assert.equal(lines.join(""), text); assert.ok(lines.length > 1);
  assert.ok(lines.every((line) => [...line].length * 20 <= 100));
});

test("render paints every card with meaning above and name/direction below, without UI buttons", () => {
  const spread = DRAW_SPREADS.at(-1), { model } = fixture(spread);
  const text = [], draws = [], rotations = [];
  const context = { measureText: (value) => ({ width: [...value].length * 23 }),
    createRadialGradient: () => ({addColorStop() {}}), fillRect() {}, beginPath() {}, arc() {}, fill() {}, strokeRect() {},
    save() {}, restore() {}, translate() {}, rotate: (angle) => rotations.push(angle),
    fillText: (value,x,y) => text.push({value,x,y}), drawImage: (...args) => draws.push(args) };
  const canvas = { getContext: () => context };
  const images = new Map([...model.draws, model.cut].map((entry) => [entry.index, {width:610,height:1010}]));
  const layout = renderReadingExport(canvas, { model, spread, images });
  assert.equal(draws.length, 14); assert.equal(canvas.width, 1600); assert.equal(canvas.height, layout.height);
  assert.equal(rotations.length, [...model.draws, model.cut].filter((entry) => entry.reversed).length);
  assert.ok(rotations.every((value) => value === Math.PI));
  for (const card of [...layout.cards, layout.cut]) {
    assert.ok(text.some((line) => line.value === card.position && line.y < card.y - card.height / 2));
    assert.ok(text.some((line) => line.value === card.name && line.y > card.y + card.height / 2));
  }
  assert.ok(!text.some((line) => /重新抽牌|收回牌盒|全部翻開|儲存牌陣/.test(line.value)));
});

test("PNG export reports unsupported canvas, missing images and encoding failure explicitly", async () => {
  const spread = DRAW_SPREADS[0], { model } = fixture(spread);
  assert.throws(() => renderReadingExport({getContext:()=>null}, {model,spread,images:new Map()}), /瀏覽器/);
  await assert.rejects(readingExportBlob({toBlob:(callback)=>callback(null)}), /圖片建立失敗/);
  const blob = new Blob(["test"], {type:"image/png"});
  assert.equal(await readingExportBlob({toBlob:(callback,type)=>{ assert.equal(type,"image/png"); callback(blob); }}), blob);
});
