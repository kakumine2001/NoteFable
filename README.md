# StudyMate

供个人私下使用的 AI Web 服务。主要用于在工作地点方便访问已配置的 AI 模型，无需在工作设备上登录个人 AI 平台账号。

项目保留 `StudyMate` 名称，但当前定位不是对外运营的多用户 SaaS，而是一个轻量的个人 AI 入口。支持匿名设备会话、流式聊天、文件上下文、图片输入、图片生成、Web 搜索和 Notion 导出。

## 当前生产环境

GitHub / Vercel 部署与数据库连接于 2026-09-16 核对；Neon 项目资源信息于 2026-09-05 核对：

- 源码：GitHub `kakumine2001/StudyMate`，主分支 `main`
- 应用托管：Vercel 项目 `studymate`
- Framework：Next.js
- Vercel Node.js：24.x
- Vercel Production region：`iad1`
- Production aliases：
  - `studymate-lab-ai.vercel.app`
  - `studymate-kaku10.vercel.app`
- 数据库：Neon PostgreSQL
  - Neon project：`neon_db`
  - Region：`aws-us-east-1`
  - PostgreSQL：18
  - Branch：`production`
  - Database：`neondb`
  - Schema：`studymate`

Vercel 的 `iad1` 与 Neon 的 `aws-us-east-1` 都在美国东部，当前部署在网络位置上是合理组合。

## 架构总览

README 作为系统总览入口；更细的流程拆在 `docs/architecture/`。

```mermaid
flowchart LR
    Browser["Browser"]
    App["Next.js on Vercel"]
    Neon["Neon PostgreSQL"]
    Blob["Private Vercel Blob"]
    OpenAI["OpenAI APIs"]
    DeepSeek["DeepSeek API"]
    Notion["Notion API"]

    Browser --> App
    App --> Neon
    App --> Blob
    App --> OpenAI
    App --> DeepSeek
    App --> Notion
```

几个月没维护、需要重新理解项目时，从这里开始：

- [详细架构入口：5 分钟恢复上下文](docs/architecture/README.md)
- [数据库设计](docs/architecture/database.md)
- [聊天请求流程](docs/architecture/chat-flow.md)
- [图片上传与生成流程](docs/architecture/image-flow.md)
- [部署与运行环境](docs/architecture/deployment.md)

## 使用边界

- 面向项目所有者本人，优先保证随时可用、操作简单和维护成本低
- 模型及第三方服务凭据由服务端环境变量统一配置，不暴露给浏览器
- 当前签名设备 Cookie 用于隔离不同浏览器的会话和附件，不等同于登录或访问控制
- 若部署地址可能被其他人获知，应在 Vercel、反向代理或应用层增加真正的访问认证，避免他人消耗 API 配额
- 使用时仍需遵守工作地点的网络、信息安全及数据处理规定，不应提交不允许传给外部 AI 服务的内容

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma 7 + PostgreSQL
- Neon PostgreSQL
- OpenAI Responses API / Images API
- DeepSeek Responses API
- Vercel 部署（GitHub 联动）
- Notion API
- Vercel Analytics / Speed Insights

## 本地启动

使用 Node.js 24.x（与 Vercel 一致）。先创建下节的 `.env` 并准备 PostgreSQL，再启动应用。

当前开发环境使用 Docker Desktop 中的 `studymate-pg18-dev` 容器（PostgreSQL 18.4，端口 5432）。先打开 Docker Desktop，再启动已有容器：

```bash
docker start studymate-pg18-dev
docker exec studymate-pg18-dev pg_isready
```

当前本地连接使用独立的 `studymate` 数据库与 `public` schema；生产使用 Neon 的 `neondb` 与 `studymate` schema。这个差异是配置边界，不需要移动已有本地表。新机器需先准备独立的 PostgreSQL 数据库和账户；上述命令只启动已有容器，不会创建数据库。

本地 `.env` 的连接示例（替换为本地账户）：

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/studymate?schema=public"
```

确认 `DATABASE_URL` 指向本地数据库后执行：

```bash
npm ci
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

默认访问：

```text
http://localhost:3000
```

如果页面可以打开但 `/api/sessions` 返回 `503 Database is unavailable.`，先检查 Docker Desktop、数据库容器和连接地址。页面加载或构建成功不代表数据库已连接。

应用还会读取 `.env.local`，其同名变量优先于 `.env`；Prisma CLI 通过 `dotenv/config` 读取 `.env`。把 `DATABASE_URL` 保留在 `.env` 或统一注入的进程环境中，不要在 `.env.local` 覆盖成另一个数据库，以免应用与迁移连接不同的库。

## 环境变量

创建 `.env`。应用启动和匿名身份需要：

```bash
DATABASE_URL="postgresql://user:password@host:5432/neondb?schema=studymate"
COOKIE_SECRET="replace-with-a-long-random-secret"
```

按启用的功能配置：

```bash
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
NOTION_API_KEY="secret_..."
NOTION_DATABASE_ID="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

可选覆盖项：

```bash
OPENAI_IMAGE_MODEL="gpt-image-2"
OPENAI_TEXT_MODEL="gpt-5.6-sol"
DEEPSEEK_FLASH_MODEL="deepseek-flash"
STUDYMATE_STORAGE_DIR="data/storage"
```

生产环境图片存储（Vercel Blob）必需：

```bash
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

