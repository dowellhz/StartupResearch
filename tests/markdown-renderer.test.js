import test from "node:test";
import assert from "node:assert/strict";
import { markdownToHtml } from "../public/markdown-renderer.js";

test("report Markdown renders emphasis, ordered lists, headings, and tables", () => {
  const html = markdownToHtml("**总判断**：内容\n\n1. **投资要点**\n\n## 团队\n\n#### 主题一：AI 数学教育（近期可布局）\n\n| 姓名 | 职位 |\n|---|---|\n| 张三 | CEO |");
  assert.match(html, /<strong>总判断<\/strong>/);
  assert.match(html, /<ol><li><strong>投资要点<\/strong><\/li><\/ol>/);
  assert.match(html, /<h2>团队<\/h2>/);
  assert.match(html, /<h4>主题一：AI 数学教育（近期可布局）<\/h4>/);
  assert.doesNotMatch(html, /####/);
  assert.match(html, /<table><tr><th>姓名<\/th><th>职位<\/th><\/tr>/);
});
