import test from "node:test";
import assert from "node:assert/strict";
import { redactSensitiveText, sanitizeVisibleFilename } from "../public/privacy-redaction.js";

test("investor identity is removed from visible filenames and generalized in report text", () => {
  assert.equal(sanitizeVisibleFilename("2026-07-08 宸愈君成生物BP-北极光.pdf"), "2026-07-08 宸愈君成生物BP.pdf");
  assert.equal(sanitizeVisibleFilename("【保密-仅供北极光创投内部使用】先进核能-BP.pdf"), "先进核能-BP.pdf");
  assert.equal(redactSensitiveText("建议北极光创投继续尽调，北极光需要确认。"), "建议投资方继续尽调，投资方需要确认。");
});