模型显示名固定写在 `src/lib/models.ts`，不通过环境变量覆盖。

模型 ID、能力（图片输入 / 图片生成 / Web 搜索）和推理档位是客户端与 API 之间的共同契约，仍然只定义在 `src/lib/models.ts`。环境变量只用于覆盖上游模型名和接入点。

## 数据库

生成 Prisma Client：

```bash
npm run prisma:generate
```

部署迁移：

```bash
npm run prisma:migrate
```

生产数据库使用 Neon 的 `neondb` 数据库与 `studymate` schema。运行时 `src/lib/prisma.ts` 会读取 `DATABASE_URL` 的 `schema` 参数，并显式传给 Prisma PostgreSQL adapter。

当前生产连接使用 Neon pooled endpoint。Node 运行时通过 `src/lib/database-url.ts` 将旧的 `sslmode=prefer/require/verify-ca` 别名明确为 `verify-full`，保持 pg 8 原有的证书和主机名验证行为；显式的 `uselibpqcompat=true` 配置与本地非 TLS 连接保持不变。

生产只运行 `prisma migrate deploy` 路线，不要运行 `prisma db push`、`prisma migrate reset` 或其他 schema 重置命令。

注意：当前同一个 Neon database 中还存在 `kaku_log` schema。StudyMate 的数据库操作应限定在 `studymate` schema，不要把另一个 schema 当成 StudyMate 的表。

## 上传限制

当前服务端限制：

- 单次最多 5 个文件
- 单文件最大 10 MB
- 单次上传总量最大 20 MB
- multipart 请求最大 25 MB
- 支持文本、Markdown、JSON、CSV、TSV、TXT、PDF，以及 PNG/JPEG/WEBP 图片

模型能力：

- GPT-5.6 Sol：支持图片输入、图片生成、Web 搜索，以及 `none / low / medium / high / xhigh / max`
- DeepSeek-V4.1-Flash：支持图片输入，不支持图片生成；推理强度为 `low / high / max`，默认 `high`

OpenAI 与 DeepSeek 的 Web 搜索都由各自 Responses API 的原生搜索能力处理，StudyMate 不自行注入搜索结果。

DeepSeek 的搜索事件由服务端处理；StudyMate 只把 `response.output_text.delta` 正文增量转发给前端。返回的引用或 URL 按普通 Markdown 正文显示。

## 图片存储

生产环境的 `src/lib/storage.ts` 通过 `@vercel/blob` 把图片写入私有 Vercel Blob。

Blob pathname 结构：

```text
images/YYYY/MM/DD/<uuid>.<ext>
```

图片文件不会长期写入 PostgreSQL。Vercel 环境使用私有 Vercel Blob（`BLOB_READ_WRITE_TOKEN`），本地开发在未配置该 token 时使用 `STUDYMATE_STORAGE_DIR`；数据库只保存 Blob/文件存储中的 `imageStoragePath` 引用。读取图片时通过 `/api/attachments/:id/image` 校验匿名用户所有权。

本地 `.env.local` 如果配置了 Blob token，图片也会写入该 token 对应的 Blob Store；本地数据库并不代表图片一定存放在本地磁盘。

Vercel 的 Serverless 文件系统没有持久磁盘：除 `/tmp` 外只读，`/tmp` 也会在实例回收或重新部署后清空。因此 Vercel 部署必须配置 Vercel Blob token；否则图片上传和生成会明确失败，不会静默写入临时磁盘。

## API 保护

当前按签名 `studymate_device` Cookie 中的匿名设备 ID 分桶，计数存储在 PostgreSQL 的 `ApiRateLimit` 表中：

- `/api/chat`：每小时 30 次
- `/api/images`：每小时 10 次

生产环境可以继续叠加 Vercel/网关层限流。

## Vercel 部署

- 项目：`studymate`
- 线上 URL：`https://studymate-lab-ai.vercel.app`
- 方式：GitHub 联动（main 分支 push 后自动部署）
- `@vercel/analytics` 与 `@vercel/speed-insights` 已在 `src/app/layout.tsx` 启用

Vercel 上需要配置的环境变量：

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `OPENAI_BASE_URL`
- `DEEPSEEK_API_KEY`
- `DEEPSEEK_BASE_URL`
- `NOTION_API_KEY` 和 `NOTION_DATABASE_ID`（启用 Notion 导出时）
- `COOKIE_SECRET`
- `BLOB_READ_WRITE_TOKEN`（Vercel Blob 图片存储，必填）

Vercel 的 Build Command 会先执行 `npm run prisma:migrate`，再执行应用构建；因此部署前必须配置 `DATABASE_URL`，并确保 Preview 环境不会指向不应迁移的生产数据库。生产 schema 变更只执行 `npm run prisma:migrate`（内部仅运行 `prisma migrate deploy`），不要运行 `prisma db push`、`prisma migrate reset` 等破坏性命令。该命令会用有限重试包装器处理 Neon 冷启动时的短暂连接失败，不会重试 SQL、认证或 Schema 错误。

## 校验

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate
```
