# StudyMate

供个人私下使用的 AI Web 服务。主要用于在工作地点方便访问已配置的强大 AI 模型，无需在工作设备上登录个人 AI 平台账号。

项目保留 `StudyMate` 这个名称，但当前定位不是对外运营的学习产品或多用户 SaaS，而是一个轻量的个人 AI 入口。支持匿名设备会话、流式聊天、文件上下文、图片输入、图片生成、Web 搜索和 Notion 导出。

## 使用边界

- 面向项目所有者本人，优先保证随时可用、操作简单和维护成本低
- 模型及第三方服务凭据由服务端环境变量统一配置，不暴露给浏览器
- 当前签名设备 Cookie 用于隔离不同浏览器的会话和附件，不等同于登录或访问控制
- 若部署地址可能被其他人获知，应在 Render、反向代理或应用层增加真正的访问认证，避免他人消耗 API 配额
- 使用时仍需遵守工作地点的网络、信息安全及数据处理规定，不应提交不允许传给外部 AI 服务的内容

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma 7 + PostgreSQL
- OpenAI Responses API
- DeepSeek Chat Completions API
- Render 部署

## 本地启动

```bash
npm install
npm run prisma:generate
npm run dev
```

默认访问：

```text
http://localhost:3000
```

## 环境变量

创建 `.env`。应用启动和匿名身份需要：

```bash
DATABASE_URL="postgresql://user:password@host:5432/neondb?schema=studymate"
COOKIE_SECRET="replace-with-a-long-random-secret"
```

按启用的功能配置服务密钥：

```bash
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
TAVILY_API_KEY="tvly-..."
NOTION_API_KEY="secret_..."
NOTION_DATABASE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

`TAVILY_API_KEY` 仅在 DeepSeek 开启 Web 搜索时需要；Notion 两项仅在启用 Notion 导出时需要。可选覆盖项：

```bash
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_TEXT_MODEL="gpt-5.6-sol"
DEEPSEEK_FLASH_MODEL="deepseek-v4-flash"
DEEPSEEK_PRO_MODEL="deepseek-v4-pro"
STUDYMATE_STORAGE_DIR="data/storage"
```

## 数据库

生成 Prisma Client：

```bash
npm run prisma:generate
```

部署迁移：

```bash
npm run prisma:migrate
```

生产数据库是 Neon PostgreSQL 的 `neondb`，使用 `studymate` schema。生产只运行 `prisma migrate deploy`（即 `npm run prisma:migrate`），不要运行 `prisma db push`、`prisma migrate reset` 或其他 schema 重置命令。

## 校验

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate
```

## 上传限制

当前服务端限制：

- 单次最多 5 个文件
- 单文件最大 10 MB
- 单次上传总量最大 20 MB
- multipart 请求最大 25 MB
- 支持文本、Markdown、JSON、CSV、TSV、TXT、PDF，以及 PNG/JPEG/WEBP 图片

模型能力：

- GPT-5.6 Sol：支持图片输入、图片生成、Web 搜索，以及 `none / low / medium / high / xhigh / max` 六档推理强度
- DeepSeek：不支持图片输入和图片生成；文本类文件和 PDF 会提取为文本后随 prompt 一起发送

自动 Web 搜索的实现因模型而异：GPT 使用原生 `web_search` 工具并由模型决定是否调用；DeepSeek 会先用 Flash 模型根据最近对话判断 `SEARCH` 或 `SKIP`，需要搜索时调用 Tavily 并把结果作为文本上下文注入。若判断请求失败，会回退到本地关键词规则。

图片文件不会长期写入 PostgreSQL。应用会把图片保存到 `STUDYMATE_STORAGE_DIR`，数据库只保存 `imageStoragePath` 引用；读取图片时通过 `/api/attachments/:id/image` 校验匿名用户所有权。

Render 免费版不支持 Persistent Disk；未配置 `STUDYMATE_STORAGE_DIR` 时会使用实例本地临时目录，重新部署、重启或休眠后上传图片可能丢失。

## API 保护

当前按签名 `studymate_device` Cookie 中的匿名设备 ID 分桶，计数存储在 PostgreSQL 的 `ApiRateLimit` 表中：

- `/api/chat`：每小时 30 次
- `/api/images`：每小时 10 次

生产环境可以继续叠加 Render/网关层限流。

## Render 部署

`render.yaml` 定义：

- Web Service：`studymate`
- Plan：Free Web Service
- Build：`npm ci && npm run prisma:migrate && npm run build`
- Start：`npm run start`

Render 上需要配置：

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `TAVILY_API_KEY`
- `NOTION_API_KEY` 和 `NOTION_DATABASE_ID`（启用 Notion 导出时）

`DATABASE_URL` 是 Render Web Service 上的直接 secret，`render.yaml` 必须保持 `sync: false`，不能改回 Render 数据库 Blueprint 注入。`COOKIE_SECRET` 由 Blueprint 生成。
