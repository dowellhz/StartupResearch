import test from "node:test";
import assert from "node:assert/strict";
import { REPORT_SECTIONS } from "../src/domain/review-prompts.js";
import { assessReportQuality, stabilizeReport } from "../src/domain/report-quality-service.js";

test("stabilizeReport preserves visible output and supplies missing required sections", () => {
  const report = stabilizeReport("# 示例公司 BP 核查\n\n已有的重要分析。", { companyName: "示例公司", sourceCount: 0 });
  for (const section of REPORT_SECTIONS) assert.equal(report.includes(`## ${section}`), true);
  assert.match(report, /联网检索|公开来源不足/);
  assert.match(report, /已有的重要分析/);
});

test("quality gate keeps a structurally complete but evidence-free report below completion threshold", () => {
  const body = REPORT_SECTIONS.map((section) => `## ${section}\n\n${section === "关键声明核查表" ? "| 声明 | 判断 |\n|---|---|\n| 客户数据 | 仅BP自述 |" : "资料不足，分析推断，需继续核实。"}`).join("\n\n");
  const report = `# 报告\n\n${body}\n\n${"补充分析。".repeat(400)}\n\n公开来源不足。`;
  const quality = assessReportQuality(report, { sourceCount: 0 });
  assert.equal(quality.ok, false);
  assert.ok(quality.score < 70);
  assert.equal(quality.findings.filter((item) => item.severity === "fatal").length, 0);
});

test("quality gate scores evidence coverage and flags overconfident absence claims", () => {
  const body = REPORT_SECTIONS.map((section) => `## ${section}\n\n${section === "关键声明核查表" ? "| 声明 | BP依据 | 公开核验 | 判断 | 置信度 | 下一步 |\n|---|---|---|---|---|---|\n| 临床进展 | 第5页 | 官方登记支持 | 公开支持 | 高 | 复核更新 |" : "资料不足与分析推断已明确区分。"}`).join("\n\n");
  const report = `# 报告\n\n${body}\n\n客户验证为零。\n\n${"补充分析。".repeat(400)}`;
  const quality = assessReportQuality(report, {
    sources: [{ title: "Official", url: "https://clinicaltrials.gov/study/NCT00000001", snippet: "The registered trial is currently recruiting participants.", supports: ["claim_1"] }],
    crossCheck: { coverage: [{ claimId: "claim_1", status: "supported", hasCandidateEvidence: true }] },
    companyIdentity: { confidence: "high", acceptedName: "示例公司" }
  });
  assert.ok(quality.score >= 70);
  assert.equal(quality.findings.some((item) => item.code === "absence_as_fact"), true);
  assert.equal(quality.components.evidence, 31);
});
