# StudyMate

AI 学习助手 Web 应用。支持匿名会话、流式聊天、文件上下文、图片输入和图片生成。

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

创建 `.env`：

```bash
DATABASE_URL="postgresql://user:password@host:5432/studymate?schema=public"
COOKIE_SECRET="replace-with-a-long-random-secret"
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com/v1"
TAVILY_API_KEY="tvly-..."
STUDYMATE_STORAGE_DIR="data/storage"
```

可选：

```bash
OPENAI_IMAGE_RESPONSE_MODEL="gpt-5.5"
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_TEXT_MODEL="gpt-5.5"
DEEPSEEK_FLASH_MODEL="deepseek-v4-flash"
DEEPSEEK_PRO_MODEL="deepseek-v4-pro"
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

## 校验

```bash
npm run typecheck
npm run lint
npx prisma validate
```

## 上传限制

当前服务端限制：

- 单次最多 5 个文件
- 单文件最大 10 MB
- 单次上传总量最大 20 MB
- multipart 请求最大 25 MB
- 支持文本、Markdown、JSON、CSV、TSV、TXT、PDF、图片

模型能力：

- GPT-5.5：支持图片输入和图片生成
- DeepSeek：不支持图片输入和图片生成；文本类文件和 PDF 会提取为文本后随 prompt 一起发送

图片文件不会长期写入 PostgreSQL。应用会把图片保存到 `STUDYMATE_STORAGE_DIR`，数据库只保存 `imageStoragePath` 引用；读取图片时通过 `/api/attachments/:id/image` 校验匿名用户所有权。

Render 免费版不支持 Persistent Disk；未配置 `STUDYMATE_STORAGE_DIR` 时会使用实例本地临时目录，重新部署、重启或休眠后上传图片可能丢失。

## API 保护

当前按 IP 的限流存储在 PostgreSQL 的 `ApiRateLimit` 表中：

- `/api/chat`：每小时 30 次
- `/api/images`：每小时 10 次

生产环境可以继续叠加 Render/网关层限流。

## Render 部署

`render.yaml` 定义：

- Web Service：`studymate`
- PostgreSQL：使用现有 `render_db`
- Plan：Free Web Service + Free Render Postgres
- Build：`npm ci && npm run prisma:migrate && npm run build`
- Start：`npm run start`

Render 上需要配置：

- `OPENAI_API_KEY`
- `DEEPSEEK_API_KEY`

`DATABASE_URL` 和 `COOKIE_SECRET` 由 Blueprint 注入或生成。
