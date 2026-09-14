import test from "node:test";
import assert from "node:assert/strict";
import { DRAW_SPREADS } from "../draw-spreads.js";
import { createReadingExportModel, layoutReadingExport, renderReadingExport, readingExportBlob, wrapExportText } from "../reading-export.js";

function fixture(spread, hidden = false, question) {
  const cards = Array.from({length: spread.count + 1}, (_, i) => ({ name: `中文牌名${i}` }));
  const session = { spreadId: spread.id, question, draws: spread.slots.map((_, index) => ({ index, faceUp: !hidden, reversed: index % 2 === 0 })),
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

test("export snapshots the trimmed optional question, preserving interior line breaks and later session independence", () => {
  const { session, model } = fixture(DRAW_SPREADS[0], false, "  我想知道下一步？\n\n請給我指引 🌙  ");
  assert.equal(model.question, "我想知道下一步？\n\n請給我指引 🌙");
  session.question = "這是下一次的問題";
  assert.equal(model.question, "我想知道下一步？\n\n請給我指引 🌙");
  for (const input of [undefined, null, 123, "", " \n\t "]) {
    assert.equal(fixture(DRAW_SPREADS[0], false, input).model.question, "");
  }
});

test("empty questions add no block, canvas size or card-placement changes to any spread", () => {
  for (const spread of DRAW_SPREADS) {
    const { model } = fixture(spread);
    const without = layoutReadingExport({ model, spread });
    assert.equal(without.question, null);
    const blank = layoutReadingExport({ model: { ...model, question: " \n\t " }, spread });
    assert.deepEqual(blank, without);
    const expectedHeight = Math.ceil(without.cut.y + without.cut.height / 2 + 16
      + without.cut.bottomLines.length * 38 + 34 + 64);
    assert.equal(without.height, expectedHeight);
  }
});

test("all fourteen exports keep every question character below main cards and cut within safe dimensions", () => {
  const questions = [
    "我想更清楚地理解下一步可以如何行動。".repeat(15).slice(0, 200),
    "AnUnbrokenEnglishQuestion".repeat(12).slice(0, 200),
    Array.from({ length: 200 }, (_, i) => ["問", "心", "🌙", "A"][i % 4]).join(""),
    "開頭\n\n第二個想法：🌙\n最後一行，不截斷。",
    `頭${"\n".repeat(198)}尾`,
  ];
  for (const spread of DRAW_SPREADS) {
    for (const question of questions) {
      for (const width of [1000, 1600, 2000]) {
        const { model } = fixture(spread, false, question);
        const layout = layoutReadingExport({ model, spread, width });
        const block = layout.question;
        assert.ok(layout.height <= 4096, `${spread.id}: ${layout.height}`);
        assert.equal(block.title, "當時的問題");
        const cutBottom = layout.cut.y + layout.cut.height / 2 + 12
          + layout.cut.bottomLines.length * 38 + 30;
        assert.ok(block.y > cutBottom && block.y > layout.mainBottom);
        assert.ok(block.y + block.height < layout.height);
        assert.equal(block.columns.flatMap((column) => column.lines).join(""), question.replaceAll("\n", ""));
        for (const column of block.columns) {
          assert.ok(column.x >= block.x && column.x + column.width <= block.x + block.width);
          assert.ok(column.lines.every((line) => [...line].length * block.fontSize <= column.width));
          assert.ok(column.y + column.lines.length * block.lineHeight <= block.y + block.height);
        }
      }
    }
  }
});

test("a usual question is one readable column below the reading, including when there is no cut", () => {
  const spread = DRAW_SPREADS.at(-1), { model } = fixture(spread, false, "這段關係接下來，我能如何照顧自己？\n我想找回內心的平靜。");
  model.cut = null;
  const layout = layoutReadingExport({ model, spread });
  assert.equal(layout.question.columns.length, 1);
  assert.equal(layout.question.fontSize, 27);
  assert.ok(layout.question.y > layout.mainBottom);
  assert.deepEqual(layout.question.columns[0].lines, model.question.split("\n"));
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

test("render includes the complete question as plain image text after every card, never as markup", () => {
  const spread = DRAW_SPREADS.at(-1), { model } = fixture(spread, false, "<script>不是程式碼</script>\n這是我的問題 🌙");
  const text = [], draws = [];
  const context = { measureText: (value) => ({ width: [...value].length * 23 }),
    createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {}, strokeRect() {},
    save() {}, restore() {}, translate() {}, rotate() {},
    fillText: (value, x, y) => text.push({ value, x, y, drawnCards: draws.length }), drawImage: (...args) => draws.push(args) };
  const canvas = { getContext: () => context };
  const images = new Map([...model.draws, model.cut].map((entry) => [entry.index, { width: 610, height: 1010 }]));
  const layout = renderReadingExport(canvas, { model, spread, images });
  assert.equal(draws.length, 14);
  const questionText = text.filter((line) => line.y >= layout.question.columns[0].y);
  assert.equal(questionText.map((line) => line.value).join(""), model.question.replaceAll("\n", ""));
  assert.ok(questionText.every((line) => line.drawnCards === 14));
  assert.ok(text.some((line) => line.value === "當時的問題" && line.y === layout.question.titleY));
  assert.equal(canvas.height, layout.height);
});

test("PNG export reports unsupported canvas, missing images and encoding failure explicitly", async () => {
  const spread = DRAW_SPREADS[0], { model } = fixture(spread);
  assert.throws(() => renderReadingExport({getContext:()=>null}, {model,spread,images:new Map()}), /瀏覽器/);
  await assert.rejects(readingExportBlob({toBlob:(callback)=>callback(null)}), /圖片建立失敗/);
  const blob = new Blob(["test"], {type:"image/png"});
  assert.equal(await readingExportBlob({toBlob:(callback,type)=>{ assert.equal(type,"image/png"); callback(blob); }}), blob);
});
