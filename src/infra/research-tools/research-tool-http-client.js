import { withRetry } from "../../domain/retry.js";

export function createResearchToolHttpClient({
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  maxAttempts = 2,
  userAgent = "VentureLens/0.1 (+https://github.com/dowellhz/StartupResearch)"
} = {}) {
  if (typeof fetchImpl !== "function") throw new Error("research tool fetch dependency is required");

  async function requestJson(url, { method = "GET", body, headers = {}, signal } = {}) {
    return withRetry(async () => {
      const response = await fetchImpl(url, {
        method,
        signal: combinedSignal(signal, timeoutMs),
        headers: {
          Accept: "application/json",
          "User-Agent": userAgent,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...headers
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) throw new ResearchToolHttpError(response.status, await safeResponseText(response));
      return response.json();
    }, {
      maxAttempts,
      baseDelayMs: 250,
      shouldRetry: (error) => error?.name === "TimeoutError" || error?.status === 429 || error?.status >= 500
    });
  }

  return {
    getJson: (url, options) => requestJson(url, options),
    postJson: (url, body, options) => requestJson(url, { ...options, method: "POST", body })
  };
}

export class ResearchToolHttpError extends Error {
  constructor(status, detail = "") {
    super(`research tool HTTP ${status}${detail ? `: ${detail.slice(0, 240)}` : ""}`);
    this.name = "ResearchToolHttpError";
    this.status = status;
  }
}

function combinedSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
}

async function safeResponseText(response) {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
