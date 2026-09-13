import test from "node:test";
import assert from "node:assert/strict";
import { Blob, File } from "node:buffer";
import { readFileSync } from "node:fs";
import { createReadingImageShare } from "../reading-share.js";

class Button {
  hidden = false;
  disabled = false;
  attributes = new Map();
  listeners = new Map();
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  removeAttribute(name) { this.attributes.delete(name); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  // Intentionally dispatch even when disabled: the handler must guard duplicates.
  click() { return this.listeners.get("click")?.(); }
}

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 24, 7]);
const png = () => new Blob([pngBytes], { type: "image/png" });
const filename = "塔羅-十二宮位-2026-09-13T05-10-17-173Z.png";
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture(overrides = {}, options = {}) {
  const button = new Button(), status = { textContent: "" }, calls = [], checks = [];
  const platform = {
    canShare(data) { assert.equal(this, platform); checks.push(data); return true; },
    share(data) { assert.equal(this, platform); calls.push(data); return Promise.resolve(); },
    ...overrides,
  };
  const controller = createReadingImageShare({ button, status, platform,
    FileClass: File, secureContext: true, ...options });
  return { button, status, calls, checks, platform, controller };
}

test("prepares the same PNG bytes, MIME type and Chinese filename before showing the share action", async () => {
  const { controller, button, status, checks, calls } = fixture();
  assert.ok(button.hidden && button.disabled);
  await button.click();
  assert.equal(calls.length, 0);
  const blob = png();
  assert.equal(controller.prepare(blob, filename), true);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, false);
  assert.equal(calls.length, 0, "preparing must never open a native share sheet");
  assert.equal(checks.length, 1);
  assert.deepEqual(Object.keys(checks[0]), ["files"]);
  const file = checks[0].files[0];
  assert.ok(file instanceof File);
  assert.equal(file.name, filename);
  assert.equal(file.type, "image/png");
  assert.equal(file.size, blob.size);
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), pngBytes);
  assert.match(status.textContent, /圖片本身.*不附加網址/);
  await button.click();
  assert.deepEqual(Object.keys(calls[0]), ["files"]);
  assert.deepEqual(calls[0].files, [file]);
  assert.match(status.textContent, /交給系統分享/);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-busy"), null);
});

test("calls native share synchronously from the tap, before queued microtasks or encoding work", async () => {
  const order = [], native = deferred();
  const { controller, button } = fixture({ share(data) {
    order.push("native-share");
    assert.deepEqual(Object.keys(data), ["files"]);
    return native.promise;
  } });
  controller.prepare(png(), filename);
  queueMicrotask(() => order.push("microtask"));
  const sharing = button.click();
  order.push("click-returned");
  assert.deepEqual(order, ["native-share", "click-returned"]);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), "true");
  await Promise.resolve();
  assert.deepEqual(order, ["native-share", "click-returned", "microtask"]);
  native.resolve();
  await sharing;
});

test("ignores repeated taps while the system share promise is pending", async () => {
  const native = deferred(), payloads = [];
  const { controller, button, status } = fixture({ share(data) { payloads.push(data); return native.promise; } });
  controller.prepare(png(), filename);
  const sharing = button.click(), openingMessage = status.textContent;
  await button.click();
  await button.click();
  assert.equal(payloads.length, 1);
  assert.equal(status.textContent, openingMessage);
  assert.equal(button.disabled, true);
  native.resolve();
  await sharing;
  assert.equal(button.disabled, false);
});

test("cancelling keeps the same prepared File available for a fresh user-initiated retry", async () => {
  const native = deferred(), payloads = [];
  const { controller, button, status } = fixture({ share(data) {
    payloads.push(data); return payloads.length === 1 ? native.promise : Promise.resolve();
  } });
  controller.prepare(png(), filename);
  const sharing = button.click();
  native.reject(new DOMException("User cancelled", "AbortError"));
  await sharing;
  assert.match(status.textContent, /取消分享.*圖片仍保留/);
  assert.equal(button.disabled, false);
  assert.equal(button.getAttribute("aria-busy"), null);
  await button.click();
  assert.equal(payloads.length, 2);
  assert.equal(payloads[1].files[0], payloads[0].files[0]);
  assert.ok(payloads.every((data) => Object.keys(data).join() === "files"));
});

