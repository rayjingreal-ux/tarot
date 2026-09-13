import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as THREE from "../vendor/three/three.module.js";
import { DRAW_SPREADS } from "../draw-spreads.js";
import { fitReadingLayout, readingLayoutMetrics, readingNameWidth } from "../reading-layout.js";

const screens = [
  { width: 320, height: 520, top: 96, footerTop: 454, name: 51 },
  { width: 390, height: 619, top: 110, footerTop: 553, name: 34 },
  { width: 390, height: 796, top: 110, footerTop: 730, name: 34 },
  { width: 667, height: 327, top: 62, footerTop: 261, name: 17 },
  { width: 844, height: 390, top: 132, footerTop: 324, name: 17 },
  { width: 1707, height: 932, top: 174, footerTop: 850, name: 34 },
];
const overlaps = (a, b) => a.left < b.right - 0.01 && a.right > b.left + 0.01 && a.top < b.bottom - 0.01 && a.bottom > b.top + 0.01;
const cardBox = (card) => ({ left: card.x - card.width / 2, right: card.x + card.width / 2, top: card.y - card.height / 2, bottom: card.y + card.height / 2 });
const nameBox = (card, width, height, gap = 8) => ({ left: card.x - width / 2, right: card.x + width / 2, top: card.y - card.height / 2 - gap - height, bottom: card.y - card.height / 2 - gap });

test("fourteen spreads preserve full names and cards, with reachable scroll content on small screens", () => {
  for (const screen of screens) for (const spread of DRAW_SPREADS) {
    const layout = fitReadingLayout({ ...screen, spread, mainLabelHeight: screen.name, cutLabelHeight: 34 });
    const names = layout.cards.map((card) => nameBox(card, readingNameWidth(screen.width, spread), screen.name, layout.labelGap));
    const cards = layout.cards.map(cardBox);
    const cut = cardBox(layout.cut), cutName = nameBox(layout.cut, readingNameWidth(screen.width, spread, { cut: true }), 34, layout.labelGap);
    for (const box of [...names, ...cards]) {
      const gutter = layout.compact ? 19 : 23;
      assert.ok(box.left >= gutter && box.right <= screen.width - gutter, `${spread.id}: scrollbar gutter`);
      const contentBottom = layout.scrollable ? screen.top + layout.contentHeight : layout.bottom;
      assert.ok(box.top >= screen.top - 0.01 && box.bottom <= contentBottom + 0.01, `${spread.id}: content fit`);
      // Each complete card/name can be brought inside the clipped main viewport.
      const offset = Math.max(0, Math.min(box.top - screen.top, layout.contentHeight - layout.viewportHeight));
      assert.ok(box.top - offset >= screen.top - 0.01 && box.bottom - offset <= layout.bottom + 0.01, `${spread.id}: reachable`);
      const visibleBox = { ...box, top: box.top - offset, bottom: box.bottom - offset };
      assert.ok(!overlaps(visibleBox, cut) && !overlaps(visibleBox, cutName), `${spread.id}: separate cut`);
    }
    for (let i = 0; i < names.length; i++) for (let j = 0; j < cards.length; j++) {
      assert.ok(!overlaps(names[i], cards[j]), `${screen.width} / ${spread.id}: name ${i} covers card ${j}`);
      if (i !== j) assert.ok(!overlaps(names[i], names[j]), `${spread.id}: names overlap`);
    }
    assert.ok(layout.cards.every((card) => card.height >= 70 && Math.abs(card.width / card.height - 0.61 / 1.01) < 1e-10));
    assert.ok(layout.bottom < cutName.top && cut.bottom <= screen.height - 15);
  }
});

test("single-card detail enlarges without cropping, including a long fully wrapped name", () => {
  for (const screen of screens) for (const spread of DRAW_SPREADS) {
    const layout = fitReadingLayout({ ...screen, spread, detail: true, detailLabelHeight: 58 });
    const card = cardBox(layout.detail), name = nameBox(layout.detail, readingNameWidth(screen.width, spread, { detail: true }), 58);
    assert.ok(card.left >= 15 && card.right <= screen.width - 15);
    assert.ok(name.top >= screen.top - 0.01 && card.bottom <= screen.footerTop - 11);
    assert.ok(layout.detail.height > 70);
  }
});

