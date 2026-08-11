import test from "node:test";
import assert from "node:assert/strict";
import { ATTACHMENT_REVIEW, COMPANY_PRE_RESEARCH, PAPER_ANALYSIS, TECHNOLOGY_RESEARCH, createComposerTaskModeController, taskTypeForFileInput } from "../public/composer-task-mode.js";

test("file selection and drag-drop always resolve to the existing attachment review flow", () => {
  assert.equal(taskTypeForFileInput(COMPANY_PRE_RESEARCH), ATTACHMENT_REVIEW);
  assert.equal(taskTypeForFileInput(ATTACHMENT_REVIEW), ATTACHMENT_REVIEW);
  assert.equal(taskTypeForFileInput(PAPER_ANALYSIS), PAPER_ANALYSIS);
});

test("paper analysis mode updates both the composer and empty-state hero", () => {
  const state = { currentId: "", taskType: ATTACHMENT_REVIEW };
  const elements = createModeElements();
  const controller = createComposerTaskModeController({ elements, state });
  controller.selectPaperAnalysisMode();
  assert.equal(state.taskType, PAPER_ANALYSIS);
  assert.equal(elements.conversationTitle.textContent, "新建论文解读");
  assert.equal(elements.emptyEyebrow.textContent, "PAPER ANALYSIS COPILOT");
  assert.match(elements.emptyHeading.innerHTML, /从技术实现到商业化距离/);
  assert.equal(elements.fileInput.accept, ".pdf,application/pdf");
});

test("technology research mode is a dedicated no-attachment tool", () => {
  const state = { currentId: "", taskType: ATTACHMENT_REVIEW };
  const elements = createModeElements();
  const controller = createComposerTaskModeController({ elements, state });
  controller.selectTechnologyResearchMode();
  assert.equal(state.taskType, TECHNOLOGY_RESEARCH);
  assert.equal(elements.conversationTitle.textContent, "新建技术调研");
  assert.equal(elements.emptyEyebrow.textContent, "TECHNOLOGY RESEARCH COPILOT");
  assert.match(elements.companyInput.placeholder, /技术主题/);
});

function createModeElements() {
  const classList = () => ({ add() {}, remove() {}, toggle() {} });
  const buttons = Array.from({ length: 3 }, () => ({ classList: classList(), dataset: {}, lastChild: {}, querySelector: () => ({}) }));
  return {
    researchPreview: { classList: classList() },
    industryResearchPreview: { classList: classList() },
    technologyResearchPreview: { classList: classList() },
    paperAnalysisPreview: { classList: classList() },
    fileInput: {},
    companyInput: {},
    promptInput: {},
    composerNote: {},
    conversationTitle: {},
    emptyEyebrow: {},
    emptyHeading: {},
    emptyCopy: {},
    emptySuggestions: { querySelectorAll: () => buttons }
  };
}
