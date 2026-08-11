import test from "node:test";
import assert from "node:assert/strict";
import { normalizeResearchQuestion, normalizeResearchQuestions } from "../src/domain/research-question-service.js";

test("research questions preserve strings and extract model object fields", () => {
  assert.equal(normalizeResearchQuestion("还需核验样本量"), "还需核验样本量");
  assert.equal(normalizeResearchQuestion({ question: "TI 刺激期间如何抑制 EEG 伪迹？" }), "TI 刺激期间如何抑制 EEG 伪迹？");
  assert.equal(normalizeResearchQuestion({ description: "缺少长期安全性数据" }), "缺少长期安全性数据");
});

test("research questions never expose object stringification artifacts", () => {
  assert.deepEqual(normalizeResearchQuestions([{}, { nested: true }, "[object Object]", { gap: "缺少闭环对照实验" }]), ["缺少闭环对照实验"]);
});
