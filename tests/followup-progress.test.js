import test from "node:test";
import assert from "node:assert/strict";
import { renderStreamingFollowupMarkdown, updateFollowupStages } from "../public/followup-progress.js";
import { renderStreamingMarkdown } from "../public/streaming-markdown.js";

test("follow-up progress updates one structured stage without losing the others", () => {
  const stages = [
    { key: "research-plan", status: "pending" },
    { key: "agentic-search", status: "pending" },
    { key: "answer-generation", status: "pending" }
  ];
  const next = updateFollowupStages(stages, { key: "agentic-search", status: "running", message: "正在调用 Google Scholar 工具" });
  assert.equal(next[0].status, "pending");
  assert.equal(next[1].status, "running");
  assert.match(next[1].message, /Google Scholar/);
  assert.equal(next[2].status, "pending");
});

test("follow-up answers render Markdown while content is still streaming", () => {
  const html = renderStreamingFollowupMarkdown("## 技术判断\n\n**结论**：方向合理\n\n- 已有专利");
  assert.match(html, /<h2>技术判断<\/h2>/);
  assert.match(html, /<strong>结论<\/strong>/);
  assert.match(html, /<ul><li>已有专利<\/li><\/ul>/);
});

test("BP reports use the same Markdown renderer while streaming", () => {
  const html = renderStreamingMarkdown("## 核心技术\n\n**验证问题**：还缺基准测试");
  assert.match(html, /<h2>核心技术<\/h2>/);
  assert.match(html, /<strong>验证问题<\/strong>/);
});
