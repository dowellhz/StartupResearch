export function expensiveRequestCost(method, pathname) {
  if (method !== "POST") return 0;
  if (pathname === "/api/reviews") return 10;
  if (/\/messages$/.test(pathname)) return 3;
  if (/\/(?:retry|reanalyze|company-match)$/.test(pathname)) return 10;
  if (/\/refresh$/.test(pathname)) return 5;
  return 0;
}

export function shouldRefundUsage(req) {
  return Boolean(req?.usageReceipt) && req.usageCommitted !== true;
}

export function commitUsage(req) {
  if (req) req.usageCommitted = true;
}
