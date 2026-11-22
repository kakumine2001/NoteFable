# NoteFable

NoteFable 是一个把 AI 对话、笔记和资料整理放在一起的产品，正在持续打磨 Web、原生 Android 和原生 iOS 体验。

用户可以从聊天开始，把回答和资料整理成 Notes，再让 AI 读取笔记、提出修改建议，确认后应用。当前支持匿名试用、Google / 邮箱验证码登录、流式聊天、文件上下文、图片输入与生成、Web 搜索、发言附加笔记、引用回答追问、回答保存 / 整段整理成笔记与整段对话导出、回答举报、跨 Chats 与 Notes 的关键词搜索、自定义指令、项目共通指示与参考笔记、AI 角色形象、笔记子页面 / 收藏 / 页面设置 / 回收站与编辑历史，以及可选的 Pro 月额订阅与账号删除。以下记录当前实现；当前没有团队协作或公开分享功能。

产品介绍主页在 `notefable.com`，聊天与 Notes 工作区在 `app.notefable.com`（参照 Notion 的分域；同一份代码按主机分流，见 [deployment.md](docs/architecture/deployment.md)）。旧地址 `notefable.com/app` 和带 `chat`、`message`、`view` 或 `page` 参数的旧链接保留全部查询参数转到工作区。没有设置分域变量的环境（Preview、本地）仍是 `/` 介绍页、`/app` 工作区。

界面支持 17 种语言（English、简体中文、繁體中文、日本語、한국어、Español、Français、Deutsch、Português (Brasil)、Italiano、Bahasa Indonesia、Tiếng Việt、ไทย、हिन्दी、العربية、Türkçe、Русский，其中阿拉伯语支持完整的从右到左 RTL 排版）及“自动检测”选项。登录用户可在“设置”中选择界面语言（偏好保存在账号上并跨设备同步），未登录访客可在侧栏帮助菜单或介绍页页脚选择本机语言。自动检测按“浏览器 / 系统语言 → 保守的访问国家回退 → 英文”决定；明确选择的语言优先于环境判断。首页、`/app` 和 `/note-embed` 按全部 17 种语言预先生成静态页面，由 `src/proxy.ts` 选择语言并在网址不变的情况下返回对应页面。退出登录时清除本机偏好并回到自动检测。界面语言不改写聊天、笔记或 AI 的输出语言；隐私政策、服务条款正文保持英文，特定商取引法标示保持日文。实现和维护方式见[界面语言](docs/architecture/i18n.md)。

## 聊天与项目

