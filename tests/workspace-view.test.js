import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceView } from "../public/workspace-view.js";

test("workspace view sizes the composer and follows a near-bottom conversation", () => {
  let scrolledTo;
  const conversation = { scrollHeight: 500, scrollTop: 360, clientHeight: 100, scrollTo: (value) => { scrolledTo = value; } };
  const promptInput = { scrollHeight: 160, style: {} };
  const view = createWorkspaceView({
    conversation, promptInput, toastRegion: {}, isAutoFollow: () => true,
    requestFrame: (callback) => callback()
  });
  view.autoResize();
  assert.equal(promptInput.style.height, "110px");
  assert.equal(view.isNearBottom(), true);
  view.scrollBottom();
  assert.deepEqual(scrolledTo, { top: 500, behavior: "auto" });
});
