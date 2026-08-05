import test from "node:test";
import assert from "node:assert/strict";
import { ensureLeadingSummary, normalizeReviewReport } from "../src/domain/report-summary-service.js";

test("empty BP conclusion summary is populated and kept as the first section", () => {
  const report = ensureLeadingSummary([
    "# 示例科技 BP 核查报告",
    "",
    "## 公司与产品",
    "",
    "产品分析。",
    "",
    "## 核查结论摘要",
    "",
    "## 团队与组织",
    "",
    "团队分析。"
  ].join("\n"), {
    heading: "核查结论摘要",
    fallback: "- **总体判断**：证据不足，暂不形成确定性投资判断。"
  });

  assert.match(report, /^# 示例科技 BP 核查报告\n\n## 核查结论摘要\n\n- \*\*总体判断\*\*/);
  assert.equal(report.split("## 核查结论摘要").length - 1, 1);
  assert.ok(report.indexOf("## 核查结论摘要") < report.indexOf("## 公司与产品"));
  assert.match(report, /产品分析/);
});

test("legacy summary aliases are canonicalized without losing substantive content", () => {
  const report = normalizeReviewReport({
    taskType: "attachment_review",
    companyName: "材料科技",
    report: "# 报告\n\n## 内容核查结论摘要\n\n原有的完整核查判断应被保留，不应由兼容逻辑覆盖。\n\n## 公司与产品\n\n正文"
  });

  assert.match(report, /## 核查结论摘要\n\n原有的完整核查判断应被保留/);
  assert.doesNotMatch(report, /## 内容核查结论摘要/);
});

test("company pre-research receives a substantive public-information summary", () => {
  const report = normalizeReviewReport({
    taskType: "company_pre_research",
    companyName: "示例科技",
    report: "# 公司预研报告\n\n## 主体与公司概况\n\n公开资料正文。",
    sources: [{ url: "https://example.com" }],
    analysis: { findings: [{ statement: "公开事实" }], missingInformation: ["客户数据"] }
  });

  assert.match(report, /^# 公司预研报告\n\n## 预研结论摘要/);
  assert.match(report, /共纳入 1 个公开来源/);
  assert.match(report, /客户数据/);
});
