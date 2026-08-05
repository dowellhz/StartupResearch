# Codex Project Notes

以下规则是从 `enterprise-wiki/AGENTS.md` 提炼并复制到本项目的通用硬约束。

## Quick commands

- `npm start` — 启动本地服务，默认 `http://127.0.0.1:1234`。
- `npm run check:syntax` — 检查 JS/MJS 语法。
- `npm run lint` — 检查尾随空白、冲突标记和 CRLF。
- `npm test` — 运行全部单元测试。
- `npm run check` — 完整本地检查。

## Project overview

VentureLens 是一个 DeepSeek 驱动的 BP 核查工作台。用户在 ChatGPT 风格的对话入口输入公司名、上传 PDF/PPTX/DOCX/TXT/Markdown，后台运行显式研究流水线，实时展示阶段进度，生成可追溯的中文研究报告并支持 PDF 下载和围绕报告继续追问。

## Architecture overview

- `server.mjs` — 唯一启动入口和依赖装配层。
- `src/config/` — runtime 配置唯一读取层。
- `src/domain/` — BP 核查流水线、质量门与领域服务。
- `src/infra/` — 文件解析、DeepSeek、联网检索和 PDF 渲染适配器。
- `src/storage/` — 任务、checkpoint 与报告持久化。
- `public/` — 浏览器端对话 UI。
- `tests/` — Node test runner 测试。

## 自动闭环与可见产出

- 生成、核查、修复和保存流程默认自动闭环。人工检查是异常兜底，不是固定必经步骤。
- 质量门只决定报告状态，不决定产出是否保存和显示。已有非空结果必须作为最佳草稿保留，并携带 warning、失败原因和重试入口。
- 高成本多步骤流程必须保存稳定任务 ID、输入摘要、已完成步骤、阶段产物、失败原因和下一步骤。进程重启后不得无条件重跑已经成功的阶段。
- 自动修复、搜索和模型调用必须有明确次数、时间和资源预算；达到预算后保留最佳草稿，不无限重试。

## Agent 工作方式

- 先做独立技术判断；发现用户方案与架构、质量、测试或维护性冲突时，应说明问题和更稳妥方案。
- 实施优先做可测试、可观测的架构改进，不靠堆 prompt、正则或临时补丁掩盖领域与数据流问题。

## 模块与依赖

- 单文件超过 500 行必须拆分；一个文件只承担一个职责。
- 服务通过 `deps` 接收依赖；业务模块不得直接创建外部服务。
- `process.env` 只允许在 `src/config/runtime-config.js` 和启动层读取。
- 语义核查、公司判断和商业结论交给结构化模型；正则只用于低风险格式化、确定性清洗和输入校验。

## 流程、状态与横切能力

- 多阶段研究使用显式 Pipeline/Step，不在路由中平铺长串业务调用。
- 任务状态变更集中在领域状态机；不得到处直接写状态。
- 日志、审计、缓存和 checkpoint 使用统一抽象；业务代码不散落裸 `console.log()` 或临时内存状态。
- 新的可失败流程使用统一 Result 和 retry 抽象，不吞异常。

## 测试与工程流程

- 新模块必须有对应测试。单元测试通过依赖注入使用 mock，不调用真实模型、网络或文件系统。
- Commit 使用 Conventional Commits：`<type>(<scope>): <subject>`。
- 文件命名使用领域名 + 职责名；service 暴露 `createXxxService(deps)`。
- 提交前运行 `npm run check`。
