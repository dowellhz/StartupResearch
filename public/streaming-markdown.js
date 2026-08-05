import { markdownToHtml } from "./markdown-renderer.js";

export const STREAM_RENDER_INTERVAL = 80;

export function renderStreamingMarkdown(value) {
  return markdownToHtml(value);
}
