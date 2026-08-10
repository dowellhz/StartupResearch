export function createReviewEventSourceController({
  requestJson,
  eventSourceFactory = (url) => new EventSource(url),
  schedule = globalThis.setTimeout,
  cancel = globalThis.clearTimeout,
  pollIntervalMs = 2000,
  shouldContinue = (review) => ["queued", "running"].includes(review?.status),
  onSnapshot = () => {},
  onStage = () => {},
  onReportDelta = () => {},
  onReportComplete = () => {},
  onRefreshSnapshot = () => {},
  onRefreshStage = () => {},
  onRefreshComplete = () => {},
  onRefreshError = () => {},
  onTaskError = () => {}
} = {}) {
  let source = null;
  let timer = null;
  let currentId = "";
  let polling = false;
  let streamOpen = false;

  function connect(id) {
    close();
    currentId = String(id || "");
    if (!currentId) return;
    source = eventSourceFactory(`/api/reviews/${currentId}/events`);
    bindJsonEvent(source, "snapshot", onSnapshot);
    bindJsonEvent(source, "stage", onStage);
    bindJsonEvent(source, "report_delta", (data) => onReportDelta(data.delta));
    bindJsonEvent(source, "report_complete", onReportComplete);
    bindJsonEvent(source, "refresh_snapshot", onRefreshSnapshot);
    bindJsonEvent(source, "refresh_stage", onRefreshStage);
    bindJsonEvent(source, "refresh_complete", onRefreshComplete);
    bindJsonEvent(source, "refresh_error", onRefreshError);
    source.addEventListener("open", () => {
      streamOpen = true;
      if (timer) cancel(timer);
      timer = null;
    });
    source.addEventListener("error", (event) => {
      if (event.data) onTaskError(parseEventData(event.data));
      else {
        streamOpen = false;
        schedulePoll(0);
      }
    });
  }

  async function pollNow() {
    if (!currentId || polling) return;
    polling = true;
    const requestedId = currentId;
    try {
      const payload = await requestJson(`/api/reviews/${requestedId}`);
      if (requestedId !== currentId || !payload?.review) return;
      onSnapshot(payload.review);
      if (!streamOpen && shouldContinue(payload.review)) schedulePoll(pollIntervalMs);
    } catch {
      if (requestedId === currentId && !streamOpen) schedulePoll(pollIntervalMs);
    } finally {
      polling = false;
    }
  }

  function schedulePoll(delay) {
    if (!currentId || timer) return;
    timer = schedule(() => {
      timer = null;
      void pollNow();
    }, delay);
  }

  function close() {
    currentId = "";
    streamOpen = false;
    source?.close?.();
    source = null;
    if (timer) cancel(timer);
    timer = null;
  }

  return { connect, close, pollNow };
}

function bindJsonEvent(source, type, handler) {
  source.addEventListener(type, (event) => handler(parseEventData(event.data)));
}

function parseEventData(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
