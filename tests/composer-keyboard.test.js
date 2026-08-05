import test from "node:test";
import assert from "node:assert/strict";
import { bindComposerInput, shouldSubmitComposer } from "../public/composer-keyboard.js";

test("Enter submits while Shift+Enter keeps a newline", () => {
  assert.equal(shouldSubmitComposer({ key: "Enter", shiftKey: false }), true);
  assert.equal(shouldSubmitComposer({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitComposer({ key: "a", shiftKey: false }), false);
});

test("IME composition Enter never submits", () => {
  assert.equal(shouldSubmitComposer({ key: "Enter", shiftKey: false, isComposing: true }), false);
  assert.equal(shouldSubmitComposer({ key: "Enter", shiftKey: false, keyCode: 229 }), false);
});

test("composer keyboard prevents Enter newline and requests one form submission", () => {
  const listeners = {};
  const textarea = { addEventListener: (type, listener) => { listeners[type] = listener; } };
  let submitted = 0;
  let prevented = 0;
  bindComposerInput({ textarea, form: { requestSubmit: () => { submitted += 1; } }, submitButton: { disabled: false } });
  listeners.keydown({ key: "Enter", shiftKey: false, preventDefault: () => { prevented += 1; } });
  assert.equal(submitted, 1);
  assert.equal(prevented, 1);
});

test("composer keyboard does not submit again while a task is running", () => {
  const listeners = {};
  const textarea = { addEventListener: (type, listener) => { listeners[type] = listener; } };
  let submitted = 0;
  bindComposerInput({ textarea, form: { requestSubmit: () => { submitted += 1; } }, submitButton: { disabled: true } });
  listeners.keydown({ key: "Enter", shiftKey: false, preventDefault: () => {} });
  assert.equal(submitted, 0);
});
