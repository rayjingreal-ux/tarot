import { createDrawSession, pickDrawCard, autoPickDrawCard, cutDrawDeck, availableDrawPositions } from "./draw-session.js?v=20260913-01";
import { DRAW_SPREADS, getDrawSpread } from "./draw-spreads.js?v=20260913-01";

// Transparent stage HUD; the adapter animates and picks real cards in the existing Three.js scene.
export function createDrawRitual(adapter) {
  const surface = document.querySelector("#draw-ritual");
  const find = (id) => surface.querySelector(`#${id}`);
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
  const spreadSelect = find("draw-spread");
  DRAW_SPREADS.forEach((spread) => {
    const option = document.createElement("option");
    option.value = spread.id;
    option.textContent = `${spread.name} · ${spread.count} 張`;
    spreadSelect.append(option);
  });
  function updateSpreadPreview() {
    const layout = getDrawSpread(spreadSelect.value);
    find("draw-spread-description").textContent = `${layout.count} 張主牌 ＋ 1 張切牌 · ${layout.description}`;
    const preview = find("draw-spread-preview");
    preview.replaceChildren();
    const xs = layout.slots.map((slot) => slot.x), ys = layout.slots.map((slot) => slot.y);
    const width = Math.max(...xs) - Math.min(...xs) + 1, height = Math.max(...ys) - Math.min(...ys) + 1;
    layout.slots.forEach((slot, index) => {
      const item = document.createElement("span");
      item.textContent = String(index + 1);
      item.style.left = `${(slot.x - Math.min(...xs) + 0.5) / width * 100}%`;
      item.style.top = `${(slot.y - Math.min(...ys) + 0.5) / height * 100}%`;
      preview.append(item);
    });
  }
  spreadSelect.addEventListener("change", updateSpreadPreview);
  updateSpreadPreview();
  const visual = { phase: "idle", progress: 0, holding: false, focus: 0, selectedPosition: -1, phaseStartedAt: 0 };
  const shuffleDuration = 2400;
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
  let chooseReadyAt = 0;

  function phase(value, heading, instruction) {
    visual.phase = value;
    visual.phaseStartedAt = performance.now();
    surface.dataset.phase = value;
    adapter.phaseChanged?.(value);
    surface.querySelectorAll("[data-draw-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.drawPanel !== (value === "cutting" ? "selecting" : value);
    });
    title.textContent = heading;
    status.textContent = instruction;
    surface.scrollTop = 0;
  }

  function clearError() {
    error.hidden = true;
    retry.hidden = true;
    retryAction = null;
  }

  function showError(message, action) {
    pending = false;
    surface.removeAttribute("aria-busy");
    error.textContent = message;
    error.hidden = false;
    retryAction = action;
    retry.hidden = false;
    retry.focus();
  }

  function stopHold() {
    holding = false;
    visual.holding = false;
    cancelAnimationFrame(holdFrame);
    holdFrame = 0;
    surface.classList.remove("is-holding");
  }

  function updateProgress() {
    visual.progress = Math.min(1, heldMs / shuffleDuration);
    surface.style.setProperty("--ritual-progress", String(visual.progress));
    const amount = Math.floor(visual.progress * 100);
    progress.value = amount;
    progressLabel.textContent = amount === 100 ? "洗牌完成" : `洗牌 ${amount}%`;
    collect.disabled = amount < 100 || !sceneReady || collectRequested;
    hold.disabled = amount === 100;
    if (automatic) {
      progressLabel.textContent = `星光聚攏 · ${amount}%`;
      return;
    }
    if (amount === 100 && !sceneReady) status.textContent = "洗牌完成，牌組正在聚攏…";
    else if (amount === 100) status.textContent = "洗牌完成；接著先選擇切牌位置。";
  }

  function holdTick(now) {
    if (!holding || surface.hidden || surface.dataset.phase !== "shuffling") return;
    heldMs += Math.max(0, now - lastFrame);
    lastFrame = now;
    updateProgress();
    if (heldMs >= shuffleDuration) {
      stopHold();
      finishShuffle();
      if (!automatic && sceneReady) collect.focus({ preventScroll: true });
    }
    else holdFrame = requestAnimationFrame(holdTick);
  }

  function startHold(force = false) {
    if (holding || hold.disabled || (automatic && !force) || surface.dataset.phase !== "shuffling") return;
    holding = true;
    visual.holding = true;
    lastFrame = performance.now();
    surface.classList.add("is-holding");
    holdFrame = requestAnimationFrame(holdTick);
  }

  function focusChoice(position, focusDOM = true) {
    if (!session || !["cutting", "selecting"].includes(session.phase)) return;
    const buttons = [...track.querySelectorAll(".draw-choice")];
    const available = availableDrawPositions(session);
    const requested = Math.max(0, Math.min(Math.round(position), buttons.length - 1));
    const index = position < visual.focus
      ? [...available].reverse().find((value) => value <= requested) ?? available[0]
      : available.find((value) => value >= requested) ?? available.at(-1);
    if (index === undefined) return;
    visual.focus = index;
    buttons.forEach((button, number) => { button.tabIndex = number === index ? 0 : -1; });
    const layout = getDrawSpread(session.spreadId);
    find("draw-selection-count").textContent = session.phase === "cutting"
      ? `切牌位置 ${index + 1} / ${buttons.length} · 切牌不計入主牌`
      : `已選 ${session.draws.length} / ${session.drawCount} · 下一張：${layout.slots[session.draws.length]?.label ?? "完成"} · 位置 ${index + 1}`;
    if (focusDOM) buttons[index]?.focus({ preventScroll: true });
  }

  function closeSurface() {
    stopHold();
    surface.hidden = true;
    surface.setAttribute("aria-hidden", "true");
    surface.inert = true;
    surface.removeAttribute("aria-busy");
    visual.phase = "idle";
    adapter.phaseChanged?.("idle");
  }

  function buildChoices() {
    const fragment = document.createDocumentFragment();
    session.order.forEach((_, position) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "draw-choice";
      button.dataset.position = String(position);
      const picked = session.draws.some((entry) => entry.position === position);
      button.disabled = picked;
      button.setAttribute("aria-label", `${session.phase === "cutting" ? "切牌位置" : "選擇牌背位置"} ${position + 1}${picked ? "，已選取" : ""}`);
      button.tabIndex = position === 0 ? 0 : -1;
      const number = document.createElement("span");
      number.textContent = String(position + 1).padStart(2, "0");
      number.setAttribute("aria-hidden", "true");
      button.append(number);
      fragment.append(button);
    });
    track.replaceChildren(fragment);
    track.scrollLeft = 0;
    focusChoice(visual.focus || (matchMedia("(max-width: 680px)").matches ? 2 : 4), false);
  }

  async function deliverSelection() {
    if (pending || !session || session.selectedIndex === null) return;
    const token = generation;
    const chosenSession = session;
    pending = true;
    clearError();
    status.textContent = "主牌已選齊，正在展開牌陣與切牌…";
    surface.setAttribute("aria-busy", "true");
    find("draw-auto-pick").disabled = true;
    find("draw-selection-count").textContent = `${session.draws.length} / ${session.drawCount} · 已選定`;
    const slot = find("draw-slot");
    slot.replaceChildren();
    const card = document.createElement("span");
    card.className = "draw-slot-card";
    card.setAttribute("aria-hidden", "true");
    slot.append(card);
    slot.classList.add("is-filled");
    track.querySelectorAll(".draw-choice").forEach((button) => { button.disabled = true; });
    try {
      await adapter.prepareSelection([...chosenSession.draws, chosenSession.cut].filter(Boolean).map((entry) => entry.index), chosenSession);
      if (token !== generation || surface.hidden) return;
      const remaining = reducedMotion.matches ? 0 : Math.max(0, 1150 - (performance.now() - visual.phaseStartedAt));
      if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
      if (token !== generation || surface.hidden) return;
      adapter.commitSelection(chosenSession.selectedIndex, chosenSession);
      pending = false;
      surface.removeAttribute("aria-busy");
      closeSurface();
      adapter.focusResult();
    } catch {
      if (token !== generation || surface.hidden) return;
      showError("部分牌面暫時無法載入。重試會保留這次切牌、抽牌與正逆位，不重新抽取。", deliverSelection);
    }
  }

  function choose(position = null) {
    if (!session || pending || !["cutting", "selecting"].includes(session.phase)) return;
    if (!automatic && performance.now() < chooseReadyAt) return;
    if (session.phase === "cutting") {
      const cutPosition = position ?? Math.floor(Math.random() * session.order.length);
      cutDrawDeck(session, cutPosition);
      // Ignore the second tap of a cut double-click while shuffled positions rotate.
      chooseReadyAt = performance.now() + 350;
      visual.focus = 0;
      adapter.orderChanged?.(session);
      phase("selecting", "依照牌位，選出你的牌", `切牌已保留在左下角；請再抽 ${session.drawCount} 張主牌。`);
      find("draw-auto-pick").textContent = "自動補齊主牌";
      buildChoices();
      if (automatic) choose();
      else adapter.focusChoices?.();
      return;
    }
    if (position !== null && !availableDrawPositions(session).includes(position)) return;
    if (position === null) {
      session.method = "starlight";
      while (session.phase === "selecting") autoPickDrawCard(session);
    }
    else pickDrawCard(session, position);
    if (session.phase === "selecting") {
      buildChoices();
      adapter.focusChoices?.();
      return;
    }
    track.querySelector(`[data-position="${position ?? 0}"]`)?.classList.add("is-picked");
    visual.selectedPosition = position ?? 0;
    phase("revealing", "牌陣，正在成形", "主牌與切牌將一同呈現，等待你翻開。");
    find("draw-ritual-close").focus({ preventScroll: true });
    void deliverSelection();
  }

  function finishShuffle() {
    if (!sceneReady || !collectRequested || heldMs < shuffleDuration || !session || session.phase !== "shuffling") return;
    stopHold();
    session.phase = "cutting";
    phase("cutting", "先切牌，再抽牌", "左右滑動，點選你的切牌位置；切牌另留在左下角。" );
    find("draw-auto-pick").textContent = "隨機切牌";
    find("draw-auto-pick").disabled = false;
    buildChoices();
    if (adapter.focusChoices) adapter.focusChoices();
    else find("draw-cards-next").focus({ preventScroll: true });
  }

  async function start() {
    if (pending) return;
    const token = generation;
    clearError();
    pending = true;
    find("draw-start").disabled = true;
    status.textContent = "正在準備這副牌…";
    surface.setAttribute("aria-busy", "true");
    try {
      const cards = await adapter.loadDeck(context.deckKey);
      if (token !== generation || surface.hidden) return;
      if (!cards.length) throw new Error("Deck unavailable");
      lastQuestion = question.value.trim().slice(0, 200);
      lastMethod = surface.querySelector('input[name="draw-method"]:checked')?.value ?? "manual";
      const layout = getDrawSpread(spreadSelect.value);
      session = createDrawSession({ deckKey: context.deckKey, cards, method: lastMethod, question: lastQuestion, drawCount: layout.count, spreadId: layout.id, requireCut: true });
      session.phase = "shuffling";
      automatic = lastMethod === "starlight";
      collectRequested = automatic;
      heldMs = 0;
      sceneReady = false;
      pending = false;
      surface.removeAttribute("aria-busy");
      surface.classList.toggle("is-starlight", automatic);
      hold.hidden = automatic;
      collect.hidden = automatic;
      find("draw-skip").hidden = automatic;
      phase("shuffling", automatic ? "讓星光帶路" : "讓牌卡，隨你的心意流動", automatic ? "星光正在聚攏，請稍候…" : "按住洗牌，喚起星流；放開，讓光慢下來。");
      updateProgress();
      adapter.startAnimation(session);
      if (!automatic) hold.focus();
      else { find("draw-ritual-close").focus(); startHold(true); }
    } catch {
      if (token !== generation || surface.hidden) return;
      find("draw-start").disabled = false;
      showError("這副牌暫時無法準備，請重試或返回牌盒。", start);
    }
  }

  function cancel({ restore = true } = {}) {
    generation += 1;
    stopHold();
    pending = false;
    closeSurface();
    session = null;
    surface.removeAttribute("aria-busy");
    if (restore) {
      adapter.cancelAnimation();
      const target = returnFocus;
      const token = generation;
      const deadline = performance.now() + 1000;
      const restoreFocus = () => {
        if (generation !== token || !surface.hidden || !target?.isConnected || target.disabled) return;
        const style = getComputedStyle(target);
        if (style.visibility === "visible" && style.display !== "none" && !target.closest("[inert]")) {
          target.focus({ preventScroll: true });
          if (document.activeElement === target) return;
        }
        if (performance.now() < deadline) requestAnimationFrame(restoreFocus);
      };
      requestAnimationFrame(restoreFocus);
    }
  }

  function open() {
    if (!surface.hidden) return;
    generation += 1;
    session = null;
    pending = false;
    chooseReadyAt = 0;
    Object.assign(visual, { progress: 0, holding: false, focus: 0, selectedPosition: -1 });
    returnFocus = document.activeElement;
    context = adapter.getContext();
    adapter.onOpen();
    clearError();
    surface.classList.remove("is-starlight", "is-holding");
    find("draw-slot").replaceChildren();
    find("draw-slot").classList.remove("is-filled");
    find("draw-ritual-deck").textContent = context.name;
    surface.style.setProperty("--draw-card-back", `url("${context.backUrl}")`);
    question.value = lastQuestion;
    find("draw-question-count").textContent = `${question.value.length} / 200`;
    surface.querySelectorAll('input[name="draw-method"]').forEach((input) => { input.checked = input.value === lastMethod; });
    find("draw-start").disabled = false;
    phase("setup", "選一個牌陣，留一個問題", "逐張隨機正逆位 · 先切牌，再抽出你的主牌。");
    surface.hidden = false;
    surface.setAttribute("aria-hidden", "false");
    surface.inert = false;
    find("draw-start").focus({ preventScroll: true });
  }

  find("draw-start").addEventListener("click", start);
  find("draw-ritual-close").addEventListener("click", () => cancel());
  surface.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); cancel(); }
    event.stopPropagation();
  });
  retry.addEventListener("click", () => retryAction?.());
  question.addEventListener("input", () => { find("draw-question-count").textContent = `${question.value.length} / 200`; });
  hold.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    hold.focus();
    hold.setPointerCapture(event.pointerId);
    startHold();
  });
  ["pointerup", "pointercancel", "lostpointercapture", "blur"].forEach((event) => hold.addEventListener(event, () => { if (!automatic) stopHold(); }));
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
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopHold();
    else if (automatic && visual.phase === "shuffling" && heldMs < shuffleDuration) startHold(true);
  });
  collect.addEventListener("click", () => { collectRequested = true; finishShuffle(); });
  find("draw-skip").addEventListener("click", () => {
    if (!session || session.phase !== "shuffling") return;
    automatic = true;
    collectRequested = true;
    session.method = "starlight";
    stopHold();

    surface.classList.add("is-starlight");
    hold.hidden = true;
    collect.hidden = true;
    find("draw-skip").hidden = true;
    status.textContent = "已交給星光選牌，等待牌組就緒…";
    find("draw-ritual-close").focus({ preventScroll: true });
    updateProgress();
    if (heldMs >= shuffleDuration) finishShuffle();
    else startHold(true);
  });
  find("draw-auto-pick").addEventListener("click", () => choose());
  track.addEventListener("focusin", (event) => {
    const button = event.target.closest(".draw-choice");
    if (button) focusChoice(Number(button.dataset.position), false);
  });
  track.addEventListener("click", (event) => {
    if (performance.now() < suppressClickUntil) return;
    const button = event.target.closest(".draw-choice");
    if (button && !button.disabled) choose(Number(button.dataset.position));
  });
  track.addEventListener("keydown", (event) => {
    const button = event.target.closest(".draw-choice");
    if (!button || !["cutting", "selecting"].includes(session?.phase)) return;
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
    find(id).addEventListener("click", () => focusChoice(visual.focus + direction * (matchMedia("(max-width: 680px)").matches ? 3 : 7), false));
  }

  return {
    open,
    cancel,
    choose,
    focusChoice,
    visual,
    get isOpen() { return !surface.hidden; },
    get session() { return session; },
    animationComplete() {
      if (surface.hidden || session?.phase !== "shuffling") return;
      sceneReady = true;
      updateProgress();
      finishShuffle();
    },
  };
}
