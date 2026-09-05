# StudyMate

供个人私下使用的 AI Web 服务。主要用于在工作地点方便访问已配置的 AI 模型，无需在工作设备上登录个人 AI 平台账号。

项目保留 `StudyMate` 名称，但当前定位不是对外运营的多用户 SaaS，而是一个轻量的个人 AI 入口。支持匿名设备会话、流式聊天、文件上下文、图片输入、图片生成、Web 搜索和 Notion 导出。

## 当前生产环境

截至 2026-09-05，已核对 GitHub、Vercel 与 Neon 的实际状态：

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

## 架构文档

几个月没维护、需要重新理解项目时，从这里开始：

- [架构入口：5 分钟恢复上下文](docs/architecture/README.md)
- [系统总览](docs/architecture/system-overview.md)
- [数据库设计](docs/architecture/database.md)
- [聊天请求流程](docs/architecture/chat-flow.md)
- [图片上传与生成流程](docs/architecture/image-flow.md)
- [部署与运行环境](docs/architecture/deployment.md)

根目录的 [ERD.md](ERD.md) 只保留为兼容入口，数据库文档以 `docs/architecture/database.md` 为唯一维护源。

## 使用边界

- 面向项目所有者本人，优先保证随时可用、操作简单和维护成本低
- 模型及第三方服务凭据由服务端环境变量统一配置，不暴露给浏览器
- 当前签名设备 Cookie 用于隔离不同浏览器的会话和附件，不等同于真正登录认证
- 若部署地址可能被其他人获知，应在 Vercel 或应用层增加真正的访问认证，避免他人消耗 API 配额
- 不应提交不允许传给外部 AI 服务的工作资料或敏感数据

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma 7 + PostgreSQL
- Neon PostgreSQL
- OpenAI Responses API / Images API
- DeepSeek Responses API
- Notion API
- Vercel
- Vercel Analytics / Speed Insights

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

生产数据库使用 Neon 的 `neondb` 数据库与 `studymate` schema。运行时 `src/lib/prisma.ts` 会读取 `DATABASE_URL` 的 `schema` 参数，并显式传给 Prisma PostgreSQL adapter。

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
- DeepSeek-V4-Flash-Vision：支持图片输入，不支持图片生成；推理强度为 `low / high / max`，默认 `high`

OpenAI 与 DeepSeek 的 Web 搜索都由各自 Responses API 的原生搜索能力处理，StudyMate 不自行注入搜索结果。

## 图片存储：当前已知架构缺口

当前代码仍由 `src/lib/storage.ts` 把图片写入本地文件系统：

```text
STUDYMATE_STORAGE_DIR
└── images/YYYY/MM/DD/<uuid>.<ext>
```

数据库只保存 `Attachment.imageStoragePath`。

这套设计适合有持久磁盘的常驻服务器，但当前生产已经部署到 Vercel Functions，因此不能把本地文件系统当成可靠的持久图片仓库。

推荐目标是 **Private Vercel Blob**，但截至本文档更新时间尚未迁移。详细见 [图片上传与生成流程](docs/architecture/image-flow.md)。

## API 保护

当前按签名 `studymate_device` Cookie 中的匿名设备 ID 分桶，计数存储在 PostgreSQL 的 `ApiRateLimit` 表中：

- `/api/chat`：每小时 30 次
- `/api/images`：每小时 10 次

## Vercel 部署

Vercel 项目已连接 GitHub 仓库 `kakumine2001/StudyMate`。当前生产部署基于 `main` 分支代码。

代码侧 build script：

```bash
npm run build
# prisma generate && next build
```

数据库迁移脚本 `npm run prisma:migrate` 与 `npm run build` 是分开的。除非 Vercel 项目设置中显式配置了迁移步骤，否则不要假设每次部署都会自动执行 Prisma migration。

仓库中的 `render.yaml` 是历史部署配置，不代表当前生产架构。

## 校验

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate
```
