import test from "node:test";
import assert from "node:assert/strict";
import { createCompanyIdentityService } from "../src/domain/company-identity-service.js";
import { Result } from "../src/domain/result.js";

test("company identity is decided by AI evidence instead of name matching", async () => {
  let modelInput = "";
  const extractor = { extract: async () => Result.ok({ text: "新品牌名称，创始团队、注册地址和统一社会信用代码与原主体一致" }) };
  const model = {
    complete: async (messages) => {
      modelInput = JSON.stringify(messages);
      return JSON.stringify({
        sameCompany: true,
        confidence: "high",
        reason: "属于同一法定主体的品牌升级",
        newCompanyName: "全新品牌科技",
        evidence: ["统一社会信用代码一致", "创始团队一致"]
      });
    }
  };
  const service = createCompanyIdentityService({ extractor, model });
  const decision = await service.judgeSameCompany({
    currentCompanyName: "旧名称科技",
    currentReport: "旧名称科技的团队与工商主体信息",
    providedCompanyName: "全新品牌科技",
    upload: { filename: "new-bp.pdf", data: Buffer.from("pdf").toString("base64") }
  });
  assert.equal(decision.sameCompany, true);
  assert.equal(decision.newCompanyName, "全新品牌科技");
  assert.match(modelInput, /不得只比较公司名/);
  assert.match(modelInput, /统一社会信用代码/);
  assert.match(modelInput, /providedCompanyName/);
});

test("invalid identity JSON conservatively creates a separate conversation", async () => {
  let calls = 0;
  const extractor = { extract: async () => Result.ok({ text: "新公司材料" }) };
  const model = { complete: async () => { calls += 1; return "无效格式"; } };
  const service = createCompanyIdentityService({ extractor, model });
  const decision = await service.judgeSameCompany({
    currentCompanyName: "旧公司",
    currentReport: "旧报告",
    providedCompanyName: "新公司",
    upload: { filename: "new.pdf", data: Buffer.from("pdf").toString("base64") }
  });
  assert.equal(calls, 2);
  assert.equal(decision.sameCompany, false);
  assert.equal(decision.newCompanyName, "新公司");
  assert.match(decision.reason, /保守新建对话/);
});
