import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getCardDisplayName } from "../card-names.js";

const assets = new URL("../assets/", import.meta.url);
const decks = JSON.parse(readFileSync(new URL("decks-manifest.json", assets), "utf8")).decks;
const manifests = decks.map((deck) => {
  const payload = JSON.parse(readFileSync(new URL(deck.cardManifest, assets), "utf8"));
  return { id: deck.id, cards: Array.isArray(payload) ? payload : payload.cards };
});

test("all four real catalogs show Chinese labels and compact numeric minor names", () => {
  assert.equal(manifests.length, 4);
  for (const { id, cards } of manifests) {
    for (const card of cards) {
      const result = getCardDisplayName(card);
      assert.match(result, /\p{Script=Han}/u, `${id}: ${card.name}`);
      if (card.suit !== "Major Arcana") {
        const suit = { Wands: "權杖", Cups: "聖杯", Swords: "寶劍", Pentacles: "錢幣", Coins: "錢幣" }[card.suit];
        const rank = { Ace: "王牌", Page: "侍者", Knight: "騎士", Queen: "皇后", King: "國王" }[card.rank] ?? card.rank.replace("-", " ");
        assert.equal(result, `${suit}${rank}`, `${id}: ${card.name}`);
      }
    }
    assert.equal(getCardDisplayName(cards.find((card) => /^(?:Seven|7) of Swords$/i.test(card.name))), "寶劍7");
  }
});

test("every standard English name in the actual manifests has a Chinese fallback", () => {
  for (const { id, cards } of manifests) {
    for (const card of cards) {
      if (/\b(?:Mob|Puppeteer)\b| [AB]$/i.test(card.name)) continue;
      const expected = getCardDisplayName(card);
      assert.equal(getCardDisplayName({ ...card, nameZh: "" }), expected, `${id}: ${card.name}`);
      assert.equal(getCardDisplayName({ ...card, name: card.name.toUpperCase(), nameZh: "CARD 01" }), expected);
    }
  }
});

test("existing Chinese titles take precedence and preserve distinct deck variants", () => {
  assert.equal(getCardDisplayName({ name: "The Fool", nameZh: "旅人・起始之心" }), "旅人・起始之心");
  assert.equal(getCardDisplayName({ name: "The Tower", nameZh: "  雷擊之塔  " }), "雷擊之塔");
  assert.equal(getCardDisplayName({ name: "The Fool", nameZh: "CARD 00", name_zh: "旅人" }), "旅人");
  const expectations = new Map([
    ["The Mob", "群眾"], ["The Puppeteer", "傀儡師"],
    ["The Hierophant A", "教皇 A"], ["The Hierophant B", "教皇 B"],
    ["10 of Swords A", "寶劍10 A"], ["10 of Swords B", "寶劍10 B"],
  ]);
  for (const card of manifests.flatMap(({ cards }) => cards)) {
    if (expectations.has(card.name)) assert.equal(getCardDisplayName(card), expectations.get(card.name));
  }
});

test("unknown and special names are never overwritten by array positions or fallback metadata", () => {
  for (const card of manifests.flatMap(({ cards }) => cards)) {
    if (/\b(?:Mob|Puppeteer)\b| [AB]$/i.test(card.name)) {
      assert.equal(getCardDisplayName({ ...card, nameZh: "" }), card.name);
    }
  }
  assert.equal(getCardDisplayName({ index: 7, name: "The Dreamer", suit: "Wands", rank: "7" }), "The Dreamer");
  assert.equal(getCardDisplayName({ index: 7, name: "The Listener", id: "major-07-chariot" }), "The Listener");
  assert.equal(getCardDisplayName({ index: 7 }), "未命名牌卡");
});

test("missing or placeholder titles can use explicit suit/rank or a canonical major slug", () => {
  assert.equal(getCardDisplayName({ name: "CARD 56", nameZh: "CARD 56", suit: "Swords", rank: "7" }), "寶劍7");
  assert.equal(getCardDisplayName({ name: "CARD 56", nameZh: "牌卡 56", suit: "Coins", rank: "TEN" }), "錢幣10");
  assert.equal(getCardDisplayName({ suit: "CUPS", rank: "ACE" }), "聖杯王牌");
  assert.equal(getCardDisplayName({ id: "major-08-strength" }), "力量");
  assert.equal(getCardDisplayName({ id: "major-11-justice" }), "正義");
  assert.equal(getCardDisplayName({ id: "major-22-mob" }), "未命名牌卡");
  assert.equal(getCardDisplayName({ name: "The Judgment" }), "審判");
  assert.equal(getCardDisplayName(null), "未命名牌卡");
});
