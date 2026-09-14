export const READING_JOURNEY_TIMING = Object.freeze({ minimumMs: 5000, arrivalMs: 1800 });

// Count presented time, not wall time: a hidden tab or a stalled frame cannot
// consume the journey. Loading runs concurrently and never reveals identities.
export function createReadingJourneyGate({ onFrame, now = () => performance.now(),
  requestFrame = requestAnimationFrame, cancelFrame = cancelAnimationFrame,
  isHidden = () => document.hidden } = {}) {
  let frame = 0, last = now(), elapsedMs = 0, arrivalMs = 0;
  let ready = false, ended = false, resolve;
  const finished = new Promise((done) => { resolve = done; });
  const publish = () => onFrame?.({ elapsedMs, arrival: arrivalMs / READING_JOURNEY_TIMING.arrivalMs });
  function end(completed) {
    if (ended) return;
    ended = true;
    cancelFrame(frame);
    resolve(completed);
  }
  function tick(time) {
    if (ended) return;
    const dt = isHidden() ? 0 : Math.min(100, Math.max(0, time - last));
    last = time;
    // A full frame after the minimum separates pursuit from materialization.
    if (elapsedMs >= READING_JOURNEY_TIMING.minimumMs && ready) {
      arrivalMs = Math.min(READING_JOURNEY_TIMING.arrivalMs, arrivalMs + dt);
    }
    elapsedMs += dt;
    publish();
    if (arrivalMs >= READING_JOURNEY_TIMING.arrivalMs) end(true);
    else frame = requestFrame(tick);
  }
  publish();
  frame = requestFrame(tick);
  return { finished, ready() { ready = true; }, resetFrameTime() { last = now(); }, cancel() { end(false); } };
}

export function readingArrivalEnvelope(progress, slot, count, reducedMotion = false) {
  const delay = Math.max(0, slot) / Math.max(1, count - 1) * 0.28;
  const local = Math.min(1, Math.max(0, (progress - delay) / 0.72));
  const eased = local * local * (3 - 2 * local);
  return { visible: local > 0, scale: reducedMotion ? eased : eased * (0.8 + 0.2 * eased),
    glow: Math.sin(Math.PI * local) * (reducedMotion ? 0.3 : 0.9), depth: reducedMotion ? 0 : (1 - eased) * 0.38 };
}