test("visible slot meanings and orientation rows are included in mobile label spacing", () => {
  for (const screen of screens) for (const spread of DRAW_SPREADS) {
    // Include narrow-column wrapping of the full name and both metadata fields.
    const labelHeight = screen.width <= 320 ? 105 : screen.width <= 390 ? 88 : 56, cutLabelHeight = 53;
    const layout = fitReadingLayout({ ...screen, spread, mainLabelHeight: labelHeight, cutLabelHeight });
    const names = layout.cards.map((card) => nameBox(card, readingNameWidth(screen.width, spread), labelHeight, layout.labelGap));
    const cards = layout.cards.map(cardBox);
    const cutName = nameBox(layout.cut, readingNameWidth(screen.width, spread, { cut: true }), cutLabelHeight, layout.labelGap);
    assert.ok(layout.bottom < cutName.top, `${spread.id}: main viewport clears all cut text`);
    for (let i = 0; i < names.length; i++) {
      assert.ok(layout.cards[i].height >= 48, `${spread.id}: readable touch target on short landscape screens`);
      assert.ok(layout.cards[i].height + labelHeight + layout.labelGap <= layout.viewportHeight + 0.01, `${spread.id}: complete label and card fit together`);
      const gutter = layout.compact ? 19 : 23;
      assert.ok(names[i].right <= screen.width - gutter && names[i].left >= gutter);
      for (let j = 0; j < cards.length; j++) assert.ok(!overlaps(names[i], cards[j]), `${spread.id}: metadata covers a card`);
      const maxOffset = Math.max(0, layout.contentHeight - layout.viewportHeight);
      const offset = Math.max(0, Math.min(names[i].top - screen.top, maxOffset));
      assert.ok(names[i].top - offset >= screen.top - 0.01 && cards[i].bottom - offset <= layout.bottom + 0.01, `${spread.id}: complete block is reachable`);
    }
    const detail = fitReadingLayout({ ...screen, spread, detail: true, detailLabelHeight: 84 }).detail;
    assert.ok(nameBox(detail, readingNameWidth(screen.width, spread, { detail: true }), 84).top >= screen.top - 0.01);
    assert.ok(cardBox(detail).bottom <= screen.footerTop - 11);
  }
});

test("compact twelve houses fits all thirteen cards, complete labels and a separate cut on portrait phones", () => {
  const spread = DRAW_SPREADS.find((item) => item.id === "houses");
  for (const [width, height, cutLabelHeight] of [[375, 812, 40], [390, 796, 28], [390, 800, 40], [390, 844, 40], [430, 932, 40]]) {
    // Two full name lines plus two metadata lines at the compact CSS font sizes.
    const mainLabelHeight = 54;
    const layout = fitReadingLayout({ width, height, top: 118, footerTop: height - 64, spread, mainLabelHeight, cutLabelHeight });
    assert.equal(layout.compact, true);
    assert.equal(layout.scrollable, false, `${width} × ${height}: all houses fit in one view`);
    assert.equal(layout.cards.length, 13, "the overall guide card is not removed");
    assert.equal(layout.labelGap, 3);
    assert.equal(layout.gap, 4);
    const cards = layout.cards.map(cardBox);
    const names = layout.cards.map((card) => nameBox(card, readingNameWidth(width, spread), mainLabelHeight, layout.labelGap));
    const cut = cardBox(layout.cut), cutName = nameBox(layout.cut, readingNameWidth(width, spread, { cut: true }), cutLabelHeight, layout.labelGap);
    for (let i = 0; i < cards.length; i++) {
      assert.ok(layout.cards[i].width >= 44, "card remains a usable touch target");
      assert.ok(names[i].top >= layout.top - 0.01 && cards[i].bottom <= layout.bottom + 0.01);
      assert.ok(names[i].left >= 23 && names[i].right <= width - 23);
      for (let j = 0; j < cards.length; j++) {
        assert.ok(!overlaps(names[i], cards[j]), `house ${i + 1} text clears card ${j + 1}`);
        if (i !== j) assert.ok(!overlaps(names[i], names[j]) && !overlaps(cards[i], cards[j]));
      }
      assert.ok(!overlaps(cards[i], cutName) && !overlaps(names[i], cutName));
    }
    assert.ok(cut.left >= 16 && cut.right < width * 0.3, "cut stays clear of the lower-right toolbar");
    assert.ok(cutName.top > layout.bottom && cut.bottom <= height - 16);
    assert.equal(layout.cards[12].x, width / 2, "overall guidance stays at the centre of the ring");
    for (let i = 0; i < cards.length; i++) for (let j = 0; j < cards.length; j++) {
      assert.equal(Math.sign(layout.cards[i].x - layout.cards[j].x), Math.sign(spread.slots[i].x - spread.slots[j].x));
      assert.equal(Math.sign(layout.cards[i].y - layout.cards[j].y), Math.sign(spread.slots[i].y - spread.slots[j].y));
    }
  }
});

