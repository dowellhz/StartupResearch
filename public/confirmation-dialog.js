export function createConfirmationDialogController({ dialog, acceptedValue = "confirm" } = {}) {
  if (!dialog) throw new TypeError("dialog is required");
  let pendingConfirmation = null;

  return {
    request(overrides = {}) {
      if (pendingConfirmation) return pendingConfirmation;
      applyText(dialog, "[data-confirm-title]", overrides.title);
      applyText(dialog, "[data-confirm-description]", overrides.description);
      applyText(dialog, "[data-confirm-accept]", overrides.confirmLabel);
      dialog.returnValue = "";
      pendingConfirmation = new Promise((resolve) => {
        dialog.addEventListener("close", () => {
          const accepted = dialog.returnValue === acceptedValue;
          pendingConfirmation = null;
          resolve(accepted);
        }, { once: true });
      });
      dialog.showModal();
      return pendingConfirmation;
    }
  };
}

function applyText(dialog, selector, value) {
  if (value === undefined || value === null) return;
  const target = dialog.querySelector(selector);
  if (target) target.textContent = String(value);
}
