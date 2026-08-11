import assert from "node:assert/strict";
import test from "node:test";

import { renderEmptyStateMode } from "../public/empty-state-mode.js";
import { setLanguage } from "../public/i18n.js";

test("paper analysis replaces the BP hero and suggestion prompts", () => {
  const elements = createElements();
  renderEmptyStateMode(elements, "paper_analysis");
  assert.equal(elements.emptyEyebrow.textContent, "PAPER ANALYSIS COPILOT");
  assert.match(elements.emptyHeading.innerHTML, /从技术实现到商业化距离/);
  assert.match(elements.emptyCopy.textContent, /OpenAlex/);
  assert.equal(elements.buttons[0].dataset.suggestion, "重点解释方法架构、核心算法和训练或推理流程");
  assert.equal(elements.buttons[0].lastChild.textContent, "技术架构与算法");
});

test("unknown modes restore the BP hero", () => {
  const elements = createElements();
  renderEmptyStateMode(elements, "unknown");
  assert.equal(elements.emptyEyebrow.textContent, "BP DUE DILIGENCE COPILOT");
  assert.match(elements.emptyHeading.innerHTML, /商业计划书/);
});

test("technology research exposes principle, prototype and validation prompts", () => {
  const elements = createElements();
  renderEmptyStateMode(elements, "technology_research");
  assert.equal(elements.emptyEyebrow.textContent, "TECHNOLOGY RESEARCH COPILOT");
  assert.match(elements.emptyCopy.textContent, /专项数据库/);
  assert.equal(elements.buttons[2].lastChild.textContent, "成熟度与验证");
});

test("English mode renders corresponding paper analysis content", () => {
  setLanguage("en", { persist: false });
  const elements = createElements();
  renderEmptyStateMode(elements, "paper_analysis");
  assert.match(elements.emptyHeading.innerHTML, /path to commercialization/);
  assert.equal(elements.buttons[0].lastChild.textContent, "Architecture & algorithms");
  setLanguage("zh", { persist: false });
});

function createElements() {
  const buttons = Array.from({ length: 3 }, () => ({
    classList: { toggle() {} },
    dataset: {},
    lastChild: { textContent: "" },
    querySelector: () => ({ textContent: "" })
  }));
  return {
    emptyEyebrow: {},
    emptyHeading: {},
    emptyCopy: {},
    emptySuggestions: { querySelectorAll: () => buttons },
    buttons
  };
}
