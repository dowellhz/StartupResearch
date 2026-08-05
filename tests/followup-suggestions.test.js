import test from "node:test";
import assert from "node:assert/strict";
import { renderFollowupSuggestions } from "../public/followup-suggestions.js";

test("suggestion bubbles render safely and clicking one starts the selected follow-up", () => {
  let clickHandler;
  let selected = "";
  const button = {
    dataset: { followupSuggestion: "优先核实哪些技术证据？" },
    addEventListener: (_type, handler) => { clickHandler = handler; }
  };
  const container = {
    classList: { toggle: () => {} },
    innerHTML: "",
    querySelectorAll: () => [button]
  };
  renderFollowupSuggestions(container, ["优先核实哪些技术证据？", "<script>不应执行</script>，还缺哪些材料？"], (question) => { selected = question; });
  assert.match(container.innerHTML, /data-followup-suggestion/);
  assert.doesNotMatch(container.innerHTML, /<script>/);
  clickHandler();
  assert.equal(selected, "优先核实哪些技术证据？");
});

test("older reports receive useful default follow-up bubbles", () => {
  const container = {
    classList: { toggle: () => {} },
    innerHTML: "",
    querySelectorAll: () => []
  };
  renderFollowupSuggestions(container, [], () => {});
  assert.match(container.innerHTML, /你可以继续问/);
  assert.match(container.innerHTML, /行业研究/);
  assert.match(container.innerHTML, /下一轮尽调/);
});
