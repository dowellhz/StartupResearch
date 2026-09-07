import { publicError } from "./public-error.js";

const CLIENT_DISCONNECTED = "客户端已断开追问连接";

export function createFollowupStreamController({ manager, writeSse, logger = {} } = {}) {
  if (!manager || typeof writeSse !== "function") throw new Error("追问流控制器配置不完整");

  async function stream(req, res, { id, ownerId, message } = {}) {
    const controller = new AbortController();
    res.on("close", () => {
      if (res.writableEnded) return;
      controller.abort(new Error(CLIENT_DISCONNECTED));
      void logger.info?.("followup.client_disconnected", { requestId: req?.requestId, jobId: id });
    });
    try {
      const answer = await manager.ask(id, message, {
        ownerId,
        signal: controller.signal,
        onStatus: (text) => writeSse(res, { type: "status", data: { message: text } }),
        onProgress: (progress) => writeSse(res, { type: "progress", data: progress }),
        onDelta: (delta) => writeSse(res, { type: "delta", data: { delta } })
      });
      writeSse(res, { type: "done", data: { answer } });
    } catch (error) {
      if (controller.signal.aborted) {
        await logger.warn?.("followup.stream_aborted", { requestId: req?.requestId, jobId: id });
      } else {
        await logger.error?.("followup.stream_failed", { requestId: req?.requestId, jobId: id, error });
        const failure = publicError(error, { requestId: req?.requestId });
        writeSse(res, { type: "error", data: { message: failure.body.error, code: failure.body.code || "", requestId: req?.requestId } });
      }
    }
    res.end();
  }

  return { stream };
}
