# StudyMate

供个人私下使用的 AI Web 服务。主要用于在工作地点方便访问已配置的 AI 模型，无需在工作设备上登录个人 AI 平台账号。

项目保留 `StudyMate` 名称，但当前定位不是对外运营的多用户 SaaS，而是一个轻量的个人 AI 入口。支持匿名设备会话、流式聊天、文件上下文、图片输入、图片生成、Web 搜索、站内 Notes 笔记、跨 Chats 与 Notes 的关键词搜索、聊天项目的共通指示与参考笔记，以及笔记的 Trash（回收站）和编辑历史。

## 当前生产环境

聊天侧栏右侧依次是三点按钮和固定图钉按钮：图钉直接置顶/取消置顶，三点菜单提供重命名、移动到独立聊天项目、删除确认。项目可新建、改名、删除；删除项目保留聊天。项目菜单里的 Project settings 可设置共通指示和参考笔记（见下文“搜索、项目上下文与 Trash”）。共享与归档暂不提供。Chat 和 Notes 左侧都有六点拖动柄，可拖动调整顺序，键盘方向键也可在拖动柄上调整，刷新后保留。Chat 的拖动柄还支持拖到项目行移入项目、拖到 Chats 标题移出项目；移入项目的聊天会取消置顶，项目自动展开。聊天标题点击打开会话，标题区域保留正常滚动。

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
    Anthropic["Anthropic API"]

    Browser --> App
    App --> Neon
    App --> Blob
    App --> OpenAI
    App --> DeepSeek
    App --> Anthropic
```

几个月没维护、需要重新理解项目时，从这里开始：

- [详细架构入口：5 分钟恢复上下文](docs/architecture/README.md)
- [数据库设计](docs/architecture/database.md)
- [聊天请求流程](docs/architecture/chat-flow.md)
- [站内页面与自动保存](docs/architecture/notes-flow.md)
- [Android 应用](docs/architecture/android.md)
- [图片上传与生成流程](docs/architecture/image-flow.md)
- [部署与运行环境](docs/architecture/deployment.md)

## 使用边界

- 面向项目所有者本人，优先保证随时可用、操作简单和维护成本低
- 模型及第三方服务凭据由服务端环境变量统一配置，不暴露给浏览器
- 当前签名设备 Cookie 用于隔离不同浏览器的会话和附件，不等同于登录或访问控制
- 可选的 Google 登录（Auth.js）只用于跨设备找回同一份数据：首次登录时把当前设备的匿名数据绑定到该 Google 账号；登出（或停用登录）后浏览器回到全新的匿名状态，不会继续显示该账号的数据，再次登录即可找回；未配置相关环境变量时自动停用，仍是纯匿名模式
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
- Anthropic Messages API
- Vercel 部署（GitHub 联动）
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

Google 登录（可选；三项都配置才会启用，回调地址为 `<站点>/api/auth/callback/google`）：

```bash
AUTH_SECRET="replace-with-a-long-random-secret"
AUTH_GOOGLE_ID="....apps.googleusercontent.com"
AUTH_GOOGLE_SECRET="..."
```

按启用的功能配置：

```bash
OPENAI_API_KEY="sk-..."
OPENAI_BASE_URL="https://api.openai.com/v1"
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_BASE_URL="https://api.deepseek.com"
ANTHROPIC_API_KEY="sk-ant-..."
ANTHROPIC_BASE_URL="https://api.anthropic.com/v1"
```

可选覆盖项：

```bash
OPENAI_IMAGE_MODEL="gpt-image-2.5-sunburst"
OPENAI_TEXT_MODEL="gpt-6-luna"
DEEPSEEK_FLASH_MODEL="deepseek-flash"
ANTHROPIC_HAIKU_MODEL="claude-haiku-5-5"
STUDYMATE_STORAGE_DIR="data/storage"
```

Vercel Blob（生产环境图片存储）必需：

```bash
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

模型显示名固定写在 `src/lib/models.ts`，不通过环境变量覆盖。

模型 ID、能力（图片输入 / Web 搜索）和推理档位是客户端与 API 之间的共同契约，仍然只定义在 `src/lib/models.ts`。环境变量只用于覆盖上游模型名和接入点。

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
- DeepSeek-V4.1-Flash：支持图片输入和 Notes 工具，不支持内置 Web 搜索；推理强度为 `low / high / max`，默认 `high`
- 图片生成不依赖所选聊天模型：任何模型下都可以打开 Create an image，`/api/images` 固定调用 OpenAI 的图片接口，所选模型只记录在保存的消息上

