export function bindFileDrop({ dropZone, onFile, onMultiple = () => {} }) {
  let depth = 0;
  const hasFiles = (event) => Array.from(event.dataTransfer?.types || []).includes("Files");
  const cancelFileEvent = (event) => {
    if (!hasFiles(event)) return false;
    event.preventDefault();
    return true;
  };
  dropZone.addEventListener("dragenter", (event) => {
    if (!cancelFileEvent(event)) return;
    depth += 1;
    dropZone.classList.add("is-dragging");
  });
  dropZone.addEventListener("dragover", (event) => {
    if (!cancelFileEvent(event)) return;
    event.dataTransfer.dropEffect = "copy";
  });
  dropZone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) dropZone.classList.remove("is-dragging");
  });
  dropZone.addEventListener("drop", (event) => {
    if (!cancelFileEvent(event)) return;
    depth = 0;
    dropZone.classList.remove("is-dragging");
    const files = filesFromDrop(event);
    if (files.length > 1) onMultiple(files.length);
    if (files[0]) onFile(files[0]);
  });
  document.addEventListener("drop", (event) => cancelFileEvent(event));
  document.addEventListener("dragover", (event) => cancelFileEvent(event));
}

export function filesFromDrop(event) {
  return Array.from(event?.dataTransfer?.files || []).filter((file) => file && file.name);
}
