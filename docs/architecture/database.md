# Database Architecture

`Message.providerContext` 为可空 TEXT，保存成功回答对应的原生压缩 checkpoint（版本、provider、实际上游 model、原生 items 和已覆盖消息 ID 的 JSON）。按已覆盖 ID 恢复，避免遗漏并发新增消息。仅服务端聊天请求读取，浏览器消息接口不返回；原始 `Message.content` 与附件不被压缩或删除。新增字段通过 `20261011120000_message_provider_context` migration 部署。

`Message.activity` 为可空 TEXT，保存回答前的途中经过（推理摘要、Web 搜索、Pages 工具步骤的 `ActivityStep[]` JSON，不含已另存于 `NoteProposal` 的提案）；`Message.thinkingMs` 为可空 INTEGER，保存从请求开始到首个正文增量的毫秒数。两者仅用于显示，浏览器消息接口返回（经 `parseStoredActivity` 校验），聊天历史查询不 select、不回传给模型。新增字段通过 `20261014180000_message_activity` migration 部署。

## 实际生产数据库

截至 2026-09-05 已通过 Neon 实际资源确认：

| 项目 | 当前值 |
| --- | --- |
| Neon project | `neon_db` |
| Region | `aws-us-east-1` |
| PostgreSQL | 18 |
| Branch | `production` |
| Database | `neondb` |
| StudyMate schema | `studymate` |

### 非常重要

同一个 `neondb` 中还存在另一个 schema：

```text
kaku_log
```

它不是 StudyMate 的表。

数据库排查或手工 SQL 时，优先明确写 `studymate.<Table>`，不要因为都在同一个 Neon project 里就把两个应用混在一起。

## Runtime Connection

`src/lib/prisma.ts` 使用：

```text
DATABASE_URL
    ↓
读取 ?schema=...
    ↓
PrismaPg(databaseUrl, { schema })
    ↓
PrismaClient
```

默认 schema 回退值是 `studymate`。

2026-09-16 的生产构建日志确认 `DATABASE_URL` 使用 Neon pooled endpoint。连接方式以部署实际使用的地址为准，不能从旧的 compute 状态推断。

Node 运行时在创建 adapter 前，通过 `src/lib/database-url.ts` 把 `sslmode=prefer/require/verify-ca` 明确为 `verify-full`，保持当前 pg 8 的证书与主机名验证语义，避免将来升级改变行为。显式的 `uselibpqcompat=true` 设置不改写；没有 TLS 参数的本地连接也不改写。Prisma CLI 继续使用原始 `DATABASE_URL`。

## Local Database

本地开发使用独立的 Docker PostgreSQL 18.4 容器 `studymate-pg18-dev`，主机端口 5432，数据库 `studymate`，schema `public`。它与生产 Neon 的 `neondb/studymate` 分离；不要为了统一名称移动已有表或重置数据。

