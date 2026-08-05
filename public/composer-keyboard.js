export function bindComposerInput({ textarea, form, submitButton, onInput = () => {} }) {
  textarea.addEventListener("input", onInput);
  textarea.addEventListener("keydown", (event) => {
    if (!shouldSubmitComposer(event) || submitButton.disabled) return;
    event.preventDefault();
    form.requestSubmit();
  });
}

export function shouldSubmitComposer(event) {
  return event.key === "Enter"
    && event.shiftKey !== true
    && event.isComposing !== true
    && event.keyCode !== 229;
}
