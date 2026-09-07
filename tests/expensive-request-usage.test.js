import test from "node:test";
import assert from "node:assert/strict";
import { commitUsage, expensiveRequestCost, shouldRefundUsage } from "../src/infra/expensive-request-usage.js";

test("只有昂贵的写请求计入每日成本额度", () => {
  assert.equal(expensiveRequestCost("POST", "/api/reviews"), 10);
  assert.equal(expensiveRequestCost("POST", "/api/reviews/bp_1/retry"), 10);
  assert.equal(expensiveRequestCost("POST", "/api/reviews/bp_1/reanalyze"), 10);
  assert.equal(expensiveRequestCost("POST", "/api/reviews/bp_1/company-match"), 10);
  assert.equal(expensiveRequestCost("POST", "/api/reviews/bp_1/refresh"), 5);
  assert.equal(expensiveRequestCost("POST", "/api/reviews/bp_1/messages"), 3);
  assert.equal(expensiveRequestCost("GET", "/api/reviews"), 0);
  assert.equal(expensiveRequestCost("POST", "/api/reviews/bp_1/share"), 0);
});

test("请求失败默认退还额度，包括服务端自身故障", () => {
  assert.equal(shouldRefundUsage(undefined), false);
  assert.equal(shouldRefundUsage({}), false);
  assert.equal(shouldRefundUsage({ usageReceipt: { day: "2026-09-07", ownerId: "owner-a", units: 10 } }), true);
});

test("已经花掉模型成本的请求标记为已提交后不再退款", () => {
  const req = { usageReceipt: { day: "2026-09-07", ownerId: "owner-a", units: 10 } };
  commitUsage(req);
  assert.equal(shouldRefundUsage(req), false);
  assert.doesNotThrow(() => commitUsage(undefined));
});
