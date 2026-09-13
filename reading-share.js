const READY = "完整牌陣已備妥，包含牌位、牌名、正逆位與切牌，不含操作按鈕。尚未翻牌的卡片保留牌背。";
const FALLBACK = "此瀏覽器暫不支援直接分享圖片；可下載 PNG，或長按下圖儲存到照片，再從照片分享。iPhone 也可改用 Safari 開啟本站。";

// Prepare the actual PNG File before the next tap. In particular, no encoding,
// fetch or asynchronous work may precede navigator.share in the click handler.
export function createReadingImageShare({ button, status,
  platform = globalThis.navigator, FileClass = globalThis.File,
  secureContext = globalThis.isSecureContext } = {}) {
  let file = null, supported = false, pending = false, revision = 0;

  function clear() {
    revision += 1;
    file = null; supported = false;
    button.hidden = true; button.disabled = true;
    button.removeAttribute("aria-busy");
  }

  function prepare(blob, filename) {
    clear();
    try {
      if (blob?.type === "image/png" && blob.size > 0 && typeof FileClass === "function") {
        file = new FileClass([blob], filename, { type: "image/png" });
        supported = secureContext === true && typeof platform?.share === "function"
          && typeof platform?.canShare === "function" && platform.canShare({ files: [file] });
      }
    } catch {
      supported = false;
    }
    button.hidden = false;
    button.disabled = !supported || pending;
    if (pending) button.setAttribute("aria-busy", "true");
    status.textContent = `${READY} ${!supported ? FALLBACK : pending
      ? "請先關閉目前的系統分享視窗，再分享這張新圖片。"
      : "按「分享圖片」會分享 PNG 圖片本身，不附加網址；也可下載或長按下圖儲存。"}`;
    return supported;
  }

  async function share() {
    if (!file || !supported || pending) return;
    const sharedFile = file, attempt = ++revision;
    pending = true; button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.textContent = "正在開啟系統圖片分享…請選擇 App 或儲存影像。";
    try {
      // Files only: adding even an empty URL can share the page instead.
      await platform.share({ files: [sharedFile] });
      if (attempt === revision) status.textContent = "PNG 圖片已交給系統分享；可再次分享或下載。";
    } catch (error) {
      if (attempt !== revision) return;
      status.textContent = error?.name === "AbortError"
        ? "已取消分享，圖片仍保留；可再次分享或下載。"
        : error?.name === "InvalidStateError"
          ? "請先關閉目前的系統分享視窗，再按「分享圖片」。也可下載或長按圖片儲存。"
          : "暫時無法開啟圖片分享，可重新點按，或下載／長按圖片儲存到照片後分享。若使用 App 內建瀏覽器，請改用 Safari 開啟本站。";
    } finally {
      // Closing or replacing the preview invalidates an older native share.
      pending = false; button.disabled = !supported;
      button.removeAttribute("aria-busy");
    }
  }

  clear();
  button.addEventListener("click", share);
  return { prepare, clear };
}
