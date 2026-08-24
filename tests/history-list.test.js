import test from "node:test";
import assert from "node:assert/strict";
import { historySharedBadge } from "../public/history-list.js";

test("history marks only pristine imported snapshots as shared", () => {
  assert.match(historySharedBadge({ shared: true }), /history-shared/);
  assert.match(historySharedBadge({ shared: true }), /共享/);
  assert.equal(historySharedBadge({ shared: false }), "");
});
