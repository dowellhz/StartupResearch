import test from "node:test";
import assert from "node:assert/strict";
import { createReviewShareController, shareIdFromPath } from "../public/review-share-controller.js";

test("shared path imports once and opens the recipient copy", async () => {
  const shareId = `share_${"q".repeat(32)}`;
  const requests = [];
  const opened = [];
  const notifications = [];
  let replaced = "";
  const button = fakeButton();
  const controller = createReviewShareController({
    button,
    requestJson: async (url, options) => { requests.push({ url, options }); return { imported: true, review: { id: "copy_review" } }; },
    getReview: () => null,
    openReview: async (id) => opened.push(id),
    refreshHistory: async () => {},
    notify: (message) => notifications.push(message),
    location: { pathname: `/share/${shareId}`, origin: "https://venture.test" },
    history: { replaceState: (_state, _title, path) => { replaced = path; } }
  });

  assert.equal(await controller.importFromLocation(), true);
  assert.deepEqual(requests, [{ url: `/api/shares/${shareId}/import`, options: { method: "POST" } }]);
  assert.deepEqual(opened, ["copy_review"]);
  assert.equal(replaced, "/");
  assert.match(notifications[0], /独立副本/);
});

test("share controller exposes the button only for completed reports", () => {
  const button = fakeButton();
  const controller = createReviewShareController({ button, requestJson: async () => ({}), getReview: () => null, openReview: async () => {}, refreshHistory: async () => {}, notify: () => {} });
  controller.sync(null);
  assert.equal(button.classList.has("hidden"), true);
  controller.sync({ id: "bp_done", status: "completed", reportAvailable: true });
  assert.equal(button.classList.has("hidden"), false);
  assert.equal(button.disabled, false);
  controller.sync({ id: "bp_running", status: "running", reportAvailable: false });
  assert.equal(button.disabled, true);
  assert.equal(shareIdFromPath(`/share/share_${"x".repeat(32)}`), `share_${"x".repeat(32)}`);
});

test("share button copies the absolute recipient URL", async () => {
  const button = fakeButton();
  const copied = [];
  const review = { id: "bp_completed", status: "completed", reportAvailable: true };
  const controller = createReviewShareController({
    button,
    requestJson: async () => ({ share: { path: `/share/share_${"c".repeat(32)}` } }),
    getReview: () => review,
    openReview: async () => {},
    refreshHistory: async () => {},
    notify: () => {},
    location: { pathname: "/", origin: "https://venture.test" },
    clipboard: { writeText: async (value) => copied.push(value) }
  });
  controller.bind();
  controller.sync(review);

  await button.click();

  assert.deepEqual(copied, [`https://venture.test/share/share_${"c".repeat(32)}`]);
});

function fakeButton() {
  const classes = new Set();
  const listeners = new Map();
  return {
    disabled: false,
    addEventListener(name, listener) { listeners.set(name, listener); },
    click() { return listeners.get("click")?.(); },
    classList: {
      toggle(name, force) { if (force) classes.add(name); else classes.delete(name); },
      has(name) { return classes.has(name); }
    }
  };
}
