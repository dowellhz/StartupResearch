export class Result {
  static ok(value = {}) {
    return { ok: true, value };
  }

  static fail(error, meta = {}) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error || "未知错误"),
      ...meta
    };
  }
}
