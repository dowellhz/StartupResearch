import test from "node:test";
import assert from "node:assert/strict";
import { scheduleAfterFirstPaint } from "../public/boot-scheduler.js";

test("startup network work waits until after the first paint", () => {
  const frames = [];
  const timers = [];
  let called = false;
  scheduleAfterFirstPaint(() => { called = true; }, {
    requestFrame: (callback) => frames.push(callback),
    setTimer: (callback) => timers.push(callback)
  });
  assert.equal(called, false);
  frames.shift()();
  assert.equal(called, false);
  frames.shift()();
  assert.equal(called, false);
  timers.shift()();
  assert.equal(called, true);
});
