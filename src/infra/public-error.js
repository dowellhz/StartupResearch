const DEFAULT_MESSAGE = "服务器暂时无法完成请求，请稍后重试";

export function publicError(error, { fallback = DEFAULT_MESSAGE, requestId = "" } = {}) {
  const status = normalizedStatus(error?.statusCode);
  const safe = status < 500 || error?.expose === true;
  return {
    status,
    body: {
      ok: false,
      error: safe ? String(error?.publicMessage || error?.message || fallback) : fallback,
      ...(error?.code ? { code: String(error.code) } : {}),
      ...(requestId ? { requestId } : {})
    }
  };
}

export function operationalError(message, { statusCode = 400, code = "", retryAfterSeconds } = {}) {
  return Object.assign(new Error(message), {
    statusCode,
    code,
    expose: statusCode < 500,
    ...(retryAfterSeconds ? { retryAfterSeconds } : {})
  });
}

export function safePipelineFailure() {
  return "任务执行暂时中断，已有阶段结果已保留，可稍后重试";
}

function normalizedStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
}
