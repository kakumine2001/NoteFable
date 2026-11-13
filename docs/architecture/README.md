# StudyMate Architecture

这个目录的目的不是写“漂亮的设计文档”，而是让未来的自己在几个月没有维护之后，能快速恢复对系统的理解。

文档原则：

1. **先记录真实实现，再写建议目标。**
2. **数据怎么流比用了什么技术更重要。**
3. 架构图使用 Mermaid，跟代码一起版本管理。
4. 数据库结构以实际 Neon + Prisma schema 为准。
5. 部署状态以 Vercel / Neon 实际资源和当前部署记录为准。

## 5 分钟恢复上下文

按这个顺序看：

1. 本文件 — 系统有哪些组件
2. [chat-flow.md](chat-flow.md) — 用户发一句话之后到底发生什么；也包含项目的共通指示与参考笔记、跨 Chats / Notes 搜索、回答的复制 / 保存到 Notes / Markdown 导出与会话链接
3. [image-flow.md](image-flow.md) — 图片上传、AI 生成图片、图片保存
5. [database.md](database.md) — Neon 里有哪些表、关系是什么
6. [deployment.md](deployment.md) — GitHub、Vercel、Neon 如何组合
7. [notes-flow.md](notes-flow.md) — 站内页面、区块编辑、自动保存与冲突恢复、Trash 与编辑历史
8. [android.md](android.md) — 安卓外壳：怎么改、开发环境、打包、限制
9. [android-native.md](android-native.md) — Kotlin / Compose 客户端、模型列表与网页界面对齐
10. [i18n.md](i18n.md) — 英/简中/繁中/日界面、语言选择 Cookie、浏览器和地区回退

## 一张图先记住整个项目

```mermaid
flowchart LR
    Browser["Browser"]
    App["Next.js on Vercel"]
    Chat["Chat API"]
    Images["Image API"]
    Sessions["Session APIs"]
    Pages["Page APIs"]
    Search["Search API"]
    Neon["Neon PostgreSQL"]
    Blob["Private Vercel Blob"]
    OpenAI["OpenAI APIs"]
    DeepSeek["DeepSeek API"]

    Browser --> App
    App --> Chat
    App --> Images
    App --> Sessions
    App --> Pages
    App --> Search
    Chat --> Neon
    Chat --> OpenAI
    Chat --> DeepSeek
    Chat --> Blob
    Images --> OpenAI
    Images --> Neon
    Images --> Blob
    Sessions --> Neon
    Pages --> Neon
    Search --> Neon
```

## 最重要的源文件

| 文件 | 作用 |
| --- | --- |
| `src/app/[locale]/page.tsx`、`src/components/thread-landing.tsx`、`src/app/[locale]/landing.css` | `/` 产品介绍主页（"一根线"滚动叙事）；旧的根路径会话与笔记链接保留查询参数转到 `/app` |
| `src/app/[locale]/app/page.tsx` | `/app` 聊天与 Notes 工作区、输入框、附件、发送、图片生成模式 |
| `src/app/api/chat/route.ts` | 普通聊天主流程 |
| `src/app/api/images/route.ts` | 图片生成 / 图片编辑主流程 |
| `src/app/privacy/page.tsx`、`src/app/terms/page.tsx` | 公开的隐私权政策与服务条款（Google 同意屏幕要填这两个链接） |
| `src/app/api/sessions/*` | 会话列表、历史消息读取、会话图标 |
| `src/app/api/pages/*` | 站内页面 CRUD、匿名归属和版本检查；`trash/*` 是回收站，`[pageId]/revisions/*` 是编辑历史与恢复 |
| `src/lib/note-trash.ts`、`src/lib/note-revisions.ts` | Trash 保留期与惰性清理；编辑历史的快照 SQL、保留上限与裁剪 |
| `src/components/note-trash-dialog.tsx`、`src/components/note-history-dialog.tsx` | Trash 对话框与编辑历史/恢复对话框 |
| `src/components/note-editor.tsx` | 客户端区块编辑器及允许的区块类型 |
| `src/lib/note-save-queue.ts` | 自动保存队列、重试和冲突状态 |
| `src/lib/chat-project-context.ts`、`src/app/api/chat-projects/*`、`src/components/chat-project-settings.tsx` | 聊天项目的共通指示与参考笔记：读取、截断、写入系统指令，及设置界面 |
| `src/app/api/search/route.ts`、`src/lib/search.ts`、`src/lib/search-fold.ts`、`src/components/search-dialog.tsx`、`src/lib/search-reveal.ts` | 跨 Chats / Notes 关键词搜索（表记折叠、附件文本、项目过滤）、搜索面板、跳到命中的消息或块 |
| `src/components/answer-actions.tsx`、`src/lib/answer-export.ts`、`src/lib/clipboard.ts` | 回答下方的 Copy / Save to Notes / Markdown 操作：回答转笔记块与 .md 文件，`/?chat=&message=` 会话链接（根页面重定向后，由 `src/app/[locale]/app/page.tsx` 打开会话） |
| `src/app/api/attachments/[attachmentId]/image/route.ts` | 保存图片的受控读取入口 |
| `src/lib/auth.ts` | 匿名设备 Cookie / 用户识别；已 Google 登录时返回对应账号的用户 |
| `src/lib/google-auth.ts`、`src/app/api/auth/[...nextauth]/route.ts` | Auth.js（JWT 会话）的 Google 登录；未配置环境变量时停用 |
| `src/lib/native-google-login.ts`、`src/app/api/native-auth/*`、`src/lib/native-app.ts` | Android App 内的 Google 登录：校验端侧 ID 令牌后签发同样的会话 Cookie（见 [android.md](android.md)） |
| `src/lib/models.ts` | 模型能力、推理档位 |
| `src/lib/claude-image.ts` | Claude 模型图片副本压缩与尺寸控制，原图保留 |
| `src/lib/files.ts` | 文件校验、PDF/文本抽取、图片预处理 |
| `src/lib/chat-upload-ticket.ts`, `src/lib/chat-uploads.ts`, `src/app/api/uploads/*` | 聊天附件私有 Blob 直传凭证、归属验证、大小检查、临时文件读取与清理 |
| `src/lib/storage.ts` | Vercel Blob 图片存储（本地开发可回退到文件系统） |
| `src/lib/prisma.ts` | Prisma + PostgreSQL adapter、schema 选择 |
| `src/lib/deepseek-responses.ts` | DeepSeek Responses 兼容处理 |
| `prisma/schema.prisma` | 数据模型 |
| `prisma/migrations/` | 数据库变更历史 |

## 图片存储

当前生产实现：

```text
Vercel Function
  -> Private Vercel Blob
  -> PostgreSQL 保存 blob pathname / storage key
```

本地开发在未配置 `BLOB_READ_WRITE_TOKEN` 时回退到 `STUDYMATE_STORAGE_DIR`，但 Vercel 环境缺少 Blob token 会直接报错，不会把临时文件系统当成持久存储。

## 文档更新时间

GitHub / Vercel 部署、生产数据库连接方式与本地数据库：**2026-09-16**。Neon 项目资源信息：**2026-09-05**。
