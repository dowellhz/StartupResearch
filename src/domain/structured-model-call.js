import { withRetry } from "./retry.js";

export function completeStructuredJson({ model, messages, signal, maxTokens, validate = (value) => value, onRetry = () => {} }) {
  let previousRaw = "";
  return withRetry(async ({ attempt }) => {
    if (attempt > 1) onRetry({ attempt, previousRaw });
    const attemptMessages = attempt === 1 ? messages : [
      ...messages,
      {
        role: "user",
        content: [
          "上一份输出不是合法 JSON。请修复格式并重新输出完整 JSON；不要输出解释、Markdown 或代码围栏。",
          String(previousRaw || "（空响应）").slice(0, 6000)
        ].join("\n")
      }
    ];
    previousRaw = await model.complete(attemptMessages, { json: true, signal, maxTokens });
    return validate(parseJsonObject(previousRaw));
  }, { maxAttempts: 2, baseDelayMs: 250, shouldRetry: () => !signal?.aborted });
}

export function parseJsonObject(value) {
  const text = String(value || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("DeepSeek 响应不是有效 JSON");
    return JSON.parse(match[0]);
  }
}
