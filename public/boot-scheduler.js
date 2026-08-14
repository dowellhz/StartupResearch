export function scheduleAfterFirstPaint(callback, {
  requestFrame = globalThis.requestAnimationFrame,
  setTimer = globalThis.setTimeout
} = {}) {
  requestFrame(() => requestFrame(() => setTimer(callback, 0)));
}
