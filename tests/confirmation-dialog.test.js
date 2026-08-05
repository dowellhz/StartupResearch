import test from "node:test";
import assert from "node:assert/strict";
import { createConfirmationDialogController } from "../public/confirmation-dialog.js";

class FakeDialog extends EventTarget {
  constructor() {
    super();
    this.openCount = 0;
    this.returnValue = "";
  }

  showModal() {
    this.openCount += 1;
  }

  finish(value) {
    this.returnValue = value;
    this.dispatchEvent(new Event("close"));
  }
}

test("confirmation dialog resolves true only for its accepted value", async () => {
  const dialog = new FakeDialog();
  const controller = createConfirmationDialogController({ dialog });
  const accepted = controller.request();
  dialog.finish("confirm");
  assert.equal(await accepted, true);

  const cancelled = controller.request();
  dialog.finish("cancel");
  assert.equal(await cancelled, false);
  assert.equal(dialog.openCount, 2);
});

test("repeated requests share one open dialog", async () => {
  const dialog = new FakeDialog();
  const controller = createConfirmationDialogController({ dialog });
  const first = controller.request();
  const second = controller.request();
  assert.equal(first, second);
  assert.equal(dialog.openCount, 1);
  dialog.finish("");
  assert.equal(await second, false);
});