test("unsupported or blocked environments retain download guidance and never fall back to URL sharing", async (t) => {
  const cases = [
    ["no navigator", {}, { platform: null }],
    ["no share", { share: undefined }, {}],
    ["no canShare", { canShare: undefined }, {}],
    ["canShare rejects files", { canShare: () => false }, {}],
    ["canShare throws", { canShare: () => { throw new TypeError("Unsupported files"); } }, {}],
    ["insecure origin", {}, { secureContext: false }],
    ["missing File API", {}, { FileClass: null }],
    ["File construction throws", {}, { FileClass: class { constructor() { throw new Error("Cannot build file"); } } }],
  ];
  for (const [name, overrides, options] of cases) await t.test(name, async () => {
    const { controller, button, status, calls } = fixture(overrides, options);
    assert.equal(controller.prepare(png(), filename), false);
    assert.equal(button.hidden, false, "explain unsupported sharing alongside existing download options");
    assert.equal(button.disabled, true);
    assert.match(status.textContent, /下載 PNG/);
    assert.match(status.textContent, /照片.*分享/);
    await button.click();
    assert.equal(calls.length, 0);
  });
});

test("empty, missing or non-PNG exports cannot be sent as an image", async () => {
  const { controller, button, calls, checks } = fixture();
  for (const blob of [null, undefined, new Blob([], { type: "image/png" }), new Blob([pngBytes], { type: "image/jpeg" })]) {
    assert.equal(controller.prepare(blob, filename), false);
    assert.equal(button.disabled, true);
    await button.click();
  }
  assert.equal(calls.length, 0);
  assert.equal(checks.length, 0);
});

test("native synchronous throws and rejected errors restore a retryable file-only action", async (t) => {
  for (const [name, synchronous] of [["NotAllowedError", true], ["TypeError", false], ["DataError", false], ["InvalidStateError", false]]) {
    await t.test(name, async () => {
      const payloads = [], error = new DOMException("Native share failed", name);
      const { controller, button, status } = fixture({ share(data) {
        payloads.push(data);
        if (payloads.length > 1) return Promise.resolve();
        if (synchronous) throw error;
        return Promise.reject(error);
      } });
      controller.prepare(png(), filename);
      await button.click();
      assert.equal(button.disabled, false);
      assert.equal(button.getAttribute("aria-busy"), null);
      assert.match(status.textContent, /下載/);
      assert.match(status.textContent, name === "InvalidStateError" ? /關閉目前的系統分享視窗/ : /重新點按/);
      await button.click();
      assert.equal(payloads.length, 2);
      assert.equal(payloads[1].files[0], payloads[0].files[0]);
      assert.ok(payloads.every((data) => Object.keys(data).join() === "files"));
    });
  }
});

test("clear removes share access, and an old pending completion cannot restore a closed preview", async (t) => {
  for (const outcome of ["resolve", "reject"]) await t.test(outcome, async () => {
    const native = deferred(), payloads = [];
    const { controller, button, status } = fixture({ share(data) { payloads.push(data); return native.promise; } });
    controller.prepare(png(), filename);
    const sharing = button.click();
    controller.clear();
    const closedStatus = status.textContent;
    assert.ok(button.hidden && button.disabled);
    await button.click();
    assert.equal(payloads.length, 1);
    if (outcome === "resolve") native.resolve();
    else native.reject(new DOMException("Cancelled after close", "AbortError"));
    await sharing;
    assert.equal(status.textContent, closedStatus);
    assert.ok(button.hidden && button.disabled);
    assert.equal(button.getAttribute("aria-busy"), null);
  });
});