test("short phones and long house labels scroll without discarding text, direction or touch targets", () => {
  const spread = DRAW_SPREADS.find((item) => item.id === "houses");
  for (const [width, height, mainLabelHeight] of [[320, 520, 68], [320, 568, 68], [390, 800, 96]]) {
    const layout = fitReadingLayout({ width, height, top: 118, footerTop: height - 64, spread, mainLabelHeight, cutLabelHeight: 40 });
    assert.equal(layout.scrollable, true);
    assert.equal(layout.cards.length, 13);
    for (const card of layout.cards) {
      const label = nameBox(card, readingNameWidth(width, spread), mainLabelHeight, layout.labelGap);
      const offset = Math.max(0, Math.min(label.top - layout.top, layout.contentHeight - layout.viewportHeight));
      assert.ok(label.top - offset >= layout.top - 0.01);
      assert.ok(cardBox(card).bottom - offset <= layout.bottom + 0.01, "full name, metadata and card can be viewed together");
      assert.ok(card.width >= 44, "scroll fallback does not shrink the touch target");
    }
  }
});

test("compact house styling is overview-only and does not truncate names or meanings", () => {
  const spread = DRAW_SPREADS.find((item) => item.id === "houses");
  assert.equal(readingLayoutMetrics(390, spread).compact, true);
  assert.equal(readingLayoutMetrics(390, spread, { detail: true }).compact, false);
  assert.equal(readingLayoutMetrics(681, spread).compact, false);
  assert.equal(readingLayoutMetrics(390, DRAW_SPREADS[0]).compact, false);
  assert.equal(readingLayoutMetrics(390, spread).headerGap, 6);
  const css = readFileSync(new URL("../draw-ritual.css", import.meta.url), "utf8");
  const compactRules = [...css.matchAll(/\.inspection\[data-reading-compact="true"\][^{]*\{([^}]*)\}/g)].map((match) => match[1]).join("\n");
  assert.match(compactRules, /font-size: 12\.5px/);
  assert.match(compactRules, /font-size: 10\.5px/);
  assert.doesNotMatch(compactRules, /line-clamp|text-overflow|overflow:\s*hidden|display:\s*none/);
  assert.match(css, /\.spread-card-label\.is-detail strong[^}]*font-size: 16px/);
  assert.match(css, /\.spread-card-label\.is-detail \.spread-card-context[^}]*font-size: 14px/);
  assert.match(css, /var\(--reading-label-gap, 8px\)/);
});

test("actual stage unprojection fits all four 3D corners into each target card rectangle", () => {
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const body = source.match(/^function screenToReadingPlane\([^]*?^}/m)?.[0];
  assert.ok(body);
  for (const screen of screens) {
    const camera = new THREE.PerspectiveCamera(32, screen.width / screen.height, 0.1, 100);
    camera.position.set(0, 0.25, 6.8); camera.lookAt(0, 0.1, 0.4); camera.updateMatrixWorld();
    const context = vm.createContext({ camera, stage: { clientWidth: screen.width, clientHeight: screen.height } });
    vm.runInContext(body, context);
    for (const spread of DRAW_SPREADS) {
      const layout = fitReadingLayout({ ...screen, spread, mainLabelHeight: screen.name, cutLabelHeight: 34 });
      for (const rect of [...layout.cards, layout.cut]) {
        const center = context.screenToReadingPlane(rect.x, rect.y, new THREE.Vector3());
        const top = context.screenToReadingPlane(rect.x, rect.y - rect.height / 2, new THREE.Vector3());
        const scale = Math.abs(top.y - center.y) / 0.505;
        for (const dx of [-0.305, 0.305]) for (const dy of [-0.505, 0.505]) {
          const point = new THREE.Vector3(center.x + dx * scale, center.y + dy * scale, 1.05).project(camera);
          const x = (point.x + 1) * screen.width / 2, y = (1 - point.y) * screen.height / 2;
          assert.ok(Math.abs(x - rect.x) <= rect.width / 2 + 2);
          assert.ok(Math.abs(y - rect.y) <= rect.height / 2 + 2);
        }
      }
    }
  }
});
