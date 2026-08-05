import test from "node:test";
import assert from "node:assert/strict";
import { buildConversationExport } from "../src/domain/conversation-export-service.js";

test("conversation export includes the initial request, report, refresh and ordered follow-ups", () => {
  const value = buildConversationExport({
    taskType: "company_pre_research",
    companyName: "示例科技",
    instruction: "关注团队",
    status: "completed",
    report: "# 公司预研报告",
    stages: [{ label: "抓取公司公开信息", status: "completed", message: "完成" }],
    lastEvidenceRefresh: { report: "# 公开资料刷新", completedAt: "2026-08-05T00:00:00.000Z" },
    messages: [
      { role: "user", content: "最大的风险？", at: "2026-08-05T01:00:00.000Z" },
      { role: "assistant", content: "客户证据不足。", at: "2026-08-05T01:00:01.000Z" },
      { role: "system", content: "不应导出" }
    ]
  });
  assert.equal(value.title, "示例科技 · 完整对话");
  assert.equal(value.request.attachment, null);
  assert.equal(value.reportLabel, "公司预研报告");
  assert.match(value.report, /## 预研结论摘要/);
  assert.equal(value.evidenceRefresh.report, "# 公开资料刷新");
  assert.deepEqual(value.messages.map((item) => item.role), ["user", "assistant"]);
});

test("attachment review export exposes only safe attachment metadata", () => {
  const value = buildConversationExport({
    companyName: "材料科技",
    upload: { filename: "meeting.pdf", size: 2048, data: "secret", storagePath: "/internal" },
    messages: []
  });
  assert.deepEqual(value.request.attachment, { filename: "meeting.pdf", size: 2048 });
  assert.equal("data" in value.request.attachment, false);
});
