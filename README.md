# VentureLens

VentureLens 是一个面向投资研究的 AI 工作台。它不只总结商业计划书，而是把材料中的关键陈述拆成可核查声明，结合公开网页、论文和结构化数据库进行交叉验证，最终生成带证据、风险标记和投资判断的研究报告。

当前版本：`0.3.0` · [查看 Releases](https://github.com/dowellhz/StartupResearch/releases)

在线 Demo：[https://c.nlvcwiki.com/](https://c.nlvcwiki.com/)

## 适合做什么

| 任务 | 输入 | 主要产出 |
| --- | --- | --- |
| BP 核查 | PDF、PPTX、DOCX、TXT、Markdown | 声明账本、公开证据、冲突与风险、投资分析 |
| 公司预研 | 公司名称与关注方向 | 公司公开信息、团队、产品、融资、客户与竞争研究 |
| 行业研究 | 行业或技术主题 | 行业格局、技术路线、商业前景、投资主题与风险 |
| 论文解读 | 论文 PDF 或公开 URL | 技术贡献、可信度、复现线索、产业价值与相关研究 |

所有任务都在同一个对话界面中运行，支持实时阶段进度、报告内继续追问、公开资料刷新，以及报告或完整对话 PDF 下载。界面支持中英文切换，报告语言跟随任务提交时的界面语言。

## 核心能力

### 可追溯的 BP 核查

- 从 BP 中提取团队、客户、收入、融资、市场、知识产权和监管等原子声明。
- 保存声明所在页码与逐字原文，并用确定性核验器回查解析页面。
- 页码错误但原文存在时自动纠正；无法回查时标记为未核验，而不是伪造引用。
- 区分公开来源支持、公开来源冲突、候选证据、仅 BP 自述、资料不足和分析推断。
- 结构化整理财务和经营指标，复算增长率、收入关系、runway、资金用途及市场规模等关系。

### 受预算约束的 Agentic Search

- 按工商主体、团队身份、客户验证、市场、竞争、知识产权和监管等核验包规划查询。
- 通用搜索取得一级来源后，对高价值 HTML/PDF 页面执行一次受控链接发现。
- 限制抓取深度、单域页面数、并发、响应大小、超时和重试次数。
- 私网地址在请求前拦截；403 等受限页面会转化为聚焦搜索线索，不会无限重试。
- 某个搜索工具不可用时保留其他已取得证据，并在报告中明确披露降级情况。

### 投资分析与质量门

- 生成市场测算、竞品矩阵、投资正反论点、否决条件和关键里程碑。
- 高优先级声明缺少可复核原文或可靠公开证据时，任务进入“需关注”。
- 质量门只决定状态，不阻止已有非空报告保存和显示。
- 同一公司补充新版 BP 时保留当前对话并比较结构化事实；识别为新公司时创建独立对话。
- “刷新公开资料”只生成增量变化报告，不覆盖原始 BP 核查报告。

### 长任务与文档稳定性

- 多阶段流程保存稳定任务 ID、checkpoint、阶段产物、失败原因和下一步骤。
- 服务重启后恢复近期任务，停止超过预算的陈旧任务，避免无条件重跑已完成阶段。
- PDF 解析运行在隔离子进程中，具有并发、超时和内存故障边界。
- 对扫描、低文本密度或视觉内容较多的 PDF 进行受预算约束的中英文 OCR。
- 即使最终质量不足或后置阶段失败，也保留最佳草稿、warning 和重试入口。

## 研究工具

VentureLens 会根据任务领域自动选择研究工具。

无需 API Key 的公开接口：

- ClinicalTrials.gov：临床试验
- arXiv：预印本与论文元数据
- Crossref：DOI、作者与引用元数据
- GitHub：公开代码仓库与技术足迹
- Hugging Face：公开模型和数据集
- OSV / NVD：软件漏洞
- SEC EDGAR：美国上市公司披露
- TED：欧盟采购公告

配置 `OPENALEX_API_KEY` 后，还会启用 OpenAlex 学术图谱，用于核查作者、机构、成果归属和引用信号。这里的“零 Key”只指上述公开数据接口；语义抽取、判断、报告生成和通用网页搜索仍需要 DeepSeek 凭证。

运行中的工具状态可通过 `GET /api/health` 查看。健康接口只返回是否配置，不返回任何凭证内容。

BP 核查和公司预研还内置“技术调研” Tool。系统先根据 BP 声明或公司公开事实判断是否存在会实质影响产品可行性、壁垒、监管或商业化的核心技术；只有确有必要时，才自动追加论文、技术路线、性能基准、成熟度、工程瓶颈与验证方案研究。该 Tool 是公司研究 Pipeline 的内部能力，不是独立任务栏目。

两条公司研究 Pipeline 还内置“国内外同类公司研究” Tool。系统先按产品、客户、使用场景、技术路径和商业模式定义可比口径，再以独立来源配额分别检索国内、海外直接竞品、相邻方案与替代方案；某一区域未形成企业证据时会进行一次聚焦重试。最终只把具有公开来源支持的企业写入对比矩阵，并明确标注证据缺口。

## 工作流程

```text
输入材料或研究主题
        ↓
文档解析与公司识别
        ↓
结构化声明 / 研究问题
        ↓
网页搜索 + 专项工具 + 二级页面抓取
        ↓
证据核验与商业指标复算
        ↓
投资分析、报告生成与质量门
        ↓
保存报告、checkpoint 和可继续追问的对话；首次下载时生成 PDF
```

## 快速开始

要求：Node.js `20.16+` 或 `22.3+`。

```bash
git clone https://github.com/dowellhz/StartupResearch.git
cd StartupResearch
cp .env.example .env
npm install
npm start
```

浏览器打开 `http://127.0.0.1:1234`。

最小模型配置：

```dotenv
DEEPSEEK_API_KEY=your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
```

## 配置

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 服务监听地址 |
| `PORT` | `1234` | 服务端口 |
| `MAX_UPLOAD_MB` | `20` | 单个上传文件大小上限 |
| `DEEPSEEK_API_KEY` | 空 | DeepSeek 唯一凭证字段 |
| `DEEPSEEK_BASE_URL` | DeepSeek Chat Completions | 模型接口地址 |
| `DEEPSEEK_MODEL` | `deepseek-chat` | 模型名称 |
| `DEEPSEEK_TIMEOUT_MS` | `120000` | 单次模型请求超时 |
| `WEB_RESEARCH_ENABLED` | `true` | 是否启用联网研究 |
| `OPENALEX_API_KEY` | 空 | 可选 OpenAlex 学术检索凭证 |
| `PDF_EXTRACTION_TIMEOUT_MS` | `120000` | PDF 子进程解析预算 |
| `PDF_EXTRACTION_CONCURRENCY` | `1` | PDF 并发解析数 |
| `ACTIVE_TASK_STALE_MINUTES` | `15` | 启动恢复时的陈旧任务阈值 |
| `TRUST_PROXY` | `false` | 是否信任反向代理提供的客户端 IP；仅在受控代理后开启 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 请求滑动窗口长度 |
| `RATE_LIMIT_REQUESTS` | `120` | 每客户端窗口内的通用请求上限 |
| `RATE_LIMIT_EXPENSIVE_REQUESTS` | `10` | 每 IP + owner 窗口内的昂贵操作上限 |
| `RESEARCH_TASK_CONCURRENCY` | `2` | 单实例全局研究任务并发上限 |
| `MAX_ACTIVE_TASKS_PER_OWNER` | `3` | 单一所有者同时排队或运行的任务上限 |
| `OWNER_DAILY_COST_UNITS` | `100` | 单一所有者每日昂贵操作预算 |
| `GLOBAL_DAILY_COST_UNITS` | `1000` | 全局每日昂贵操作预算 |
| `DATA_RETENTION_DAYS` | `0` | 终态数据保留天数；`0` 表示不自动清理 |
| `DATA_RETENTION_GRACE_DAYS` | `7` | 过期数据移入隔离区后的宽限天数 |
| `SEMANTIC_QUALITY_CHECK_ENABLED` | `true` | 是否启用受预算约束的模型语义过度声称检查 |
| `PUBLIC_BASE_URL` | 空 | 部署脚本使用的公网根地址 |

所有运行时环境变量统一由 `src/config/runtime-config.js` 读取。不要把真实 `.env`、模型 Key 或 OAuth 凭证提交到 Git。

## Google 登录

Google 登录使用 OAuth 2.0 / OpenID Connect，不需要 Google API Key，但需要创建 Web OAuth 客户端。

```dotenv
GOOGLE_AUTH_REQUIRED=false
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=https://research.example.com/auth/google/callback
AUTH_SESSION_SECRET=至少32字符的随机字符串
```

行为规则：

- 未配置完整 OAuth 凭证：只提供匿名浏览器隔离。
- `GOOGLE_AUTH_REQUIRED=false`：用户可选择 Google 登录，也可以匿名使用。
- `GOOGLE_AUTH_REQUIRED=true`：除健康检查和登录回调外，必须登录后使用。
- 生产环境默认拒绝匿名模式；只有显式设置 `ALLOW_ANONYMOUS_PRODUCTION=true` 才允许公开匿名使用，此时仍受 IP、owner、全局预算与任务并发护栏约束。
- 匿名用户登录后，当前浏览器中的历史任务迁移至 Google 账户。

生产域名及回调地址只应保存在服务器环境配置和 Google Cloud 控制台中，不应硬编码到仓库。

## 数据与隐私

本项目使用本地文件持久化：

```text
data/jobs/                   任务与 checkpoint
data/artifacts/              checkpoint 大对象
data/reports/                Markdown 报告
data/uploads/YYYYMMDD/       原始上传文件
data/pdfs/YYYYMMDD/          已生成 PDF
data/deleted-conversations/  已归档对话
data/logs/                   应用日志与操作审计 JSONL
```

匿名模式通过服务端签发的长期 HttpOnly Cookie 隔离任务。清除 Cookie、使用无痕模式或更换浏览器会产生新的匿名身份；Google 登录模式则按账户隔离。用户上传内容、报告和任务数据不应进入公开仓库。

旧版本中没有 `ownerId` 的任务默认进入隔离状态，普通浏览器不能查看或认领。管理员确认归属后，可执行 `npm run migrate:legacy-owners -- --owner-id <owner-id> --dry-run` 预览，再去掉 `--dry-run` 完成一次性迁移。

当前文件存储实现通过 `data/.venture-lens.lock` 强制单实例运行。SSE 订阅、任务控制器和创建去重均是进程内状态；在引入具备租约的持久化任务队列、共享事件总线和支持并发写入的数据库前，不支持多实例或滚动双写部署。

设置 `DATA_RETENTION_DAYS` 后，超过期限的终态任务、已删除对话、历史报告版本和日志会先移入 `data/retention-trash/YYYYMMDD/`，经过 `DATA_RETENTION_GRACE_DAYS` 后再自动删除。默认值 `0` 禁用自动清理，生产环境应按数据治理要求显式配置。

## 项目结构

```text
server.mjs          启动入口、依赖装配和 HTTP 路由
src/config/         运行时配置唯一读取层
src/domain/         研究流水线、状态机、质量门和领域服务
src/infra/          文档解析、模型、检索、认证和 PDF 适配器
src/storage/        任务、报告、上传文件与 PDF 持久化
public/             浏览器端对话界面
tests/              Node.js 单元测试
ops/                systemd 与通用 Nginx 示例
scripts/            工程检查和远程部署脚本
```

## 开发与检查

```bash
npm run dev          # watch 模式启动
npm run check:syntax # JS/MJS 语法检查
npm run lint         # 源码风格和冲突标记检查
npm test             # 全部单元测试
npm run test:e2e     # Chrome/Playwright 冒烟测试（SSE、并发、上传边界）
npm run check        # 完整本地检查
```

提交信息使用 Conventional Commits：`<type>(<scope>): <subject>`。

## 部署

仓库提供 `npm run deploy:remote`，用于项目维护者的受控服务器部署。脚本要求：

- 必须从本机环境显式提供 `REMOTE_HOST`、`SSH_KEY`、`REMOTE_DIR`、`REMOTE_BACKUP_DIR`、`PORT`、`REMOTE_BIND_HOST`、`SERVICE_USER` 与 `SERVICE_GROUP`；仓库不包含生产基础设施默认值。systemd 模板由部署脚本填充，Nginx 示例中的 `__...__` 需由部署环境替换。

- 当前分支是 `main`，工作树干净，且 `HEAD` 与 `origin/main` 完全一致。
- 远端使用独立 `.env`，其中包含唯一的 `DEEPSEEK_API_KEY` 和 `PUBLIC_BASE_URL`。
- 部署时保留 `.env`、`data/`、`node_modules/`、`output/` 和 `tmp/` 等运行时状态。
- 同步前创建代码备份，限制远程删除数量，重启后检查内网、公网健康接口和部署提交号。

Nginx 示例位于 `ops/startup-research.nginx.conf.example`。请在服务器侧替换示例域名和证书路径，不要把真实基础设施信息提交到仓库。

## 能力边界

VentureLens 可以核查材料内部一致性、公开事实、技术线索和商业假设合理性，但不能仅凭 BP 与公开搜索证明以下事项真实：

- 收入、回款、现金余额和财务底表
- 客户关系、合同履行和发票真实性
- 股权结构、代持、质押和对赌安排
- 核心代码、知识产权归属和生产系统状态

正式尽调仍需银行流水、合同、发票、财务底表、股权文件、代码审计、现场检查及独立访谈。报告中的 AI 结论仅供投资研究参考。

## License

[Apache License 2.0](LICENSE)
