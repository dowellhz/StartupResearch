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

test("通用确认弹窗按次覆盖文案，未传入的部分保持原样", async () => {
  const nodes = {
    "[data-confirm-title]": { textContent: "确认操作" },
    "[data-confirm-description]": { textContent: "" },
    "[data-confirm-accept]": { textContent: "确认" }
  };
  const dialog = {
    returnValue: "",
    listeners: [],
    querySelector: (selector) => nodes[selector] || null,
    addEventListener: (type, handler) => dialog.listeners.push(handler),
    showModal() { this.opened = true; }
  };
  const controller = createConfirmationDialogController({ dialog });

  const pending = controller.request({ description: "停止当前研究？已完成的阶段会保留。" });
  assert.equal(nodes["[data-confirm-description]"].textContent, "停止当前研究？已完成的阶段会保留。");
  assert.equal(nodes["[data-confirm-title]"].textContent, "确认操作");
  assert.equal(nodes["[data-confirm-accept]"].textContent, "确认");
  dialog.returnValue = "confirm";
  dialog.listeners.pop()();
  assert.equal(await pending, true);
});

test("确认弹窗对缺失的文案节点保持容错", async () => {
  const dialog = {
    returnValue: "cancel",
    listeners: [],
    querySelector: () => null,
    addEventListener: (type, handler) => dialog.listeners.push(handler),
    showModal() {}
  };
  const controller = createConfirmationDialogController({ dialog });
  const pending = controller.request({ description: "x", title: "y", confirmLabel: "z" });
  dialog.listeners.pop()();
  assert.equal(await pending, false);
});