三个模型都可以用 `search_notes` / `read_note` 读取当前用户自己的 Notes（Trash 里的除外），并用 `propose_note_edit` / `propose_note_create` 提议修改或新建页面：提案只会在聊天里显示成待确认的卡片，用户点 Apply / Create note 后才会保存。提案存进 `NoteProposal` 表，刷新页面后仍在，适用只会生效一次，详见 [chat-flow.md](docs/architecture/chat-flow.md#notes-工具三家模型共用)。

Claude 普通聊天默认使用官方最大输出 `max_tokens: 128000`，包含思考与回答；模型默认提供 1,000,000 token 上下文，无需额外开启参数。GPT-6 Luna 与 Claude 使用厂商原生自动压缩：Luna 请求 `context_management: [{type: "compaction"}]`，不覆盖厂商默认触发值；Claude 使用 `compact-2026-01-12` Beta 与 `compact_20260112`，沿用官方默认的 150,000 输入 token 触发值及摘要规则。摘要生成会产生额外模型用量；短会话不触发时没有这次摘要生成用量。

两者发送上一次压缩状态和后续文字历史，首次压缩前发送全部文字历史，不再按最近 30 条或历史附件合计 120,000 字符截断（DeepSeek 同样发送全部文字历史，不设条数上限，历史附件文本合计仍限 120,000 字符）；单文件提取与历史图片限制保留。`Message.providerContext` 保存成功回答的厂商原生压缩状态，按 provider 与实际上游 model 隔离，下一轮从该状态继续；原消息和附件保留供界面查看，状态不返回浏览器。超出上游硬性输入或请求大小限制仍可能报错，压缩不能保证任意大单次上传均可接受。Batch API 的 300,000 token 输出需异步批处理与 Beta 标头，当前实时聊天不调用该接口。

Web 搜索使用 OpenAI Responses API 或 Anthropic Messages API 的原生搜索能力。Claude 使用基本 `web_search_20250305`，省略 `max_uses`，不设置单次上游请求的搜索次数上限；默认 `tool_choice: { type: "auto" }`，由模型决定是否搜索。遇到 `pause_turn` 时保留原生内容块继续，与 Notes 工具轮次合计最多 8 次上游请求（这是请求续接次数限制，与 `max_uses` 不同）。引用转换为可点击链接并随回答保存。DeepSeek 当前的 Responses API 会忽略内置 `web_search`，因此能力定义将其关闭，且不发送搜索工具或搜索指令。需要联网查询时使用 GPT 或 Claude。参见 [DeepSeek 官方兼容说明](https://api-docs.deepseek.com/guides/responses_api/#tools)及 [Claude 官方搜索说明](https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-search-tool)。

Claude 通过服务端 `ANTHROPIC_API_KEY` 接入 `/v1/messages`，API 费用与 Claude 订阅分开。推理档位和图片输入已按 [Haiku 官方规格](https://platform.claude.com/docs/en/models/haiku-5-5/overview)及 [effort 说明](https://platform.claude.com/docs/en/build-with-claude/effort)配置。文档提及的代码执行、结构化输出等能力尚未作为本应用功能开放；PDF 继续沿用统一的文本提取。普通回答仅保存文字和引用；发生压缩后，额外保存继续请求所需的原生压缩块及其后续输出，Claude 思考块不保存。原生状态仅供同厂商同模型的服务端后续请求复用。参见 [OpenAI 压缩](https://developers.openai.com/api/docs/guides/compaction)及 [Claude 压缩](https://platform.claude.com/docs/en/build-with-claude/compaction-threshold)。

DeepSeek 的 `response.output_text.delta` 先经过工具记法检查；DSML 或工具结果标记会触发错误，不会继续作为正常回答显示或保存。未完成、空回答和缺少完成事件的流也按失败处理。历史中已保存的异常工具文本不会再次送入模型；原记录保留。

## 图片存储

生产环境的 `src/lib/storage.ts` 通过 `@vercel/blob` 把图片写入私有 Vercel Blob。

Blob pathname 结构：

```text
images/YYYY/MM/DD/<uuid>.<ext>
```

图片文件不会长期写入 PostgreSQL。Vercel 环境使用私有 Vercel Blob（`BLOB_READ_WRITE_TOKEN`），本地开发在未配置该 token 时使用 `STUDYMATE_STORAGE_DIR`；数据库只保存 Blob/文件存储中的 `imageStoragePath` 引用。读取图片时通过 `/api/attachments/:id/image` 校验匿名用户所有权。

本地 `.env.local` 如果配置了 Blob token，图片也会写入该 token 对应的 Blob Store；本地数据库并不代表图片一定存放在本地磁盘。

Vercel 的 Serverless 文件系统没有持久磁盘：除 `/tmp` 外只读，`/tmp` 也会在实例回收或重新部署后清空。因此 Vercel 部署必须配置 Vercel Blob token；否则图片上传和生成会明确失败，不会静默写入临时磁盘。

## 站内 Notes

侧栏最下面是账号区：没登录时是 Google 官方样式的 “Sign in with Google” 按钮；登录后显示你的头像和名字，点开是个人资料——默认用 Google 的头像和名字，可以自己上传头像（选图后在圆形框里拖动、缩放来裁剪，和常见网站一样）或选一个 emoji 当图标，可以改显示名，也可以一键恢复成 Google 的，还有退出登录；自己设的名字、头像跟着账号走，换设备登录也在（匿名使用时没有个人资料）。账号区下面是 `Privacy · Terms` 链接。

侧栏顶部的 `Chat / Notes` 在聊天和笔记之间切换（聊天与 Notes 侧栏共用同一组入口；收起侧栏后需先展开才能切换）。Notes 侧栏支持创建、选择和删除（移入 Trash）页面，并有 Trash 入口。页面外观按 Notion 设计：悬停标题区域出现 `Add icon / Add cover`，图标为emoji（侧栏与顶部同步显示），封面可从预设渐变/纯色中选择，也可上传图片（最大 4 MB）并拖动调整位置。代码块支持语法高亮、语言选择和一键复制。页面平铺排列，按创建时间排序，编辑和自动保存不会改变页面位置。页面切换支持浏览器后退与前进。

每个聊天也可以设置一个 emoji 图标（与 Notes 共用同一个选择器）：图标在标题左边，未设置时显示默认的聊天气泡，点它就能选；新聊天在发出第一条消息之前就可以选，会在创建会话时一起保存。侧栏里每一行最左边的图标也可以直接点开选择器，`Remove` 恢复默认图标。顶部栏在手机上同样可以改。修改图标不改变会话在侧栏中的排序，快速连续修改时按顺序保存最后一次选择，保存失败会回到上一次已保存的图标。

编辑器使用 BlockNote 社区版，支持段落、H1–H3、项目/编号/待办列表、引用、代码和分隔线；通过 `/` 菜单、Markdown 快捷输入、行内格式工具栏和拖动整理内容。首版只开放文字区块。

标题自动换行，Enter 进入正文；首个区块开头按 ↑ 返回标题。点击正文下方空白继续输入，区块加号默认在下方插入，Alt＋点击在上方插入。手柄菜单支持转换类型、颜色、复制与删除；`/turn` 可转换当前文字区块，Ctrl/Cmd＋D 复制当前或选中的区块（包含子区块）。Windows 下 Ctrl＋Shift＋0/1/2/3/4/5/6/8 分别转换为文本、H1/H2/H3、待办、项目列表、编号列表、代码；Mac 使用 Cmd＋Option＋对应数字。Ctrl/Cmd＋E 设置行内代码，Ctrl/Cmd＋Shift＋S 设置删除线。

停止输入约一秒后自动保存，顶部显示 `Saving… / Saved`。正文以原生区块 JSON 存入 PostgreSQL 的 `NotePage` 表，并沿用现有签名设备 Cookie 的匿名用户归属。浏览器只缓存尚未成功保存的草稿；失败后可以重试或刷新恢复。两个标签页修改同一页面时通过版本号阻止覆盖，冲突可以保存为新页面或载入最新版本。

未登录时页面与同一浏览器、同一域名绑定：清除网站 Cookie、切换浏览器/设备/域名后，数据库中的页面仍在，但无法重新认领。使用 Google 登录后，同一账号在其他设备登录即可找回；已登录账号下的页面不会自动合并来自另一台设备的匿名数据。删除页面前会确认，删除只是移入 Trash，30 天内可以复原（见下节），超过后才永久删除。标题最多 200 字符，单页请求最大 1 MiB、最多 2,000 个块及 8 层块嵌套。正文列表可以缩进，页面列表没有子页面层级。

Notes 编辑和自动保存本身不调用 AI；笔记内的 AI 助手只在用户发送请求后调用所选模型。无需新增环境变量。新增表通过正常的 `npm run prisma:migrate` 部署。详细数据流见 [notes-flow.md](docs/architecture/notes-flow.md)。

Chat / Note 切换、手机笔记列表进入和返回，以及列表增删移动使用浏览器 View Transition；不支持该 API 时直接切换。手机抽屉支持左滑关闭，模型、附件和笔记 AI 底部面板可拖动持手下滑关闭，距离不足时回弹。按钮提供轻微按压反馈；系统启用“减少动态效果”时关闭过场和回弹动画。

## 搜索、项目上下文与 Trash

让过去的对话和笔记能被找回、被下一次对话用上，并且整理和 AI 修改时可以放心撤销。三项功能都不新增环境变量，也不调用额外的外部模型 API；数据库只新增表和可空列，随 `npm run prisma:migrate` 部署。

**跨 Chats 与 Notes 搜索。** `GET /api/search?q=…&scope=all|chats|notes` 在当前用户的会话消息（及标题）和笔记（标题及正文）里做关键词搜索：`q` 为 1–100 字符，按空白切成最多 8 个词，必须全部命中（不区分大小写），每类最多返回 15 条。笔记助手的对话和 Trash 里的笔记不参与搜索。搜索面板用 Ctrl/Cmd+K 打开，选中结果会打开对应的会话或笔记，并滚动到命中的那条消息或那个块、短暂高亮。初版只做关键词匹配，不做语义检索。流程与跳转实现见 [chat-flow.md](docs/architecture/chat-flow.md#跨-chats--notes-搜索)。

**聊天项目的共通指示与参考笔记。** 项目菜单里的 “Project settings” 可设置最多 4,000 字符的共通指示，以及手动选择的最多 5 篇参考笔记。项目里的每次发送都会重新读取它们并放进系统指令：共通指示优先于默认的语言和格式，参考笔记的正文只当作资料而不是指令；每篇最多取 8,000 字符、合计最多 20,000 字符，超出会截断，因此每条消息会多发相应的输入内容（计入模型用量）。回答前的途中经过里会显示 “Used project …”，列出用到的指示和笔记，点笔记标签可打开它。Trash 里的笔记不会被使用。详见 [chat-flow.md](docs/architecture/chat-flow.md#项目的共通指示与参考笔记)。

**Trash 与笔记编辑历史。** 删除笔记是移入 Trash：30 天内可以复原（位置、分组和正文都保留），也可以单篇或整体永久删除；超过 30 天的笔记不能再复原。应用没有定时任务，超期笔记在打开 Trash、删除另一篇笔记或清空 Trash 时被永久删除。永久删除会同时删除这篇笔记的编辑历史、项目参考关联和笔记里的 AI 助手对话。每篇笔记还保存最多 50 份编辑历史：编辑时自动保存的快照（同一篇笔记至少间隔 10 分钟一份）、适用 AI 编辑提案之前的状态，以及每次恢复之前的状态，所以 AI 改坏或误恢复后都可以再恢复回去。恢复只改标题、图标和正文，封面、分组和位置不变。详见 [notes-flow.md](docs/architecture/notes-flow.md#trash回收站)。

## Android 应用

`mobile/` 是一个 Capacitor 安卓外壳：App 就是一个全屏 WebView，直接打开线上的 StudyMate，所以网站更新后 App 不用重新打包。打包命令、开发环境、限制和 App 里的 Google 登录方式（走手机自带的账号选择，不是网页登录）见 [android.md](docs/architecture/android.md)。

## API 保护

应用本身不做请求限流（聊天、图片生成、Notes 保存、搜索均不限次数）。API 费用只受上游模型厂商的额度控制；需要限流时，可以在 Vercel 防火墙或网关层配置。

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
- `ANTHROPIC_API_KEY`（启用 Claude 时必填）
- `ANTHROPIC_BASE_URL` / `ANTHROPIC_HAIKU_MODEL`（可选）
- `COOKIE_SECRET`
- `AUTH_SECRET`、`AUTH_GOOGLE_ID`、`AUTH_GOOGLE_SECRET`（启用 Google 登录时；需在 Google Cloud 的 OAuth 客户端里登记 `https://<域名>/api/auth/callback/google`）
- `BLOB_READ_WRITE_TOKEN`（Vercel Blob：图片存储，必填）

Vercel 的 Build Command 会先执行 `npm run prisma:migrate`，再执行应用构建；因此部署前必须配置 `DATABASE_URL`，并确保 Preview 环境不会指向不应迁移的生产数据库。生产 schema 变更只执行 `npm run prisma:migrate`（内部仅运行 `prisma migrate deploy`），不要运行 `prisma db push`、`prisma migrate reset` 等破坏性命令。该命令会用有限重试包装器处理 Neon 冷启动时的短暂连接失败，不会重试 SQL、认证或 Schema 错误。

## 校验

```bash
npm run typecheck
npm run lint
npm test
npx prisma validate
```
