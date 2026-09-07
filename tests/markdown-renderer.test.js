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

test("代码围栏渲染为代码块，内容不再被当作正文解析", () => {
  const html = markdownToHtml("说明：\n\n```json\n{\n  \"a\": 1,\n  \"b\": \"**not bold**\"\n}\n```\n\n结束");
  assert.match(html, /<pre class="code-block"><code class="language-json">/);
  assert.match(html, /&quot;a&quot;: 1/);
  assert.doesNotMatch(html, /<strong>not bold<\/strong>/);
  assert.doesNotMatch(html, /```/);
  assert.match(html, /<p>结束<\/p>/);
});

test("围栏内的 HTML 被转义，缩进被保留", () => {
  const html = markdownToHtml("```\n  <script>alert(1)</script>\n```");
  assert.match(html, /<code>  &lt;script&gt;alert\(1\)&lt;\/script&gt;<\/code>/);
  assert.doesNotMatch(html, /<script>/);
});

test("流式渲染中未闭合的围栏按代码块输出而不是裸露的反引号", () => {
  const html = markdownToHtml("前言\n\n```py\nprint(1)");
  assert.match(html, /<pre class="code-block"><code class="language-py">print\(1\)<\/code><\/pre>/);
  assert.doesNotMatch(html, /```/);
});

test("表格与列表在围栏之后仍能正常渲染", () => {
  const html = markdownToHtml("```\nx\n```\n\n- 项目\n\n| A |\n|---|\n| 1 |");
  assert.match(html, /<ul><li>项目<\/li><\/ul>/);
  assert.match(html, /<table><tr><th>A<\/th><\/tr><tr><td>1<\/td><\/tr><\/table>/);
});
