import { createDrawSession, pickDrawCard, autoPickDrawCard } from "./draw-session.js?v=20260909-01";

// Controls the ritual only; the adapter owns the existing Three.js stage.
export function createDrawRitual(adapter) {
  const dialog = document.querySelector("#draw-ritual");
  const find = (id) => dialog.querySelector(`#${id}`);
  const title = find("draw-ritual-title");
  const status = find("draw-ritual-status");
  const question = find("draw-question");
  const track = find("draw-card-track");
  const hold = find("draw-hold");
  const collect = find("draw-collect");
  const progress = find("draw-progress");
  const progressLabel = find("draw-progress-label");
  const error = find("draw-error");
  const retry = find("draw-retry");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let session = null;
  let generation = 0;
  let sceneReady = false;
  let collectRequested = false;
  let automatic = false;
  let holding = false;
  let heldMs = 0;
  let lastFrame = 0;
  let holdFrame = 0;
  let pending = false;
  let returnFocus = null;
  let retryAction = null;
  let lastQuestion = "";
  let lastMethod = "manual";
  let context = null;
  let drag = null;
  let suppressClickUntil = 0;

  function phase(value, heading, instruction) {
    dialog.dataset.phase = value;
    dialog.querySelectorAll("[data-draw-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.drawPanel !== value;
    });
    title.textContent = heading;
    status.textContent = instruction;
    dialog.scrollTop = 0;
  }

  function clearError() {
    error.hidden = true;
    retry.hidden = true;
    retryAction = null;
  }

  function showError(message, action) {
    pending = false;
    dialog.removeAttribute("aria-busy");
    error.textContent = message;
    error.hidden = false;
    retryAction = action;
    retry.hidden = false;
    retry.focus();
  }

  function stopHold() {
    holding = false;
    cancelAnimationFrame(holdFrame);
    holdFrame = 0;
    dialog.classList.remove("is-holding");
  }

  function updateProgress() {
    const amount = Math.min(100, Math.round(heldMs / 18));
    progress.value = amount;
    progressLabel.textContent = amount === 100 ? "洗牌完成" : `洗牌 ${amount}%`;
    collect.disabled = amount < 100 || !sceneReady || collectRequested;
    hold.disabled = amount === 100;
    if (automatic) {
      progressLabel.textContent = "星光正在聚攏";
      return;
    }
    if (amount === 100 && !sceneReady) status.textContent = "洗牌完成，牌組正在聚攏…";
    else if (amount === 100) status.textContent = "讓牌停在此刻；展開後，挑一張與你呼應的牌。";
  }

  function holdTick(now) {
    if (!holding || !dialog.open || dialog.dataset.phase !== "shuffling") return;
    heldMs += Math.max(0, now - lastFrame);
    lastFrame = now;
    updateProgress();
    if (heldMs >= 1800) stopHold();
    else holdFrame = requestAnimationFrame(holdTick);
  }

  function startHold() {
    if (holding || hold.disabled || automatic || dialog.dataset.phase !== "shuffling") return;
    holding = true;
    lastFrame = performance.now();
    dialog.classList.add("is-holding");
    holdFrame = requestAnimationFrame(holdTick);
  }

  function focusChoice(position) {
    const buttons = [...track.querySelectorAll(".draw-choice")];
    const index = Math.max(0, Math.min(position, buttons.length - 1));
    buttons.forEach((button, number) => { button.tabIndex = number === index ? 0 : -1; });
    const button = buttons[index];
    button?.focus({ preventScroll: true });
    button?.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion.matches ? "auto" : "smooth" });
  }

  function buildChoices() {
    const fragment = document.createDocumentFragment();
    session.order.forEach((_, position) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "draw-choice";
      button.dataset.position = String(position);
      button.setAttribute("aria-label", `選擇第 ${position + 1} 張牌背`);
      button.tabIndex = position === 0 ? 0 : -1;
      const number = document.createElement("span");
      number.textContent = String(position + 1).padStart(2, "0");
      number.setAttribute("aria-hidden", "true");
      button.append(number);
      fragment.append(button);
    });
    track.replaceChildren(fragment);
    track.scrollLeft = 0;
  }

  async function deliverSelection() {
    if (pending || !session || session.selectedIndex === null) return;
    const token = generation;
    const chosenSession = session;
    pending = true;
    clearError();
    status.textContent = "已選定，正在將這張牌送往中央…";
    dialog.setAttribute("aria-busy", "true");
    find("draw-auto-pick").disabled = true;
    find("draw-selection-count").textContent = "1 / 1 · 已選定";
    const slot = find("draw-slot");
    slot.replaceChildren();
    const card = document.createElement("span");
    card.className = "draw-slot-card";
    card.setAttribute("aria-hidden", "true");
    slot.append(card);
    slot.classList.add("is-filled");
    track.querySelectorAll(".draw-choice").forEach((button) => { button.disabled = true; });
    try {
      await adapter.prepareSelection(chosenSession.selectedIndex, chosenSession);
      if (token !== generation || !dialog.open) return;
      if (!reducedMotion.matches) await new Promise((resolve) => setTimeout(resolve, 480));
      if (token !== generation || !dialog.open) return;
      adapter.commitSelection(chosenSession.selectedIndex, chosenSession);
      pending = false;
      dialog.removeAttribute("aria-busy");
      dialog.close();
      adapter.focusResult();
    } catch {
      if (token !== generation || !dialog.open) return;
      showError("這張牌的牌面暫時無法載入。重試會保留同一張牌。", deliverSelection);
    }
  }

  function choose(position = null) {
    if (!session || session.phase !== "selecting" || pending) return;
    if (position === null) {
      session.method = "starlight";
      autoPickDrawCard(session);
    }
    else pickDrawCard(session, position);
    if (session.selectedIndex === null) return;
    track.querySelector(`[data-position="${position ?? 0}"]`)?.classList.add("is-picked");
    void deliverSelection();
  }

  function finishShuffle() {
    if (!sceneReady || !collectRequested || !session || session.phase !== "shuffling") return;
    stopHold();
    session.phase = "selecting";
    phase("selecting", automatic ? "星光已為你留下一張牌" : "選一張與你呼應的牌", "左右滑動牌列，憑直覺選取一張；選定後才翻開。 ");
    find("draw-selection-count").textContent = "0 / 1 · 待選取";
    find("draw-auto-pick").disabled = false;
    buildChoices();
    if (automatic) choose();
    else focusChoice(0);
  }

  async function start() {
    if (pending) return;
    const token = generation;
    clearError();
    pending = true;
    find("draw-start").disabled = true;
    status.textContent = "正在準備這副牌…";
    dialog.setAttribute("aria-busy", "true");
    try {
      const cards = await adapter.loadDeck(context.deckKey);
      if (token !== generation || !dialog.open) return;
      if (!cards.length) throw new Error("Deck unavailable");
      lastQuestion = question.value.trim().slice(0, 200);
      lastMethod = dialog.querySelector('input[name="draw-method"]:checked')?.value ?? "manual";
      session = createDrawSession({ deckKey: context.deckKey, cards, method: lastMethod, question: lastQuestion });
      session.phase = "shuffling";
      automatic = lastMethod === "starlight";
      collectRequested = automatic;
      heldMs = automatic ? 1800 : 0;
      sceneReady = false;
      pending = false;
      dialog.removeAttribute("aria-busy");
      dialog.classList.toggle("is-starlight", automatic);
      hold.hidden = automatic;
      collect.hidden = automatic;
      find("draw-skip").hidden = automatic;
      phase("shuffling", automatic ? "讓星光帶路" : "把問題留在心裡", automatic ? "星光正在聚攏，請稍候…" : "按住洗牌按鈕；放開可暫停，也可以讓星光代你選牌。");
      updateProgress();
      adapter.startAnimation(session);
      if (!automatic) hold.focus();
      else find("draw-ritual-close").focus();
    } catch {
      if (token !== generation || !dialog.open) return;
      find("draw-start").disabled = false;
      showError("這副牌暫時無法準備，請重試或返回牌盒。", start);
    }
  }

  function cancel({ restore = true } = {}) {
    generation += 1;
    stopHold();
    pending = false;
    if (dialog.open) dialog.close();
    session = null;
    dialog.removeAttribute("aria-busy");
    if (restore) {
      adapter.cancelAnimation();
      if (returnFocus?.isConnected && !returnFocus.disabled) returnFocus.focus({ preventScroll: true });
    }
  }

  function open() {
    if (dialog.open) return;
    generation += 1;
    session = null;
    pending = false;
    returnFocus = document.activeElement;
    context = adapter.getContext();
    adapter.onOpen();
    clearError();
    dialog.classList.remove("is-starlight", "is-holding");
    find("draw-slot").replaceChildren();
    find("draw-slot").classList.remove("is-filled");
    find("draw-ritual-deck").textContent = context.name;
    dialog.style.setProperty("--draw-card-back", `url("${context.backUrl}")`);
    question.value = lastQuestion;
    find("draw-question-count").textContent = `${question.value.length} / 200`;
    dialog.querySelectorAll('input[name="draw-method"]').forEach((input) => { input.checked = input.value === lastMethod; });
    find("draw-start").disabled = false;
    phase("setup", "留一個問題，等一張回應", "單張牌 · 問題可留白，在心裡默念也可以。");
    dialog.showModal();
    question.focus({ preventScroll: true });
  }

  find("draw-start").addEventListener("click", start);
  find("draw-ritual-close").addEventListener("click", () => cancel());
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); cancel(); });
  dialog.addEventListener("keydown", (event) => event.stopPropagation());
  retry.addEventListener("click", () => retryAction?.());
  question.addEventListener("input", () => { find("draw-question-count").textContent = `${question.value.length} / 200`; });
  hold.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    hold.focus();
    hold.setPointerCapture(event.pointerId);
    startHold();
  });
  ["pointerup", "pointercancel", "lostpointercapture", "blur"].forEach((event) => hold.addEventListener(event, stopHold));
  hold.addEventListener("keydown", (event) => {
    if (event.key !== " ") return;
    event.preventDefault();
    startHold();
  });
  hold.addEventListener("keyup", (event) => {
    if (event.key === " ") { event.preventDefault(); stopHold(); }
  });
  // Enter and assistive activation run a timed shuffle without a sustained press.
  hold.addEventListener("click", (event) => { if (event.detail === 0) startHold(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopHold(); });
  collect.addEventListener("click", () => { collectRequested = true; finishShuffle(); });
  find("draw-skip").addEventListener("click", () => {
    automatic = true;
    collectRequested = true;
    session.method = "starlight";
    stopHold();
    heldMs = 1800;
    dialog.classList.add("is-starlight");
    hold.hidden = true;
    collect.hidden = true;
    find("draw-skip").hidden = true;
    status.textContent = "已交給星光選牌，等待牌組就緒…";
    updateProgress();
    finishShuffle();
  });
  find("draw-auto-pick").addEventListener("click", () => choose());
  track.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) return;
    const button = event.target.closest(".draw-choice");
    if (button && !button.disabled) choose(Number(button.dataset.position));
  });
  track.addEventListener("keydown", (event) => {
    const button = event.target.closest(".draw-choice");
    if (!button || session?.phase !== "selecting") return;
    let index = Number(button.dataset.position);
    if (event.key === "ArrowLeft") index -= 1;
    else if (event.key === "ArrowRight") index += 1;
    else if (event.key === "Home") index = 0;
    else if (event.key === "End") index = session.order.length - 1;
    else return;
    event.preventDefault();
    focusChoice(index);
  });
  track.addEventListener("pointerdown", (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, left: track.scrollLeft, moved: false };
  });
  track.addEventListener("pointermove", (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    const offset = event.clientX - drag.x;
    if (!drag.moved && Math.abs(offset) < 7) return;
    drag.moved = true;
    track.setPointerCapture(event.pointerId);
    track.scrollLeft = drag.left - offset;
    event.preventDefault();
  });
  function endDrag() {
    if (drag?.moved) suppressClickUntil = performance.now() + 300;
    drag = null;
  }
  track.addEventListener("pointerup", endDrag);
  track.addEventListener("pointercancel", endDrag);
  track.addEventListener("lostpointercapture", endDrag);
  track.addEventListener("wheel", (event) => {
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    track.scrollLeft += event.deltaY;
  }, { passive: false });
  for (const [id, direction] of [["draw-cards-previous", -1], ["draw-cards-next", 1]]) {
    find(id).addEventListener("click", () => track.scrollBy({ left: direction * track.clientWidth * 0.75, behavior: reducedMotion.matches ? "auto" : "smooth" }));
  }

  return {
    open,
    cancel,
    get isOpen() { return dialog.open; },
    get session() { return session; },
    animationComplete() {
      if (!dialog.open || session?.phase !== "shuffling") return;
      sceneReady = true;
      updateProgress();
      finishShuffle();
    },
  };
}
