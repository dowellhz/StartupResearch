import http from "node:http";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const appPort = 1247;
const modelPort = 1248;
const root = path.resolve(new URL("../..", import.meta.url).pathname);
const dataDir = await mkdtemp(path.join(os.tmpdir(), "venture-lens-e2e-"));
const modelServer = http.createServer(handleModelRequest);
await new Promise((resolve) => modelServer.listen(modelPort, "127.0.0.1", resolve));

const app = spawn(process.execPath, ["server.mjs"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    NODE_ENV: "production",
    ALLOW_ANONYMOUS_PRODUCTION: "true",
    HOST: "127.0.0.1",
    PORT: String(appPort),
    DATA_DIR: dataDir,
    DEEPSEEK_API_KEY: "e2e-test-key",
    DEEPSEEK_BASE_URL: `http://127.0.0.1:${modelPort}/chat/completions`,
    WEB_RESEARCH_ENABLED: "false",
    SEMANTIC_QUALITY_CHECK_ENABLED: "false",
    RATE_LIMIT_REQUESTS: "500",
    RATE_LIMIT_EXPENSIVE_REQUESTS: "100",
    OWNER_DAILY_COST_UNITS: "1000",
    GLOBAL_DAILY_COST_UNITS: "5000",
    RESEARCH_TASK_CONCURRENCY: "2",
    MAX_ACTIVE_TASKS_PER_OWNER: "3"
  }
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  app.kill("SIGTERM");
  await new Promise((resolve) => modelServer.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}

process.once("SIGINT", () => void close().then(() => process.exit(0)));
process.once("SIGTERM", () => void close().then(() => process.exit(0)));
app.once("exit", (code) => {
  if (!closing) void close().then(() => process.exit(code || 1));
});
await new Promise(() => {});

async function handleModelRequest(req, res) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  const prompt = JSON.stringify(body.messages || []);
  if (!body.stream) {
    const content = JSON.stringify({
      companyProfile: { companyName: "E2E科技", companyNameConfidence: "high", companyNameEvidence: ["材料正文"], providedCompanyNameMatch: true },
      claims: [], risks: [], searchQueries: [], missingInformation: [], businessAudit: { metrics: [], checks: [], assumptions: [] },
      marketSizing: { status: "not_calculable", inputs: [], scenarios: [], gaps: [] },
      competitorMatrix: { dimensions: [], rows: [], gaps: [] },
      decision: { stance: "insufficient", thesis: [], antiThesis: [], keyAssumptions: [], vetoItems: [], milestones: [], nextSteps: [] },
      versionComparison: { available: false, summary: "首次核查", changes: [] },
      needsSearch: false, reason: "报告足够", tools: [], queries: []
    });
    return sendJson(res, { choices: [{ message: { content } }] });
  }
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
  if (prompt.includes("你正在回答关于")) {
    writeDelta(res, "部分回答已生成");
    const timer = setTimeout(() => {
      res.destroy(new Error("simulated upstream interruption"));
    }, 100);
    res.on("close", () => clearTimeout(timer));
    return;
  }
  writeDelta(res, reportMarkdown());
  res.end("data: [DONE]\n\n");
}

function writeDelta(res, content) {
  res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
}

function sendJson(res, value) {
  const body = JSON.stringify(value);
  res.writeHead(200, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) });
  res.end(body);
}

function reportMarkdown() {
  const detail = "本项仅依据上传材料进行结构化整理，尚无公开来源支持，需要取得合同、流水、底表和独立访谈进一步核验。".repeat(8);
  return `# E2E科技 BP 核查报告\n\n## 核查结论摘要\n\n${detail}\n\n## 关键声明核查表\n\n| 声明 | 状态 |\n|---|---|\n| 测试声明 | 仅BP自述 |\n\n## 风险与下一步\n\n${detail}`;
}
