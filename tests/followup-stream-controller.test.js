import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createFollowupStreamController } from "../src/infra/followup-stream-controller.js";

function createResponse() {
  const res = new EventEmitter();
  res.writableEnded = false;
  res.destroyed = false;
  res.end = () => { res.writableEnded = true; };
  return res;
}

function createRecorder() {
  const frames = [];
  return { frames, writeSse: (res, event) => frames.push(event) };
}

test("客户端断开追问连接时立即中止模型调用，不再向死连接写错误帧", async () => {
  const res = createResponse();
  const { frames, writeSse } = createRecorder();
  const events = [];
  let observedSignal = null;
  const manager = {
    ask: (id, message, { signal }) => new Promise((resolve, reject) => {
      observedSignal = signal;
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
    })
  };
  const controller = createFollowupStreamController({
    manager,
    writeSse,
    logger: { info: async (event) => events.push(event), warn: async (event) => events.push(event) }
  });

  const streamed = controller.stream({ requestId: "req-1" }, res, { id: "bp_1", ownerId: "owner-1", message: "最大风险是什么" });
  res.destroyed = true;
  res.emit("close");
  await streamed;

  assert.equal(observedSignal.aborted, true);
  assert.deepEqual(events, ["followup.client_disconnected", "followup.stream_aborted"]);
  assert.deepEqual(frames, []);
  assert.equal(res.writableEnded, true);
});

test("模型失败时写出脱敏错误帧并结束流", async () => {
  const res = createResponse();
  const { frames, writeSse } = createRecorder();
  const errors = [];
  const manager = { ask: async () => { throw new Error("/private/deepseek 凭证泄漏细节"); } };
  const controller = createFollowupStreamController({ manager, writeSse, logger: { error: async (event) => errors.push(event) } });

  await controller.stream({ requestId: "req-2" }, res, { id: "bp_2", ownerId: "owner-1", message: "问题" });

  assert.deepEqual(errors, ["followup.stream_failed"]);
  assert.deepEqual(frames, [{
    type: "error",
    data: { message: "服务器暂时无法完成请求，请稍后重试", code: "", requestId: "req-2" }
  }]);
  assert.equal(res.writableEnded, true);
});

test("正常追问透传状态、进度与增量并以 done 收尾", async () => {
  const res = createResponse();
  const { frames, writeSse } = createRecorder();
  const manager = {
    ask: async (id, message, { onStatus, onProgress, onDelta }) => {
      onStatus("AI 正在判断现有数据是否足够回答…");
      onProgress({ key: "answer-generation", label: "生成回答", status: "running" });
      onDelta("答");
      return "答案";
    }
  };
  const controller = createFollowupStreamController({ manager, writeSse, logger: {} });

  await controller.stream({ requestId: "req-3" }, res, { id: "bp_3", ownerId: "owner-1", message: "问题" });

  assert.deepEqual(frames.map((frame) => frame.type), ["status", "progress", "delta", "done"]);
  assert.equal(frames.at(-1).data.answer, "答案");
  assert.equal(res.writableEnded, true);
});

test("正常收尾后的 close 事件不会误判为客户端断开", async () => {
  const res = createResponse();
  const { writeSse } = createRecorder();
  const events = [];
  const manager = { ask: async () => "答案" };
  const controller = createFollowupStreamController({ manager, writeSse, logger: { info: async (event) => events.push(event) } });

  await controller.stream({ requestId: "req-4" }, res, { id: "bp_4", ownerId: "owner-1", message: "问题" });
  res.emit("close");

  assert.deepEqual(events, []);
});

test("追问流控制器拒绝不完整的依赖装配", () => {
  assert.throws(() => createFollowupStreamController({ manager: {} }), /配置不完整/);
  assert.throws(() => createFollowupStreamController({ writeSse: () => {} }), /配置不完整/);
});

test("用户级错误的 code 随错误帧下发，供前端本地化", async () => {
  const res = createResponse();
  const { frames, writeSse } = createRecorder();
  const manager = {
    ask: async () => { throw Object.assign(new Error("问题不能为空"), { statusCode: 400, code: "question_required", expose: true }); }
  };
  const controller = createFollowupStreamController({ manager, writeSse, logger: {} });

  await controller.stream({ requestId: "req-5" }, res, { id: "bp_5", ownerId: "owner-1", message: " " });

  assert.deepEqual(frames, [{
    type: "error",
    data: { message: "问题不能为空", code: "question_required", requestId: "req-5" }
  }]);
});
