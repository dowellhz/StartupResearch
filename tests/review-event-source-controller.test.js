import test from "node:test";
import assert from "node:assert/strict";
import { createReviewEventSourceController } from "../public/review-event-source-controller.js";

test("review events fall back to a persisted snapshot when the stream is unavailable", async () => {
  const scheduled = [];
  const snapshots = [];
  const sources = [];
  const controller = createReviewEventSourceController({
    requestJson: async (url) => ({ review: { id: "bp_1", status: "completed", reportAvailable: true, url } }),
    eventSourceFactory: (url) => {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    schedule: (callback, delay) => {
      const handle = { callback, delay };
      scheduled.push(handle);
      return handle;
    },
    cancel: () => {},
    onSnapshot: (review) => snapshots.push(review)
  });
  controller.connect("bp_1");
  assert.equal(sources[0].url, "/api/reviews/bp_1/events");
  assert.equal(scheduled.length, 0, "healthy SSE must not poll in parallel");
  sources[0].emitTransportError();
  assert.equal(scheduled[0].delay, 0);
  scheduled.shift().callback();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(snapshots.at(-1).status, "completed");
  assert.equal(scheduled.length, 0, "terminal snapshots must stop polling");
  controller.close();
  assert.equal(sources[0].closed, true);
});

test("review events deliver structured stage and task error events", () => {
  const stages = [];
  const errors = [];
  let source;
  const controller = createReviewEventSourceController({
    requestJson: async () => ({ review: { status: "completed" } }),
    eventSourceFactory: (url) => { source = new FakeEventSource(url); return source; },
    schedule: () => 1,
    cancel: () => {},
    onStage: (stage) => stages.push(stage),
    onTaskError: (error) => errors.push(error)
  });
  controller.connect("bp_2");
  source.emit("stage", { key: "document-parse", status: "completed" });
  source.emit("error", { message: "模型失败" });
  assert.deepEqual(stages, [{ key: "document-parse", status: "completed" }]);
  assert.deepEqual(errors, [{ message: "模型失败" }]);
});

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.closed = false;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, value) {
    this.listeners.get(type)?.({ data: JSON.stringify(value) });
  }

  emitTransportError() {
    this.listeners.get("error")?.({});
  }

  close() {
    this.closed = true;
  }
}
