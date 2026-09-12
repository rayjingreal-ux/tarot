import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { createDeckTexturePlan, createDeckTextureCache, getTextureUrl } from "../texture-loading.js";

const manifestUrl = new URL("../assets/decks-manifest.json", import.meta.url);
const { decks: manifest } = JSON.parse(readFileSync(manifestUrl, "utf8"));
const decks = Object.fromEntries(manifest.map((deck) => [deck.id, { ...deck, textureRoot: new URL(deck.textureRoot, manifestUrl).href }]));
const plan = createDeckTexturePlan(decks);
const bytes = (entries) => entries.reduce((total, entry) => total + statSync(new URL(entry.path)).size, 0);

test("initial textures include only 26 outer preview faces, saving 65 percent of blocking bytes", () => {
  const previews = plan.filter((entry) => entry.preview);
  assert.equal(previews.length, 26);
  assert.equal(plan.length, 55);
  assert.equal(bytes(previews), 3843313);
  assert.equal(bytes(plan), 9036273);
  assert.ok(1 - bytes(previews) / 11109261 > 0.65);
  assert.ok(previews.every((entry) => !/guidebook|card-back|inner-/.test(entry.name)));
});

test("every logical material and original fallback exists, with eight smaller variants", () => {
  for (const entry of plan) {
    assert.ok(statSync(new URL(entry.path)).size > 0);
    assert.ok(statSync(new URL(entry.fallbackPath)).size > 0);
  }
  assert.equal(plan.filter((entry) => entry.path !== entry.fallbackPath).length, 8);
  assert.ok(plan.every((entry) => !entry.path.match(/\.png(?:\?|$)/)));
  assert.ok(getTextureUrl(decks.woodland, "card-back.png").includes("card-back.webp?v="));
  assert.ok(getTextureUrl(decks.woodland, "card-back.png", true).includes("card-back.png?v="));
});

test("preview and selected-deck requests deduplicate concurrent loads and keep cached successes", async () => {
  const requests = [];
  const cache = createDeckTextureCache(plan, async (path) => { requests.push(path); return { path }; });
  await Promise.all([cache.preloadPreviews(), cache.ensureDeck("woodland"), cache.ensureDeck("woodland")]);
  assert.equal(requests.length, 26 + 9);
  assert.equal(new Set(requests).size, requests.length);
  await cache.ensureDeck("woodland"); assert.equal(requests.length, 35);
  assert.equal(cache.textures["woodland:guidebook-front.png"].path, getTextureUrl(decks.woodland, "guidebook-front.png"));
});

test("a failed preview does not block other decks and selection retries only missing materials", async () => {
  const failed = plan.find((entry) => entry.key === "redvisions:outer-front.jpg");
  let attempts = 0;
  const requests = [];
  const cache = createDeckTextureCache(plan, async (path) => {
    requests.push(path);
    if (path === failed.path && ++attempts === 1) throw new Error("offline");
    return { path };
  });
  const results = await cache.preloadPreviews();
  assert.equal(results.filter((entry) => entry.status === "rejected").length, 1);
  await cache.ensureDeck("redvisions");
  assert.equal(attempts, 2);
  assert.equal(requests.length, 26 + 10);
  assert.ok(cache.textures[failed.key]);
  await assert.rejects(cache.ensureDeck("missing"), /Unknown deck/);
});

test("null loader results fail explicitly and remain retryable", async () => {
  let available = false;
  const cache = createDeckTextureCache([plan[0]], async () => available ? {} : null);
  await assert.rejects(cache.ensureDeck(plan[0].deckKey), /unavailable/);
  available = true;
  await cache.ensureDeck(plan[0].deckKey);
  assert.ok(cache.textures[plan[0].key]);
});

test("controller IDs bind existing markup; obsolete question and spread menus are removed", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../draw-ritual.js", import.meta.url), "utf8");
  for (const [, id] of source.matchAll(/find\("([^"]+)"\)/g)) assert.ok(html.includes(`id="${id}"`), id);
  assert.ok(!html.includes('id="draw-question"'));
  assert.ok(!html.includes('id="draw-spread"'));
  assert.ok(!html.includes("星光選牌"));
  assert.ok(html.includes('id="draw-collect"'));
  assert.ok(html.includes('id="draw-hold"'));
});