回答里的数学公式（LaTeX）会排版显示：网页用 KaTeX，Android 原生 App 用 KaTeX 字体的原生排版库，iOS 原生 App 用 SwiftMath；行内和独立公式都支持，金额里的 `$` 不会被误当成公式。实现见 [chat-flow.md](docs/architecture/chat-flow.md#回答里的数学公式)。

回答进行中，发送键变成停止键：停下时已经生成的部分会保存下来。每条回答的“…”菜单里可以重新生成（用当前选的模型）或“在新聊天中分支”（把到这条回答为止的对话复制成一个新聊天）；自己的发言可以复制、直接改写后重新回答。改写和重新生成不会丢掉原来的内容：同一位置出现 `‹ 2/3 ›`，可以切回之前的版本和它后面的对话。在回答正文里选中文字可点“问 NoteFable”引用追问；发言时也可通过“添加页面”或空白聊天页的最近编辑笔记卡片附加最多 5 篇笔记。实现见 [chat-flow.md](docs/architecture/chat-flow.md#停止编辑重新生成与分支)。

聊天侧栏每行右侧是三点按钮：三点菜单提供置顶/取消置顶、重命名、移动到独立聊天项目、删除确认。项目可新建、改名、删除；删除项目保留聊天。项目菜单里的 Project settings 可设置共通指示和参考笔记（见下文“搜索、项目上下文与 Trash”）。共享与归档暂不提供。Chat 和 Notes 的列表没有单独的拖动柄：直接拖动整行（标题区）即可调整顺序，触屏长按后拖动；单击照常打开，焦点在行上时 Alt+↑/↓ 也可调整，刷新后保留。Chat 的行还支持拖到项目行移入项目、拖到 Chats 标题移出项目；移入项目的聊天会取消置顶，项目自动展开。在标题区滑动仍正常滚动列表。

## 部署概览

源码仓库、Vercel 项目名和域名已于 2026-11-15 核对；数据库资源信息沿用此前记录，当前运行状态需以实际部署和数据库为准，核对方法见 [deployment.md](docs/architecture/deployment.md)。

- 源码：GitHub `kakumine2001/NoteFable`，主分支 `main`
- 应用托管：Vercel 项目 `notefable`
- Framework：Next.js
- Vercel Node.js：24.x
- Vercel Production region：`iad1`
- Production aliases：
  - `notefable.com`（介绍页）
  - `app.notefable.com`（工作区）
  - `www.notefable.com`（跳转到主域名）
  - `notefable-kaku10.vercel.app`
- 数据库：Neon PostgreSQL
  - Neon project：`neon_db`
  - Region：`aws-us-east-1`
  - PostgreSQL：18
  - Branch：`production`
  - Database：`neondb`
  - Schema：`notefable`

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
    Anthropic["Anthropic API"]

    Browser --> App
    App --> Neon
    App --> Blob
    App --> OpenAI
    App --> DeepSeek
    App --> Anthropic
```

几个月没维护、需要重新理解项目时，从这里开始：

- [项目全景图（入门版，用大白话讲整体结构、签名、发布和收费）](docs/project-map.md)
- [详细架构入口：5 分钟恢复上下文](docs/architecture/README.md)
- [数据库设计](docs/architecture/database.md)
- [聊天请求流程](docs/architecture/chat-flow.md)
- [上游请求结构示例](docs/architecture/provider-requests.md)
- [站内页面与自动保存](docs/architecture/notes-flow.md)
- [图片上传与生成流程](docs/architecture/image-flow.md)
- [界面语言（17 语言与 RTL）](docs/architecture/i18n.md)
- [Android 应用与发布](docs/architecture/android.md) / [原生 Android 界面](docs/architecture/android-native.md)
- [iOS 应用与发布](docs/architecture/ios.md) / [原生 iOS 界面](docs/architecture/ios-native.md)
- [部署与运行环境](docs/architecture/deployment.md)
- [付费方案与用量上限](docs/architecture/billing.md)

## 当前边界

- 面向 AI 对话与个人知识整理，持续打磨聊天、Notes 和移动端的一体体验；当前没有团队协作或公开分享功能；Pro 订阅按 Stripe / Google Play 环境变量启用（见 [billing.md](docs/architecture/billing.md)）
- 模型及第三方服务凭据由服务端环境变量统一配置，不暴露给浏览器
- 当前签名设备 Cookie 用于隔离不同浏览器的会话和附件，不等同于登录或访问控制
- 可配置 Google / 邮箱验证码登录（Auth.js JWT 会话）以跨设备找回数据。首次登录绑定当前设备的匿名数据；已有账号登录不会自动合并另一设备的匿名数据。登出后回到新的匿名身份，账号数据仍可再次登录找回。两种方式分别按环境变量启用；邮箱与 Google 账号的关联规则见 [database.md](docs/architecture/database.md#user)
- 若部署地址可能被其他人获知，每日用量上限只能控制单人消耗；仍需要真正的访问控制时，应在 Vercel、反向代理或应用层增加认证
- 聊天、附件和被选作上下文的笔记会按请求发送给对应 AI 服务；使用时需遵守资料所属组织的数据处理规定

## 技术栈

- Next.js 16 App Router
- React 19
- Tailwind CSS v4
- Prisma 7 + PostgreSQL
- Neon PostgreSQL
- OpenAI Responses API / Images API
- DeepSeek Responses API
- Anthropic Messages API
- Vercel 部署（GitHub 联动）
- Vercel Analytics / Speed Insights

## 本地启动

使用 Node.js 24.x（与 Vercel 一致）。先创建下节的 `.env` 并准备 PostgreSQL，再启动应用。

当前开发环境使用 Docker Desktop 中的 `notefable-pg18-dev` 容器（PostgreSQL 18.4，端口 5432）。先打开 Docker Desktop，再启动已有容器：

```bash
docker start notefable-pg18-dev
docker exec notefable-pg18-dev pg_isready
```

本地使用独立的 `notefable` 数据库；生产使用 Neon 的 `neondb`。两边的表都在 `notefable` schema（代码固定，见下）。新机器需先准备独立的 PostgreSQL 数据库和账户；上述命令只启动已有容器，不会创建数据库。

本地 `.env` 的连接示例（替换为本地账户）：

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/notefable"
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
DATABASE_URL="postgresql://user:password@host:5432/neondb?schema=notefable"
COOKIE_SECRET="replace-with-a-long-random-secret"
```

Google 登录（可选；三项都配置才会启用，回调地址为 `<站点>/api/auth/callback/google`）：

```bash
AUTH_SECRET="replace-with-a-long-random-secret"
AUTH_GOOGLE_ID="....apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="..."
```

邮箱验证码登录（可选；生产环境三项都配置才启用，与 Google 登录共用 `AUTH_SECRET`）：

```bash
AUTH_SECRET="replace-with-a-long-random-secret"
RESEND_API_KEY="your-resend-sending-key"
EMAIL_FROM="NoteFable <login@your-verified-domain.example>"
```

发件域名需要在 Resend 验证。非 production 环境未配置发信密钥或发件人时，验证码只打印在开发服务器日志中；完整配置和账号关联规则见 [deployment.md](docs/architecture/deployment.md#邮箱验证码登录可选) 与 [database.md](docs/architecture/database.md#user)。

按启用的功能配置：

```bash
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_BASE_URL="https://api.anthropic.com"
```

可选覆盖项：

```bash
OPENAI_IMAGE_MODEL="gpt-image-2.6-sunburst"
OPENAI_TEXT_MODEL="gpt-6-luna"
DEEPSEEK_FLASH_MODEL="deepseek-flash"
ANTHROPIC_HAIKU_MODEL="claude-haiku-5-5"
# 开放哪些模型（JSON 数组，格式见 docs/architecture/deployment.md）；不设置则使用全部内置模型
NOTEFABLE_MODELS='[{"id":"gpt-6-luna"},{"id":"claude-haiku-5-5"}]'
NOTEFABLE_STORAGE_DIR="data/storage"
```

Vercel Blob（生产环境图片存储）必需：

```bash
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

可选的官网/工作区分域与 Pro 订阅配置（完整说明见 [deployment.md](docs/architecture/deployment.md) 与 [billing.md](docs/architecture/billing.md)）：

```bash
# 分域（同时设置时启用 notefable.com / app.notefable.com 分流）
NEXT_PUBLIC_SITE_ORIGIN="https://notefable.com"
NEXT_PUBLIC_APP_ORIGIN="https://app.notefable.com"
# Stripe 网页订阅（三项齐全时开放升级）
STRIPE_SECRET_KEY="sk_..."
STRIPE_PRICE_ID="price_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
# Google Play App 内订阅（前两项齐全时开放）
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON="{...}"
GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT="pubsub-push@..."
GOOGLE_PLAY_PUSH_AUDIENCE="https://app.notefable.com/api/billing/google/notify"
GOOGLE_PLAY_PACKAGE_NAME="com.kakumine.notefable"
GOOGLE_PLAY_PRODUCT_ID="notefable_pro"
```

内置模型及其能力（图片输入 / Web 搜索 / 推理档位）定义在 `src/lib/models.ts`。开放哪些模型、显示名和上游模型名由服务器通过 `NOTEFABLE_MODELS` 决定，网页、Android 和 iOS 都从服务器读取这份列表；不设置时使用全部内置模型。格式见 [docs/architecture/deployment.md](docs/architecture/deployment.md)。

## 数据库

生成 Prisma Client：

```bash
npm run prisma:generate
```

部署迁移：

```bash
npm run prisma:migrate
```

生产数据库使用 Neon 的 `neondb` 数据库与 `notefable` schema。schema 名由代码固定（`src/lib/database-url.ts` 的 `DATABASE_SCHEMA`）：运行时 `src/lib/prisma.ts` 和迁移（`prisma.config.ts`）都会把 `DATABASE_URL` 的 `schema` 参数换成 `notefable`，并显式传给 Prisma PostgreSQL adapter。

当前生产连接使用 Neon pooled endpoint。Node 运行时通过 `src/lib/database-url.ts` 将旧的 `sslmode=prefer/require/verify-ca` 别名明确为 `verify-full`，保持 pg 8 原有的证书和主机名验证行为；显式的 `uselibpqcompat=true` 配置与本地非 TLS 连接保持不变。

生产只运行 `prisma migrate deploy` 路线，不要运行 `prisma db push`、`prisma migrate reset` 或其他 schema 重置命令。

注意：当前同一个 Neon database 中还存在 `kaku_log` schema。NoteFable 的数据库操作应限定在 `notefable` schema，不要把另一个 schema 当成 NoteFable 的表。

## 上传限制

聊天输入框在选取文件和粘贴图片时立即检查数量、类型、单文件大小和合计大小，服务端保留相同校验。超过限制时整批新选择不添加，明确提示原因并保留原有附件和文字；发送前再次校验。输入框显示限制，有附件时显示数量和总大小。限制如下：

- 单次图片和文件合计最多 10 个附件（共用额度）
- 单文件最大 20 MiB，单次附件合计最大 100 MiB
- Claude 普通聊天图片：保留上传原图，服务器仅优化发给模型的副本（必要时转 JPEG、降质量及等比缩小，不裁剪）；超过 5 MiB 的原图也可正常上传。模型副本内部按单张最多 5 MiB、当前消息最多 10 MiB、当前与历史合计最多 20 MiB 分配，历史最多恢复最近 3 张图片。上述预算是未编码的内部传输预算，不是原图上传限制；同时保留上游 32 MB 请求保护。界面不常驻显示限制说明，选文件超限时提示。
- 浏览器经 `/api/uploads` 获取限路径、限大小、短时效的上传凭证，使用 `@vercel/blob/client` 直传私有 Blob。聊天和图片生成请求只携带用户绑定的签名附件引用（`uploads`），不再携带附件二进制，因此附件大小不受 Vercel Function 的 4.5 MB 入站请求上限约束
- 上传时显示进度；失败保留附件和文字，可再次点击发送重试。服务器先验证整个附件集合的签名、归属、数量与大小，再检查存储实际元数据并限量读取。临时上传读取后删除；下一次上传会清理该用户超过 2 小时的遗留临时 Blob（每次最多巡查 3,000 个）。历史图片另存到原有图片存储路径，文本/PDF 仍保存抽取结果
- 历史图片预览经 `/api/attachments/[id]/image` 检查归属后，重定向到只限该图片、有效期 5 分钟的私有 Blob 读取链接；重定向不缓存，避免大图经 Function 回传时触发 4.5 MB 响应限制。本地文件存储仍直接返回图片
- 未配置 Blob 的本地开发使用 `/api/uploads/local` 上传到本地存储；生产禁止这个二进制回退入口。旧 multipart 客户端保留兼容，但仍受 4.5 MB 请求体限制
- 支持文本、Markdown、JSON、CSV、TSV、TXT、PDF，以及 PNG/JPEG/WEBP 图片

模型能力：

- GPT-6 Luna：支持图片输入、Web 搜索、Notes 工具，以及 `none / low / medium / high / xhigh / max`
- Claude Haiku 5.5：支持图片输入、原生 Web 搜索和 Notes 工具；推理强度为 `low / medium / high / xhigh / max`，默认 `medium`，使用 adaptive thinking。Claude 的推理滑杆使用暖色，其他模型保留蓝色。
- DeepSeek-V4.1-Flash：支持图片输入、内置 Web 搜索（`deepseek_web_search`）和 Notes 工具；推理强度为 `low / high / max`，默认 `high`
- 图片生成不依赖所选聊天模型：任何模型下都可以打开 Create an image，`/api/images` 固定调用 OpenAI 的图片接口，所选模型只记录在保存的消息上

三个模型都可以用 `search_notes` / `read_note` 读取当前用户自己的 Notes（Trash 里的除外），用 `list_chat_attachments` 查找当前聊天的附件，并用 `propose_note_edit` / `propose_note_create` 提议修改或新建页面，包括把符合条件的聊天图片放进笔记：提案只会在聊天里显示成待确认的卡片，用户点 Apply / Create note 后才会保存。提案存进 `NoteProposal` 表，刷新页面后仍在，适用只会生效一次，详见 [chat-flow.md](docs/architecture/chat-flow.md#notes-工具三家模型共用)。

Claude 普通聊天默认使用官方最大输出 `max_tokens: 128000`，包含思考与回答；模型默认提供 1,000,000 token 上下文，无需额外开启参数。GPT-6 Luna 与 Claude 使用厂商原生自动压缩：Luna 请求 `context_management: [{type: "compaction"}]`，不覆盖厂商默认触发值；Claude 使用 `compact-2026-01-12` Beta 与 `compact_20260112`，沿用官方默认的 150,000 输入 token 触发值及摘要规则。摘要生成会产生额外模型用量；短会话不触发时没有这次摘要生成用量。

两者发送上一次压缩状态和后续文字历史，首次压缩前发送全部文字历史，不再按最近 30 条或历史附件合计 120,000 字符截断（DeepSeek 同样发送全部文字历史，不设条数上限，历史附件文本合计仍限 120,000 字符）；单文件提取与历史图片限制保留。`Message.providerContext` 保存成功回答的厂商原生压缩状态，按 provider 与实际上游 model 隔离，下一轮从该状态继续；原消息和附件保留供界面查看，状态不返回浏览器。超出上游硬性输入或请求大小限制仍可能报错，压缩不能保证任意大单次上传均可接受。Batch API 的 300,000 token 输出需异步批处理与 Beta 标头，当前实时聊天不调用该接口。

Web 搜索使用三家模型的服务端原生搜索能力（OpenAI Responses API 的 `web_search`、DeepSeek Responses API 的 `deepseek_web_search`、Anthropic Messages API 的 `web_search_20250305`）。Claude 使用基本 `web_search_20250305`，省略 `max_uses`，不设置单次上游请求的搜索次数上限；默认 `tool_choice: { type: "auto" }`，由模型决定是否搜索。遇到 `pause_turn` 时保留原生内容块继续，与 Notes 工具轮次合计最多 8 次上游请求（这是请求续接次数限制，与 `max_uses` 不同）。DeepSeek-V4.1-Flash（`deepseek-flash`）声明 `{ type: "deepseek_web_search" }`（该模型会忽略 OpenAI 同名的 `web_search`，且 `tool_choice` 不支持强制指定 `deepseek_web_search`，固定用 `"auto"`）。三家的搜索引用均转换为可点击链接并随回答保存。参见 [DeepSeek 官方搜索说明](https://api-docs.deepseek.com/guides/web_search)及 [Claude 官方搜索说明](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)。

Claude 通过服务端 `ANTHROPIC_API_KEY` 接入 `/v1/messages`，API 费用与 Claude 订阅分开。推理档位和图片输入已按 [Haiku 官方规格](https://platform.claude.com/docs/en/models/haiku-5-5/overview)及 [effort 说明](https://platform.claude.com/docs/en/build-with-claude/effort)配置。文档提及的代码执行、结构化输出等能力尚未作为本应用功能开放；PDF 继续沿用统一的文本提取。普通回答仅保存文字和引用；发生压缩后，额外保存继续请求所需的原生压缩块及其后续输出，Claude 思考块不保存。原生状态仅供同厂商同模型的服务端后续请求复用。参见 [OpenAI 压缩](https://developers.openai.com/api/docs/guides/compaction)及 [Claude 压缩](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)。

DeepSeek 的 `response.output_text.delta` 先经过工具记法检查；DSML 或工具结果标记会触发错误，不会继续作为正常回答显示或保存。未完成、空回答和缺少完成事件的流也按失败处理。历史中已保存的异常工具文本不会再次送入模型；原记录保留。

## 图片存储

生产环境的 `src/lib/storage.ts` 通过 `@vercel/blob` 把图片写入私有 Vercel Blob。

Blob pathname 结构：

```text
images/YYYY/MM/DD/<uuid>.<ext>
```

图片文件不会长期写入 PostgreSQL。Vercel 环境使用私有 Vercel Blob（`BLOB_READ_WRITE_TOKEN`），本地开发在未配置该 token 时使用 `NOTEFABLE_STORAGE_DIR`；数据库只保存 Blob/文件存储中的 `imageStoragePath` 引用。读取图片时通过 `/api/attachments/:id/image` 校验当前用户所有权（匿名设备或已登录账号）。

本地 `.env.local` 如果配置了 Blob token，图片也会写入该 token 对应的 Blob Store；本地数据库并不代表图片一定存放在本地磁盘。

Vercel 的 Serverless 文件系统没有持久磁盘：除 `/tmp` 外只读，`/tmp` 也会在实例回收或重新部署后清空。因此 Vercel 部署必须配置 Vercel Blob token；否则图片上传和生成会明确失败，不会静默写入临时磁盘。

## 站内 Notes

侧栏底部是账号区和右侧的 “?” 帮助菜单（包含官网入口、Privacy、Terms、Commercial disclosure，以及未登录访客的界面语言选项）：没登录时点 “Sign in” 打开登录弹窗，按服务端配置提供 Google 和邮箱验证码两种方式；未启用任何登录方式时隐藏入口。登录后显示头像、名字和齿轮，这一行就是唯一的设置入口：点开“设置”。电脑宽度是左边导航（通用 / 个性化 / 方案 / 账号）加右边内容的对话框，手机宽度是全屏的两级：先是入口列表（账号行和通用 / 个性化 / 方案 / 账号四行），点一行进到那一栏自己的页面，左上角的圆形按钮在列表上是关闭、在栏里是返回（规则在 `src/lib/settings-navigation.ts`，Android 和 iOS 的设置页相同）。在里面可以改显示名、上传并裁剪头像、选择 emoji、在“语言”一行打开可搜索的语言选择框（支持 17 种语言与“自动检测”）、写最多 4,000 字符的自定义指令（适用于之后的聊天和笔记 AI 助手；项目共通指示优先于这份个人设置）、查看方案与本期用量（并在可用时升级或管理 Pro 订阅），以及退出登录或删除账号（`DELETE /api/account`，公开说明页 `/delete-account`）。资料、语言和图标改了就保存；只有自定义指令要按“保存”：改动后下方出现“有未保存的更改”条（放弃 / 保存），保存或放弃之前设置不会关闭。资料、语言和指令随账号保存。设置里还有“图标”一栏：从 7 个预设 AI 角色（Foldie、Piko、Velo、默认的 Quill、Sora、Loop、Orbit）中选择，或上传自己的图片，统一替换新对话首页、AI 回答标记、侧栏标志和笔记里的 AI 按钮（预设角色按输入、思考、回答、完成、报错状态提供轻量动画，系统开启“减少动态效果”时静止；上传图片保持静态）；这一项只存在当前浏览器（`localStorage`，`src/lib/app-icon.ts`），不随账号同步；Android 和 iOS 应用的设置里也有同一栏，存在各自设备上，并传给应用里的笔记编辑器。笔记里的 AI 按钮可以拖到页面任意位置，位置同样只记在当前浏览器（`src/lib/fab-position.ts`）。

侧栏顶部的 `Chat / Notes` 在聊天和笔记之间切换（聊天与 Notes 侧栏共用同一组入口；收起侧栏后需先展开才能切换）。Notes 侧栏支持创建、选择、收藏（Favorites）、按项目分组（Projects）、嵌套子页面和删除（移入 Trash）页面，并有 Trash 入口；编辑页顶栏“…”菜单提供字体（Default / Serif / Mono）、小字号、全宽、锁定页面、收藏、复制子树、新建子页面、移动和移入回收站。页面外观按 Notion 设计：悬停标题区域出现 `Add icon / Add cover`，图标为 emoji（侧栏与顶部同步显示），封面可从预设渐变/纯色中选择，也可上传图片（最大 4 MiB）并拖动调整位置。代码块支持语法高亮、语言选择和一键复制。页面按保存的拖动顺序排列，同序时按创建时间倒序；编辑和自动保存不会改变页面位置。页面切换支持浏览器后退与前进。

每个聊天也可以设置一个 emoji 图标（与 Notes 共用同一个选择器）：图标在标题左边，未设置时显示默认的聊天气泡，点它就能选；新聊天在发出第一条消息之前就可以选，会在创建会话时一起保存。侧栏里每一行最左边的图标也可以直接点开选择器，`Remove` 恢复默认图标。顶部栏在手机上同样可以改。修改图标不改变会话在侧栏中的排序，快速连续修改时按顺序保存最后一次选择，保存失败会回到上一次已保存的图标。

编辑器使用 BlockNote 社区版，支持段落、H1–H3（含折叠标题）、项目/编号/待办/折叠列表、引用、Callout、代码、分隔线、表格，以及上传的图片和文件块；通过 `/` 菜单、Markdown 快捷输入、行内格式工具栏和拖动整理内容。笔记附件每个最多 4 MiB（4,194,304 字节），与聊天附件限制不同；具体类型和归属校验见 [notes-flow.md](docs/architecture/notes-flow.md#图片与文件)。

标题自动换行，Enter 进入正文；首个区块开头按 ↑ 返回标题。点击正文下方空白继续输入，区块加号默认在下方插入，Alt＋点击在上方插入。手柄菜单支持转换类型、颜色、复制与删除；`/turn` 可转换当前文字区块，Ctrl/Cmd＋D 复制当前或选中的区块（包含子区块）。Windows 下 Ctrl＋Shift＋0/1/2/3/4/5/6/7/8 分别转换为文本、H1/H2/H3、待办、项目列表、编号列表、折叠列表、代码；Mac 使用 Cmd＋Option＋对应数字。Ctrl/Cmd＋E 设置行内代码，Ctrl/Cmd＋Shift＋S 设置删除线。

停止输入约一秒后自动保存，顶部显示 `Saving… / Saved`。正文以原生区块 JSON 存入 PostgreSQL 的 `NotePage` 表，并通过当前用户身份（签名设备 Cookie 或登录会话）确定归属。浏览器只缓存尚未成功保存的草稿；失败后可以重试或刷新恢复。两个标签页修改同一页面时通过版本号阻止覆盖，冲突可以保存为新页面或载入最新版本。

未登录时页面与同一浏览器、同一域名绑定：清除网站 Cookie、切换浏览器/设备/域名后，数据库中的页面仍在，但无法重新认领。使用 Google 或邮箱验证码登录后，同一账号在其他设备登录即可找回；已登录账号下的页面不会自动合并来自另一台设备的匿名数据。删除页面前会确认，删除只是移入 Trash，30 天内可以复原（见下节），超过后才永久删除。标题最多 200 字符，单页请求最大 1 MiB、最多 2,000 个块及 8 层块嵌套。正文列表可以缩进，页面支持子页面层级（`parentId`）和单层项目分组（`NoteGroup`）。

Notes 编辑和自动保存本身不调用 AI；笔记内的 AI 助手只在用户发送请求后调用所选模型。助手面板的输入栏有“＋”菜单（添加文件或照片、添加页面；桌面端聊天输入栏的“＋”菜单提供添加文件或照片、创建图片和整理成笔记，手机端“＋”抽屉合并了这四项）和模型 / 推理强度选择（与聊天共用同一个选择）；不提供生成图片和联网搜索。Android 和 iOS 的 `/note-embed` 里模型由 App 传入，不显示模型选择。无需新增环境变量。新增表通过正常的 `npm run prisma:migrate` 部署。详细数据流见 [notes-flow.md](docs/architecture/notes-flow.md)。

切到 Note 时先显示笔记主页（URL 没有 `page=`），不会自动打开某篇笔记：640px 以上显示问候语、“最近编辑”卡片（按 `updatedAt` 取最近 8 篇）和全部笔记列表，侧栏的“主页”一行回到这里；手机宽度只显示列表。打开笔记会压一条带 `page=` 的历史，浏览器“返回”回到主页；删除正打开的笔记后也回到主页。Chat / Note 切换、手机笔记列表进入和返回，以及列表增删移动使用浏览器 View Transition；不支持该 API 时直接切换。手机抽屉支持左滑关闭，模型、附件和笔记 AI 底部面板可拖动持手下滑关闭，距离不足时回弹。按钮提供轻微按压反馈；系统启用“减少动态效果”时关闭过场和回弹动画。

## 回答的复制、保存与导出

每条完成的 AI 回答下面保留复制和三个点（More options）图标（存在多个版本时前面带有 `‹ 2/3 ›` 切换）；三个点菜单里提供 Regenerate、Branch in new chat、Save to page、保存后的 Open saved page、Download conversation（下载整段对话）以及 Report answer（`POST /api/reports`，用于向开发者举报回答）。此外输入栏“＋”菜单还提供 Create page（`POST /api/sessions/:id/page`，用当前模型把整段对话整理成一篇新笔记，计入 1 次聊天额度）。Copy 复制保存的 Markdown 原文；Save to page 一键新建一篇笔记（网页走 `POST /api/pages`，原生端走 `POST /api/pages/from-answer`）：标题取回答的第一个标题或第一行，正文保留列表、代码块、引用、GFM 表格（存为原生表格块）和 Web 搜索的出处链接，末尾附分隔线和指回原会话的链接；Download conversation 会读取这个聊天从头到尾的全部已保存消息，按顺序包含你的提问和 AI 回答，以会话标题命名 `.md` 文件，并保留代码、引用链接和附件名称（图片保留需登录查看的链接，不打包附件原文件），末尾附原会话链接。复制和 Save to page 仍只处理点选的那条回答。回到原会话的链接形如 `/c/<会话 ID>?message=<消息 ID>`（以前的 `/?chat=<会话 ID>&message=<消息 ID>` 也能开），打开后进入该会话并滚到那条消息；它不是分享链接，仍按设备 Cookie 或登录账号（Google / 邮箱）归属。过长的回答存成笔记时会在块的边界截断并注明（上限 2,000 个块、1 MiB）。“已保存”只在当前页面内记得，刷新后再点会新建第二篇。没有新增环境变量和数据库迁移。详见 [chat-flow.md](docs/architecture/chat-flow.md#回答的复制保存到-notes-与-markdown-导出)。

## 搜索、项目上下文与 Trash

让过去的对话和笔记能被找回、被下一次对话用上，并且整理和 AI 修改时可以放心撤销。三项功能都不新增环境变量，也不调用额外的外部模型 API；数据库只新增表和可空列，随 `npm run prisma:migrate` 部署。

**跨 Chats 与 Notes 搜索。** `GET /api/search?q=…&scope=all|chats|notes[&projectId=…]` 在当前用户的会话和笔记里做关键词搜索：`q` 为 1–100 字符，按空白切成最多 8 个词，必须全部命中，每类最多返回 15 条。匹配不区分大小写、全角/半角和平假名/片假名（`ＡＰＩ` 找得到 `API`，`でーた` 找得到 `データ`），弯引号和各种连字符也按 ASCII 的 `'`、`-` 处理；1–2 个字母数字的词（如 `ai`）只在单词开头匹配，其余仍是子串匹配。Chats 里这些词可以分散在同一个会话的标题、不同消息和附件的抽取文本里，每个会话一条结果，排序为：全部词在标题 → 一条消息同时含全部词 → 词分散在多条消息。结果带 `messageId`；摘录取自附件时还带 `attachmentName`（附件所属的消息仍是跳转目标）。`projectId`（只对 Chats 生效）把范围限定在某个聊天项目里，搜索面板的 Chats 标签有对应的 Project 下拉。笔记助手的对话和 Trash 里的笔记不参与搜索。搜索面板用 Ctrl/Cmd+K 打开，选中结果会打开对应的会话或笔记，并滚动到命中的那条消息或那个块、短暂高亮。仍只是关键词匹配：不做同义词、翻译和繁简转换，也不切分不加空格连写的中文；没有索引，是顺序扫描（本地 20,000 条消息时单个词约 50 ms，生产 Neon 未实测）。数据库编码需要是 UTF8（Neon 默认）。折叠规则、排序、实测和局限见 [chat-flow.md](docs/architecture/chat-flow.md#跨-chats--notes-搜索)。

**聊天项目的共通指示与参考笔记。** 项目菜单里的 “Project settings” 可设置最多 4,000 字符的共通指示，以及手动选择的最多 5 篇参考笔记。项目里的每次发送都会重新读取它们并放进系统指令：共通指示优先于默认的语言和格式，参考笔记的正文只当作资料而不是指令；每篇最多取 8,000 字符、合计最多 20,000 字符，超出会截断，因此每条消息会多发相应的输入内容（计入模型用量）。回答前的途中经过里会显示 “Used project …”，列出用到的指示和笔记，点笔记标签可打开它。Trash 里的笔记不会被使用。详见 [chat-flow.md](docs/architecture/chat-flow.md#项目的共通指示与参考笔记)。

**Trash 与笔记编辑历史。** 删除笔记是移入 Trash：30 天内可以复原（位置、分组和正文都保留），也可以单篇或整体永久删除；超过 30 天的笔记不能再复原。应用没有定时任务，超期笔记在打开 Trash、删除另一篇笔记或清空 Trash 时被永久删除。永久删除会同时删除这篇笔记的编辑历史、项目参考关联和笔记里的 AI 助手对话。每篇笔记还保存最多 50 份编辑历史：编辑时自动保存的快照（同一篇笔记至少间隔 10 分钟一份）、适用 AI 编辑提案之前的状态，以及每次恢复之前的状态，所以 AI 改坏或误恢复后都可以再恢复回去。恢复只改标题、图标和正文，封面、分组和位置不变。详见 [notes-flow.md](docs/architecture/notes-flow.md#trash回收站)。

## 移动应用（Android / iOS）

Android 客户端是 `mobile/android/` 的 Kotlin / Compose 原生 App：聊天、侧栏、搜索、附件、图片生成、笔记列表 / 项目 / 子页面 / 收藏 / 页面菜单、回收站使用原生界面；笔记编辑器通过 WebView 加载同一套 `/note-embed`。代码已接入 Google / 邮箱验证码登录、两级设置（个人资料、界面语言、AI 角色图标、自定义指令、方案与 Google Play Pro 订阅、删除账号）、引用追问、回答举报、发言添加笔记和整理成笔记，验证状态与网页尚未对齐的细节见 [android-native.md](docs/architecture/android-native.md)。默认连接工作区主机 `https://app.notefable.com`（接口只在这个主机提供，`notefable.com/api/*` 返回 421）。开发环境与 Play 发布见 [android.md](docs/architecture/android.md)。`mobile/ios/` 是对照 Android 移植的 Swift / SwiftUI 原生 iOS 客户端，代码已能在 CI 上编译并通过 Core 单元测试，尚未在真机上验证，结构与上线前还缺的部分见 [ios-native.md](docs/architecture/ios-native.md)，PR 检查与 TestFlight 自动上传见 [ios.md](docs/architecture/ios.md)。

## API 保护

聊天（包括笔记内 AI 助手和 Create page）和图片生成有使用上限：聊天未登录每天 20 条、登录后（Google 或邮箱）每天 40 条、付费的 Pro 每个账期 2,000 条；图片同时有月（账期）总量和每日张数两层上限（未登录 10 张 / 月且 3 张 / 天，登录 20 / 5，Pro 60 / 10）。“天”按日本时间 0 点重置。同一网络的未登录用户另有共享上限，防止清 Cookie 刷额度。回答举报另设每日限额（`REPORT_LIMITS`：每人 10 次，未登录同网络 20 次）。超限返回 429，失败且没有交付内容的请求不计数。游客触发上限时，输入框上方显示带动效的登录提示（打开与侧栏相同的登录弹窗）；已登录免费用户在启用订阅时显示升级提示（`UpgradePrompt`）；关闭提示后仍保留超限原因，系统开启“减少动态效果”时停用动画。数值在 `src/lib/usage-plans.ts`，计数表见 [database.md](docs/architecture/database.md#usagecounter)。Notes 保存、搜索等不限次数；更细的限流（按秒/分钟防刷）可以在 Vercel 防火墙或网关层配置。

## Vercel 部署

- 项目：`notefable`
- 线上 URL：`https://notefable.com`（介绍页）、`https://app.notefable.com`（工作区）
- 方式：GitHub 联动（main 分支 push 后自动部署）
- `@vercel/analytics` 与 `@vercel/speed-insights` 已在 `src/app/layout.tsx` 启用

Vercel 上需要配置的环境变量：

- `DATABASE_URL`
- `OPENAI_API_KEY`、`OPENAI_BASE_URL`（可选覆盖：`OPENAI_TEXT_MODEL`、`OPENAI_IMAGE_MODEL`）
- `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`（可选覆盖：`DEEPSEEK_FLASH_MODEL`）
- `ANTHROPIC_API_KEY`（启用 Claude 时必填；可选：`ANTHROPIC_BASE_URL`、`ANTHROPIC_HAIKU_MODEL`）
- `NOTEFABLE_MODELS`（可选，自定义开放模型列表）
- `COOKIE_SECRET`
- `NEXT_PUBLIC_SITE_ORIGIN`、`NEXT_PUBLIC_APP_ORIGIN`（生产分域时配置）
- `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`（启用 Google 登录时；分域后在 Google Cloud 的 OAuth 客户端登记 `https://app.notefable.com/api/auth/callback/google`）
- `AUTH_SECRET`、`RESEND_API_KEY`、`EMAIL_FROM`（启用邮箱验证码登录及回答举报发信时，发件域名需在 Resend 验证）
- `STRIPE_SECRET_KEY`、`STRIPE_PRICE_ID`、`STRIPE_WEBHOOK_SECRET`（启用网页 Pro 订阅时）
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`、`GOOGLE_PLAY_PUSH_SERVICE_ACCOUNT`（启用 Android Play 订阅时；可选 `GOOGLE_PLAY_PUSH_AUDIENCE`、`GOOGLE_PLAY_PACKAGE_NAME`、`GOOGLE_PLAY_PRODUCT_ID`）
- `BLOB_READ_WRITE_TOKEN`（Vercel Blob：图片存储，必填）

Vercel 的 Build Command 会先执行 `npm run prisma:migrate`，再执行应用构建；因此部署前必须配置 `DATABASE_URL`，并确保 Preview 环境不会指向不应迁移的生产数据库。生产 schema 变更只执行 `npm run prisma:migrate`（内部仅运行 `prisma migrate deploy`），不要运行 `prisma db push`、`prisma migrate reset` 等破坏性命令。该命令会用有限重试包装器处理 Neon 冷启动时的短暂连接失败，不会重试 SQL、认证或 Schema 错误。

## 校验

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate
```
