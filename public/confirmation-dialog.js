export function createConfirmationDialogController({ dialog, acceptedValue = "confirm" } = {}) {
  if (!dialog) throw new TypeError("dialog is required");
  let pendingConfirmation = null;

  return {
    request() {
      if (pendingConfirmation) return pendingConfirmation;
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