test("replacing a preview keeps the old native share locked and preserves the new PNG after it settles", async (t) => {
  for (const outcome of ["resolve", "reject"]) await t.test(outcome, async () => {
    const native = deferred(), payloads = [];
    const { controller, button, status, checks } = fixture({ share(data) {
      payloads.push(data); return payloads.length === 1 ? native.promise : Promise.resolve();
    } });
    controller.prepare(png(), filename);
    const sharing = button.click(), firstFile = checks[0].files[0];
    controller.clear();
    controller.prepare(new Blob([pngBytes, new Uint8Array([42])], { type: "image/png" }), "塔羅-新牌陣.png");
    const newStatus = status.textContent, secondFile = checks[1].files[0];
    assert.notEqual(secondFile, firstFile);
    assert.equal(button.hidden, false);
    assert.equal(button.disabled, true, "native share in-flight lock survives clear/prepare");
    assert.equal(button.getAttribute("aria-busy"), "true");
    await button.click();
    assert.equal(payloads.length, 1);
    if (outcome === "resolve") native.resolve();
    else native.reject(new DOMException("Old share cancelled", "AbortError"));
    await sharing;
    assert.equal(status.textContent, newStatus, "old outcome must not overwrite a newly prepared reading");
    assert.equal(button.disabled, false);
    assert.equal(button.getAttribute("aria-busy"), null);
    await button.click();
    assert.equal(payloads.length, 2);
    assert.equal(payloads[1].files[0], secondFile);
    assert.equal(payloads[1].files[0].name, "塔羅-新牌陣.png");
  });
});

test("old completion cannot enable a replacement whose platform no longer accepts PNG files", async () => {
  const native = deferred();
  const { controller, button, status, platform } = fixture({ share: () => native.promise });
  controller.prepare(png(), filename);
  const sharing = button.click();
  platform.canShare = () => false;
  controller.prepare(png(), "新牌陣.png");
  const fallbackStatus = status.textContent;
  native.resolve();
  await sharing;
  assert.equal(status.textContent, fallbackStatus);
  assert.equal(button.hidden, false);
  assert.equal(button.disabled, true);
  assert.equal(button.getAttribute("aria-busy"), null);
});

test("app wires the same completed PNG into sharing and clears state on export and dialog close", () => {
  const source = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../reading-export.css", import.meta.url), "utf8");
  const appVersion = html.match(/src="\.\/app\.js\?v=([^\"]+)"/)?.[1];
  const moduleVersion = source.match(/from "\.\/reading-share\.js\?v=([^\"]+)"/)?.[1];
  assert.ok(appVersion);
  assert.equal(moduleVersion, appVersion, "new sharing module and entry point must both bypass stale caches");
  assert.match(html, new RegExp(`reading-export\\.css\\?v=${appVersion}`));
  assert.match(source, /const readingImageShare = createReadingImageShare\(\{\s*button: document\.querySelector\("#reading-export-share"\),\s*status: document\.querySelector\("#reading-export-status"\)/);
  assert.match(source, /querySelector\("#reading-export-dialog"\)\.addEventListener\("close", \(\) => \{\s*readingImageShare\.clear\(\)/);
  const exporting = source.match(/^async function exportReadingImage\([^]*?^}/m)?.[0];
  assert.ok(exporting);
  assert.ok(exporting.indexOf("readingImageShare.clear()") < exporting.indexOf("dialog.showModal()"));
  assert.ok(exporting.indexOf("const blob = await readingExportBlob(canvas)") < exporting.indexOf("readingImageShare.prepare(blob, download.download)"));
  assert.match(exporting, /const blob = await readingExportBlob\(canvas\);\s*if \(readingResult !== result \|\| !dialog\.open\) return;/);
  assert.doesNotMatch(exporting, /navigator\.share\s*\(/, "PNG creation must not spend the earlier tap's expired activation");
  const footer = html.match(/<footer><button id="reading-export-share"[^]*?<\/footer>/)?.[0];
  assert.ok(footer);
  assert.ok(footer.indexOf("分享圖片") < footer.indexOf("reading-export-download"));
  assert.match(footer, /type="button"[^>]*aria-describedby="reading-export-help"[^>]*hidden disabled/);
  assert.match(html, /id="reading-export-help"[^>]*>[^<]*Safari 工具列[^<]*網頁網址/);
  assert.match(css, /#reading-export-share\s*\{[^}]*flex:\s*1 0 100%/);
});
