# VentureLens BP 核查

一个本地运行的 BP 核查工作台：上传商业计划书，实时查看解析、关键声明抽取、公开资料检索、交叉核查、报告生成和质量检查进度；最终报告直接出现在对话窗口，并可下载 PDF 或继续追问。

核查流水线会把 BP 拆成带页码依据的原子声明，为高优先级声明建立逐项研究计划，并将公开支持、冲突、候选证据和仅 BP 自述沉淀为声明账本。结构化提取同时整理财务、客户、市场和融资指标，复算增长率、收入关系、runway、资金用途及市场规模等可验证关系；无法复算的项目会明确标记为资料不足，不会被写成数字错误。

每条 BP 声明会保存结构化页码和逐字原文，并由确定性核验器回查解析后的页面；页码写错但原文存在时自动纠正，找不到原文时标记为未核验。高优先级声明缺少可复核原文不会阻止报告保存，但任务会进入“需关注”。网页正文只有经过系统实际抓取并保存内容指纹后才标记为已核验，普通搜索摘要仅作为候选证据。

公开检索会按工商主体、团队身份、客户与商业验证、市场基准、竞争、知识产权及监管等核验包优先查询官方来源。在统一预算内，后置投资分析阶段会生成自下而上的市场测算、竞品矩阵、投资正反论点、否决条件和关键里程碑。为同一对话上传新版 BP 时，系统还会比较两版结构化事实；普通重跑不会产生伪版本差异。

除模型自带的通用网页搜索外，系统会按 BP 领域自动调用一组无需 API Key、无需付费账户的结构化研究工具：ClinicalTrials.gov 临床试验、arXiv 预印本、Crossref 论文 DOI、GitHub 公开仓库、Hugging Face 公开模型、OSV/NVD 漏洞、SEC EDGAR 上市公司披露，以及 TED 欧盟采购公告。工具调用有查询数、结果数、超时和重试预算；单一接口限流或不可用时会显示降级提示，并继续保留其他接口已经取得的证据。`GET /api/health` 的 `zeroKeyResearchTools` 会列出当前启用的工具。

通用网页搜索取得一级来源后，会对最多 6 个高价值页面执行一次受控链接发现，并下钻最多 10 个与公司、团队、技术、客户、融资或公告相关的 HTML/PDF 页面。抓取深度固定为 1，限制单域页面数、响应大小、并发和超时；私网地址会在请求前拦截，403 等受限页面会转为聚焦搜索线索而不会反复直抓。

“零 Key”只指这些公开数据接口，不代表整套应用无需模型 Key：BP 抽取、语义判断、报告生成和通用网页搜索仍使用 DeepSeek。GitHub、NVD、SEC 等匿名接口的额度和可达性通常低于认证访问；其中 SEC 可能按出口网络策略拒绝请求，此时会自动降级，不会阻断报告生成。

配置 `OPENALEX_API_KEY` 后，学术型 BP 会额外调用 OpenAlex 学术图谱，交叉核验论文作者、研究机构、成果归属和引用信号。未配置时系统会明确跳过该工具，并继续使用 Crossref 和其他公开来源；健康接口仅返回是否配置，不返回凭证内容。

报告完成后可手动“刷新公开资料”。每次刷新最多使用 8 个查询，只增量更新证据库和声明状态，并生成独立的公开资料变化报告；原 BP 报告不会被覆盖。系统明确区分真实事实变化、本次新找到的旧证据、证据冲突和无法判断，本次搜索未返回某来源不会被解释为事实消失。

系统支持匿名浏览器隔离和 Google 登录两种身份方式。未配置 Google OAuth 时保持原有匿名模式；配置凭证且 `GOOGLE_AUTH_REQUIRED=false` 时，用户可以选择登录 Google 账号，也可以继续匿名使用；设为 `true` 时，除健康检查和登录回调外，必须登录后才能使用。匿名用户首次访问时由服务端签发长期有效的浏览器 Cookie；登录后会把当前浏览器中的既有任务迁移到 Google 账号，从而可以跨浏览器访问。

## 启动

```bash
npm install
npm start
```

浏览器打开 `http://127.0.0.1:1234`。

生产部署仅允许干净且与 `origin/main` 完全一致的提交：`npm run deploy:remote`。脚本会保留远端 `.env`、任务数据和报告，部署前创建代码备份，并在重启后核对内网与公网健康接口。

模型配置放在 `.env`：

```dotenv
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
```

Google 登录使用 OAuth 2.0 / OpenID Connect，不需要 Google API Key，但需要在 Google Cloud Console 创建 Web OAuth 客户端。生产环境的授权重定向 URI 应配置为 `https://c.nlvcwiki.com/auth/google/callback`：

```dotenv
GOOGLE_AUTH_REQUIRED=false
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://c.nlvcwiki.com/auth/google/callback
AUTH_SESSION_SECRET=至少32字符的随机字符串
```

只有四项凭证全部配置后，页面才显示可选的 Google 登录入口。`GOOGLE_AUTH_REQUIRED` 默认为 `false`；如需开启强制登录，应先确认 OAuth 登录回调正常，再将其改为 `true`。

## 支持格式

- PDF（需要文本层；扫描件会给出明确错误）
- PowerPoint `.pptx`
- Word `.docx`
- `.txt` / `.md`

单文件默认最大 20 MB。任务与 checkpoint 保存在 `data/jobs/`，报告保存在 `data/reports/`。

## 核查边界

报告区分 BP 自述、公开来源支持、冲突、资料不足和分析推断。模型知识不能替代实时公开证据；联网检索失败时会降级生成并在报告中明确披露。

仅凭 BP 与公开搜索可以完成材料内部一致性、公开事实和经营假设合理性核查，但不能证明收入、回款、合同、现金、股权或客户关系真实。真实性核验仍需银行流水、合同、发票、财务底表、股权文件及独立访谈等底层材料。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 开源许可证。