启动与连接排查见 [README 的本地启动](../../README.md#本地启动)。Docker Desktop 和容器必须运行；数据库不可用时，静态页面仍可能显示，但会话 API 会返回 503。

## ER Diagram

```mermaid
erDiagram
    AnonymousUser ||--o{ Session : owns
    AnonymousUser ||--o{ ChatProject : owns
    ChatProject ||--o{ Session : groups
    Session ||--o{ Message : contains
    Message ||--o{ Attachment : has
    AnonymousUser ||--o{ NotePage : owns
    AnonymousUser ||--o{ NoteCoverAsset : uploads
    AnonymousUser ||--o{ NoteGroup : owns
    NoteGroup ||--o{ NotePage : groups
    AnonymousUser ||--o{ NoteProposal : owns
    Session ||--o{ NoteProposal : proposes

    AnonymousUser {
        string id PK
        string deviceId
        string googleSub "nullable, unique"
        string email "nullable"
        string name "nullable"
        string image "nullable"
        string displayName "nullable"
        string avatarIcon "nullable"
        string avatarImage "nullable"
        datetime createdAt
        datetime updatedAt
    }

    NoteCoverAsset {
        string path PK
        string userId FK
        datetime releasedAt
        datetime deletingAt
        datetime createdAt
    }

    NotePage {
        string id PK
        string userId FK
        string title
        string icon
        string cover
        int coverPosition
        string groupId FK "nullable"
        json blocks
        int version
        datetime createdAt
        datetime updatedAt
    }

    NoteGroup {
        string id PK
        string userId FK
        string name
        int position
        datetime createdAt
    }

    NoteProposal {
        string id PK
        string userId FK
        string sessionId FK
        string messageId "nullable"
        enum kind "EDIT or CREATE"
        enum status "PENDING, APPLIED, DISCARDED"
        json payload
        string appliedPageId "nullable"
        datetime createdAt
        datetime updatedAt
    }

    Session {
        string id PK
        string title
        string icon
        string userId FK
        string noteId FK "nullable"
        datetime createdAt
        datetime updatedAt
    }

    Message {
        string id PK
        string sessionId FK
        string role
        string content
        string providerContext
        string activity
        int thinkingMs
        string model
        string reasoningEffort
        datetime createdAt
    }

    Attachment {
        string id PK
        string messageId FK
        string filename
        string mimeType
        int size
        string extractedText
        string imageStoragePath
        datetime createdAt
    }
```

## Table Responsibilities

### AnonymousUser

匿名浏览器设备，同时也是 Google 登录后的用户记录（表名沿用，不重命名）。

核心字段：

- `id`：内部主键
- `deviceId`：签名 Cookie 对应的唯一设备 ID
- `googleSub`：可空且唯一，Google 账号 ID；首次 Google 登录时绑定到当前设备的用户，之后在任何设备登录同一账号都会得到这一行
- `email` / `name` / `image`：可空，登录时从 Google 同步的资料
- `displayName` / `avatarIcon` / `avatarImage`：可空，用户在侧栏“个人资料”里自己设的显示名（1–40 个字符）、emoji 图标、上传的头像照片（存储路径）。为空就用 Google 的名字和头像。头像照片和 emoji 图标二选一：上传照片会清掉图标，选图标或“恢复 Google”会清掉照片并删除旧文件。它们和上一行是两组字段：每次登录会用 Google 的资料覆盖 `name` / `image`，但不会动这三个字段。照片在浏览器里先裁成 512×512 再上传，存到 `avatars/<用户 ID>/<UUID>.<扩展名>`（私有 Blob；本地开发在配置了 Blob token 时也写同一个 Blob，不是本地磁盘），`GET /api/account/avatar?v=<UUID>` 只返回当前登录用户自己的照片（版本对上才长缓存），`POST` 上传（只收 JPEG/PNG/WebP/GIF，按内容识别，≤ 2 MB；选照片时上限 10 MB、短边至少 200px，数值参照 Slack / LinkedIn / X 等主流产品）。`GET/PATCH /api/account` 读写名字和图标，只有已用 Google 登录的本人能改；新增字段通过 `20261014200100_user_profile`、`20261014200200_user_avatar_image` migration 部署

关系：

```text
AnonymousUser 1 -> N Session
```

删除用户会级联删除 Session。

### NotePage

站内笔记页面，与聊天 `Session` 独立。`userId` 关联 `AnonymousUser`，删除匿名用户时级联删除。`blocks` 保存 BlockNote 原生 JSON 的区块顺序、稳定 ID、文字装饰和嵌套关系；页面标题另存 `title`。`icon` 是单个emoji，`cover` 是 `src/lib/note-document.ts` 中 `NOTE_COVERS` 的预设键，或 `upload:page-covers/<userId>/<uuid>.<ext>` 形式的上传图片键（不接受任意 URL）；`coverPosition` 是上传封面的纵向位置（0–100）。未设置时均为 null。上传封面路径包含所属匿名用户 ID，服务端只允许引用自己目录下的键；上传封面登记在 `NoteCoverAsset`（`path` 主键、`userId`、`releasedAt`、`deletingAt`）：上传时先建行（`releasedAt` 为当前时间）再写入存储；保存页面引用上传封面时在同一事务内把该行设为使用中（`releasedAt = null`），行已不存在则拒绝保存。`collectUnusedCovers()`（`src/lib/note-covers.ts`）先给不再被引用的行记录 `releasedAt`，记录后再次确认引用，避免与保存同时发生时误记。连续未使用 7 天后用条件更新设置 `deletingAt`（此后不能再被引用），删除存储中的图片成功后才删除该行，失败的在下次运行重试；目前没有定时任务调用它（Vercel Cron 已移除），未引用的封面图片会留在存储中，需要时再接入；与保存竞争时以同一行的锁决定结果，不会留下指向已删除图片的页面。只处理本数据库登记的封面，因此与本地开发共享 Blob 存储也不会误删。PATCH 省略 `icon`/`cover`/`coverPosition` 时保留已保存的值，兼容旧客户端与旧草稿。

`version` 从 0 开始，每次保存原子递增。更新条件同时包含页面 ID、匿名用户 ID 和预期版本；版本冲突返回 409，防止另一标签页的内容被覆盖。`(userId, updatedAt)` 索引用于侧栏列表。所有页面读写限制在当前匿名用户。具体保存和草稿恢复流程见 [notes-flow.md](notes-flow.md)。

### NoteGroup

Notes 的单层分组（文件夹）。`userId` 关联 `AnonymousUser`，删除用户时级联删除；`position` 决定排列顺序（新分组排在最后），索引 `(userId, position)`。每个用户最多 50 个分组，名称最长 60 字符。`NotePage.groupId` 可空，指向所属分组；删除分组时页面保留并把 `groupId` 置空（`SetNull`），索引 `(userId, groupId)`。移动页面只改 `groupId`，不增加 `version`。

### NoteProposal

AI 提出的笔记修改或新建提案。`kind` 为 `EDIT`（修改已有笔记）或 `CREATE`（新建），`status` 为 `PENDING`（待确认）、`APPLIED`、`DISCARDED`。`payload` 保存画面要显示的内容和适用时要写入的标题与块（编辑还包含目标笔记 ID 和提案时的基准版本）；`messageId` 在回答保存后填入，用来在历史里把提案挂回那条回答（为 null 的不显示）；`appliedPageId` 是新建提案适用后创建的笔记 ID，重复适用时据此返回同一笔记。`userId` 和 `sessionId` 删除时级联删除。适用在一个事务里先把 `PENDING` 改为 `APPLIED` 再写笔记，所以并发或重发都只会生效一次；版本不一致时事务回滚，提案保持待确认。索引 `(sessionId, createdAt)` 用于读取会话历史，`messageId` 索引用于按回答查找。流程见 [chat-flow.md](chat-flow.md)。

### ChatProject

聊天的独立项目，与 Notes 分组互不影响。字段为 `id`、`userId`、`name`、`createdAt`，所有 API 按当前用户限定所有者。项目最多 50 个，名字最多 60 字符；删除项目时会话外键设为 null，聊天和消息保留。

### Session

一段对话。

核心字段：

- `title`
- `icon`（可空，单个 emoji，`null` 为默认聊天图标）
- `pinned`（置顶）、`projectId`（可空，独立聊天项目）、`titleManual`（手动标题不再被自动标题覆盖）
- `userId`
- `noteId`（可空；有值表示这是“笔记里的 AI 助手”的对话，关联 `NotePage`，删除笔记时一起删除）
- `createdAt`
- `updatedAt`

索引：

```text
(userId, updatedAt)
(userId, projectId)
(noteId)
```

用于按用户读取并排序最近会话。`GET /api/sessions` 只返回 `noteId` 为空的会话，所以笔记助手的对话不会出现在侧栏的 Chats 里。新增字段通过 `20261014210000_session_note` migration 部署（只追加可空列、索引和外键）。

`icon` 可在 `POST /api/sessions` 创建会话时一并给出（新聊天在第一条消息前选的图标；不带请求体的旧调用仍然可用），之后由 `PATCH /api/sessions/[sessionId]` 修改：校验与 Notes 图标相同（`src/lib/emoji-icon.ts`，单个 emoji 或 `null`），按会话 ID 和匿名用户 ID 限定所有者；修改图标时把 `updatedAt` 原样写回，不改变侧栏的最近使用排序：写入条件包含读到的 `updatedAt`，若同时有回答保存使其前进则重新读取并重试（最多 3 次），仍有竞争时以保存图标为优先、不再保持排序。新增字段通过 `20261014200000_session_icon` migration 部署。

### Message

一条用户或 AI 消息。

核心字段：

- `sessionId`
- `role`
- `content`
- `providerContext`（可空，仅服务端原生压缩状态）
- `activity`（可空，回答前的途中经过 JSON，仅用于显示）
- `thinkingMs`（可空，本文开始前的毫秒数）
- `model`
- `reasoningEffort`

关系：

```text
Session 1 -> N Message
```

索引：

```text
(sessionId, createdAt)
```

### Attachment

属于某一条 Message 的附件。

核心字段：

- `filename`
- `mimeType`
- `size`
- `extractedText`
- `imageStoragePath`

其中：

- 文本/PDF：主要使用 `extractedText`
- 图片：主要使用 `imageStoragePath`
- 图片二进制不存 PostgreSQL

关系：

```text
Message 1 -> N Attachment
```

## Enums

```text
MessageRole
- USER
- ASSISTANT
- SYSTEM

ReasoningEffort
- NONE
- LOW
- MEDIUM
- HIGH
- XHIGH
- MAX
```

## 为什么 Attachment 不直接存图片

早期 migration 曾经存在 `imageDataUrl` 字段，随后被删除，改为：

```text
Attachment.imageStoragePath
        ↓
实际图片存储
```

这是正确的“数据库保存引用、对象存储保存文件本体”的方向。生产环境中 `imageStoragePath` 保存私有 Vercel Blob 的 pathname；本地开发未配置 Blob token 时才回退到文件系统路径。

## Migration Rule

生产只使用可追踪 migration：

```bash
npm run prisma:migrate
```

不要对生产执行：

```text
prisma db push
prisma migrate reset
```

Schema 变更应同时更新：

1. `prisma/schema.prisma`
2. `prisma/migrations/`
3. 本文档 ERD

聊天行右侧固定显示三点按钮（左）和图钉按钮（右）。图钉负责置顶/取消置顶；三点菜单只提供重命名、移动项目和删除确认。列表先显示置顶聊天，再显示项目和未分组聊天；同区内按手动 `position` 顺序排列，未手动排序的新聊天先显示；修改内容不会挪动已排好的顺序。`PATCH /api/sessions/[sessionId]` 接受 `title`（1–120 字符）、`pinned`、`projectId`，项目归属同时验证所有者；元数据更新沿用图标的并发时间戳保护。`/api/chat-projects` 与 `/api/chat-projects/[projectId]` 提供项目列表、新建、改名与删除。新增表和字段通过 `20261015000000_chat_projects` 非破坏迁移部署。

`Session.position` 和 `NotePage.position` 由 `20261015001000_manual_list_order` 追加并按此前显示顺序回填。新项目/分组不影响正文结构。`POST /api/sessions/reorder`、`POST /api/pages/reorder` 在用户级事务锁中读取最新完整列表，以目标行确定插入位置，保存全部 `position` 并将移动项放进目标行所属项目/分组（拖入置顶区只改变置顶状态，保留原项目；置顶区内部排序也保留项目归属）。排序 SQL 明确限定 schema 和 userId，参数化行 ID；不触发 Prisma 的 `@updatedAt` 或笔记版本更新。
