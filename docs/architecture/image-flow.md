# Image Upload & Generation Flow

StudyMate 的“图片”其实有两条完全不同的流程：

1. 用户上传图片给模型看
2. 用户让模型生成/编辑图片

不要把这两条链路混在一起。

## 1. 普通聊天中的图片上传

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant ChatAPI
    participant Files
    participant Storage
    participant Database
    participant Provider

    User->>Browser: Select image
    Browser->>Storage: Direct upload to private Blob with restricted ticket
    Browser->>ChatAPI: Text and signed upload references
    ChatAPI->>Storage: Verify owner and actual size/type, read and remove temporary original
    ChatAPI->>Files: Prepare attachment
    Files->>Storage: Store image
    Storage-->>Files: Return storage path
    Files-->>ChatAPI: Return image input and path
    ChatAPI->>Database: Save attachment metadata
    ChatAPI->>Provider: Send image input
    Provider-->>ChatAPI: Stream answer
    ChatAPI-->>Browser: Stream answer
```

### 为什么有两份表示

同一张图片在一次请求中有两个用途：

```text
Buffer
├── data:image/...;base64,...   -> 给 AI 看
└── imageStoragePath            -> 以后重新显示
```

Base64 data URL 不长期保存到 PostgreSQL。

Claude 使用独立的模型输入副本（`src/lib/claude-image.ts`、Sharp）：先尝试保留尺寸的 JPEG，再按需降低质量、等比缩小，不裁剪。原图字节、MIME、尺寸元数据和历史预览保持原样；超过 5 MiB 的原图不直接报错。模型副本完成处理后才保存原图；批量附件中任一处理或存储失败时，清理本批已保存且尚未写入数据库的原图，避免重试产生无引用文件。清理失败记入服务器日志，并保留原始处理错误。当前消息为图片分配最多 10 MiB、单张最多 5 MiB，当前与历史合计最多 20 MiB 未编码数据；历史读取也优化原图。上传限制仍为图片和文件合计 10 个、每个 20 MiB、合计 100 MiB。

这些是应用内部传输预算。Claude 直连 API 的官方单图限制按 Base64 后计算（10 MB），标准请求上限为 32 MB；Base64 约增加三分之一体积，因此服务端预留文字、历史和工具内容空间。见 [Claude Vision 文档](https://platform.claude.com/docs/en/build-with-claude/vision)。

历史预览从附件图片 API 开始：确认当前用户拥有该附件后，Blob 存储使用限单文件、5 分钟有效的签名 GET URL 重定向；大图不经 Vercel Function 代理回传。签名令牌只授予该图片的读取操作，私有存储访问凭据保留在服务器。

## 2. 图片生成

默认使用 `gpt-image-2.5-sunburst`，可通过 `OPENAI_IMAGE_MODEL` 覆盖。图片生成和编辑与 GPT-6 Luna 聊天共用服务端 `OPENAI_API_KEY`，接入点为 `https://api.openai.com/v1`。模型访问权限取决于 OpenAI 项目设置。

前端开启：

```text
Create an image
```

以后，发送目标从：

```text
/api/chat
```

切换为：

```text
/api/images
```

### 无参考图

```mermaid
sequenceDiagram
    actor User
    participant Browser
    participant ImageAPI
    participant OpenAI
    participant Storage
    participant Database

    User->>Browser: Enter image prompt
    Browser->>ImageAPI: Submit request
    ImageAPI->>OpenAI: Generate or edit image
    OpenAI-->>ImageAPI: Return image data
    ImageAPI->>Storage: Store generated image
    Storage-->>ImageAPI: Return storage path
    ImageAPI->>Database: Save messages and attachment
    ImageAPI-->>Browser: Return generated image
```

### 有参考图

区别只有 OpenAI endpoint：

```text
无参考图片 -> /images/generations
有参考图片 -> /images/edits
```

参考图也会作为用户 Message 的 Attachment 保存。

已有会话生成图片时，服务端在确认会话归属后读取最近 24 条 USER/ASSISTANT 消息，将最近最多 8,000 字符的对话及附件提取文本作为背景加入 Images API 的 prompt；本次用户指令优先，转换后的 prompt 不写入可见聊天记录。无会话历史时直接使用本次输入。

本次上传的参考图优先；没有新参考图时，复用最近一个带图片的消息中的 PNG/JPEG/WebP（包括助手生成的图片），最多 3 张、合计 15 MiB。历史图片也通过 `/images/edits` 传入，不重复存储为本次上传。新话题应忽略不相关历史及图片；历史图片超过预算或无法读取时跳过，以免旧附件阻断全新题材的生成。没有可复用图片时，在生成 prompt 中明确说明旧图片不可见，并继续传入对话文字；需要精确编辑未能复用的旧图时，重新上传该图。

## 3. 历史图片怎么显示

数据库不会把服务器路径直接给浏览器。

```mermaid
sequenceDiagram
    participant Browser
    participant MessagesAPI
    participant Database
    participant ImageRoute
    participant Storage

    Browser->>MessagesAPI: Load messages
    MessagesAPI->>Database: Read messages and attachments
    Database-->>MessagesAPI: Return attachment metadata
    MessagesAPI-->>Browser: Return protected image route
    Browser->>ImageRoute: Request image
    ImageRoute->>Database: Check ownership
    ImageRoute->>Storage: Read stored image
    Storage-->>ImageRoute: Return image bytes
    ImageRoute-->>Browser: Return image
```

这条受控 API 的设计是对的：浏览器不知道服务器真实文件路径。

## 4. 当前图片实际存在哪里

生产环境（Vercel）由 `src/lib/storage.ts` 通过 `@vercel/blob` 写入私有 Blob：

```text
src/lib/storage.ts
    ↓
@vercel/blob.put(..., { access: "private" })
    ↓
Vercel Blob（studymate-images）
```

本地开发在未配置 `BLOB_READ_WRITE_TOKEN` 时使用 `STUDYMATE_STORAGE_DIR`：

```text
data/storage/
└── images/
    └── YYYY/
        └── MM/
            └── DD/
                └── <uuid>.png
```

PostgreSQL 只存：

```text
Attachment.imageStoragePath
```

## 5. 当前 production 的实际状态

Vercel Production 已配置 `BLOB_READ_WRITE_TOKEN`，并运行通过 Blob 接线的 Storage Layer：

```mermaid
flowchart LR
    Browser["Browser"] --> App["Next.js on Vercel"]
    App --> Blob["Private Vercel Blob"]
    App --> Neon["Neon PostgreSQL"]
    Neon --> Ref["Attachment imageStoragePath"]
```

当前职责：

```text
Vercel Blob
-> 图片二进制

Neon PostgreSQL
-> filename
-> mimeType
-> size
-> message relationship
-> blob pathname / storage key
```

生产部署必须配置 `BLOB_READ_WRITE_TOKEN`；缺少该变量时，Vercel 环境会明确报错，不会静默写入临时磁盘。

### 当前完成度

- Vercel Blob Store：已启用（`studymate-images`）
- StudyMate production 代码：通过 `put()` / `get()` 读写私有 Blob
- `@vercel/blob`：已加入 `package.json`
- Storage Layer 接线：已完成

## 6. Storage Layer 约束

业务层只调用 Storage Layer：

```text
writeStoredImage()
readStoredImage()
```

上层 `/api/chat`、`/api/images` 和 Attachment 模型尽量不要感知具体供应商。

当前接口：

```ts
writeStoredImage(buffer, mimeType): Promise<string>
readStoredImage(storagePath): Promise<Buffer>
```

这样未来从 Vercel Blob 换 S3 / R2，也不需要重写业务流程。
