# VentureLens BP 核查

一个本地运行的 BP 核查工作台：上传商业计划书，实时查看解析、关键声明抽取、公开资料检索、交叉核查、报告生成和质量检查进度；最终报告直接出现在对话窗口，并可下载 PDF 或继续追问。

系统不要求登录。首次访问时由服务端签发长期有效的匿名浏览器 Cookie；任务列表、报告、SSE 进度、追问、重试和 PDF 下载均按该浏览器隔离。同一浏览器再次打开仍保留原界面和历史；清除 Cookie、无痕模式或更换浏览器会被视为新用户。

## 启动

```bash
npm install
npm start
```

浏览器打开 `http://127.0.0.1:1234`。

模型配置放在 `.env`：

```dotenv
DEEPSEEK_API_KEY=...
DEEPSEEK_BASE_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat
```

## 支持格式

- PDF（需要文本层；扫描件会给出明确错误）
- PowerPoint `.pptx`
- Word `.docx`
- `.txt` / `.md`

单文件默认最大 20 MB。任务与 checkpoint 保存在 `data/jobs/`，报告保存在 `data/reports/`。

## 核查边界

报告区分 BP 自述、公开来源支持、冲突、资料不足和分析推断。模型知识不能替代实时公开证据；联网检索失败时会降级生成并在报告中明确披露。
