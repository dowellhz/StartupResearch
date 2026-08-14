import { operationalError } from "./public-error.js";

export function createRateLimiter({ windowMs = 60_000, max = 60, now = () => Date.now() } = {}) {
  const buckets = new Map();

  function consume(key, { cost = 1 } = {}) {
    const timestamp = now();
    const floor = timestamp - windowMs;
    const events = (buckets.get(key) || []).filter((event) => event.at > floor);
    const used = events.reduce((sum, event) => sum + event.cost, 0);
    if (used + cost > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((events[0]?.at + windowMs - timestamp) / 1000));
      throw operationalError("请求过于频繁，请稍后重试", {
        statusCode: 429,
        code: "rate_limit_exceeded",
        retryAfterSeconds
      });
    }
    events.push({ at: timestamp, cost });
    buckets.set(key, events);
    if (buckets.size > 10_000) prune(timestamp - windowMs);
    return { remaining: Math.max(0, max - used - cost), resetAt: events[0].at + windowMs };
  }

  function prune(floor = now() - windowMs) {
    for (const [key, events] of buckets) {
      const recent = events.filter((event) => event.at > floor);
      if (recent.length) buckets.set(key, recent);
      else buckets.delete(key);
    }
  }

  return { consume, prune };
}

export function requestClientKey(req, { trustProxy = false } = {}) {
  const forwarded = trustProxy ? String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() : "";
  return forwarded || req.socket?.remoteAddress || "unknown";
}
