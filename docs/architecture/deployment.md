# Deployment Architecture

## 已验证生产状态

GitHub / Vercel 部署与数据库连接于 2026-09-16 核对；Neon 项目资源信息于 2026-09-05 核对。

### GitHub

```text
Repository: kakumine2001/StudyMate
Branch: main
```

### Vercel

```text
Project: studymate
Framework: Next.js
Node.js: 24.x
Deployment type: Lambdas
Production region: iad1
```

Production aliases：

```text
studymate-lab-ai.vercel.app
studymate-kaku10.vercel.app
```

生产部署应始终核对 Vercel deployment 的 `gitSource.sha` 是否等于 GitHub `main` 当前提交；不要仅凭域名判断线上代码版本。

Vercel 项目已经连接：

```text
kakumine2001 / StudyMate
```

当前生产由 GitHub `main` push 触发，部署记录的 source 为 `git`。排查线上版本时，要同时看：

1. GitHub main HEAD
2. Vercel deployment commit SHA
3. deployment source

不要只看域名。

### Neon

```text
Project: neon_db
Region: aws-us-east-1
PostgreSQL: 18
Branch: production
Database: neondb
Schema: studymate
```

当前 Vercel `iad1` 与 Neon `aws-us-east-1` 都位于美国东部。

## Deployment Diagram

```mermaid
flowchart LR
    Local["Local development"] --> GitHub["GitHub main"]
    GitHub --> Vercel["Vercel production"]
    Vercel --> Browser["Browser"]
    Vercel --> Neon["Neon PostgreSQL"]
    Vercel --> Blob["Private Vercel Blob"]
    Vercel --> OpenAI["OpenAI"]
    Vercel --> DeepSeek["DeepSeek"]
    Vercel --> Notion["Notion"]
```

## Build

`package.json` 的 `engines.node` 固定为 `24.x`，与本地和 Vercel 运行环境一致，避免自动跨到下一个 Node.js 主版本。

`package.json` 与 `vercel.json` 当前：

```json
{
  "build": "prisma generate && next build",
  "start": "next start",
  "prisma:migrate": "node scripts/prisma-migrate-retry.mjs"
}
```

所以：

```text
npm run build
# prisma generate && next build
```

Vercel 的 `vercel.json` build command 会先运行 `npm run prisma:migrate`，再运行 `npm run build`；本地单独执行 `npm run build` 不会自动迁移数据库。

### Migration

代码库有 migration retry wrapper，用来处理 Neon 短暂连接问题。

当前 `vercel.json` 的 Build Command 会先执行 `npm run prisma:migrate`，再执行 `npm run build`。因此从 Vercel 正常构建的 production deployment 会走 migration deploy。

仍需注意：Preview 环境如果复用生产 `DATABASE_URL`，也可能触发 migration，所以环境变量必须明确区分。

## Database Schema Boundary

生产连接字符串必须把 StudyMate 指向：

```text
?schema=studymate
```

并且运行时 `src/lib/prisma.ts` 会再次显式把这个 schema 传给 Prisma adapter。

这是必要的，因为同一个 Neon database 里还有：

```text
kaku_log
```

本地使用独立数据库 `studymate` 的 `public` schema，不共享生产库。启动与迁移步骤见 [README](../../README.md#本地启动)。

生产 `DATABASE_URL` 当前使用 Neon pooled endpoint。Node 运行时会将旧的 SSL 别名明确为 `verify-full`，保持证书与主机名验证；详见 [数据库连接说明](database.md#runtime-connection)。

## Environment Variable Categories

### Core

```text
DATABASE_URL
COOKIE_SECRET
```

### OpenAI

```text
OPENAI_API_KEY
OPENAI_BASE_URL
OPENAI_TEXT_MODEL
OPENAI_IMAGE_MODEL
```

当前默认聊天模型为 `gpt-6-luna`，图片生成与编辑为 `gpt-image-2.5-sunburst`。Production 使用官方接入点 `https://api.openai.com/v1`，两条流程共用服务端 `OPENAI_API_KEY`。更换密钥或模型环境变量后，需要重新部署才能应用到运行中的函数。

### DeepSeek

```text
DEEPSEEK_API_KEY
DEEPSEEK_BASE_URL
DEEPSEEK_FLASH_MODEL
```

模型显示名、模型 ID、能力和推理档位都只定义在 `src/lib/models.ts`，不通过环境变量覆盖。

### Notion

```text
NOTION_API_KEY
NOTION_DATABASE_ID
```

### Image Storage

生产环境使用私有 Vercel Blob：

```text
Vercel Function
  -> @vercel/blob.put / get
  -> Private Vercel Blob (studymate-images)
  -> PostgreSQL 保存 imageStoragePath
```

Vercel 项目在 Production、Preview、Development 环境配置 `BLOB_READ_WRITE_TOKEN`。本地开发未配置该 token 时，Storage Layer 回退到 `STUDYMATE_STORAGE_DIR`；Vercel 环境缺少 token 会直接报错。

## Production Debug Checklist

线上出问题时按这个顺序，不要随机排查：

### 1. 确认部署代码

```text
GitHub main HEAD
vs
Vercel deployment commit SHA
```

### 2. 看 Vercel deployment state

确认：

```text
READY / ERROR
```

### 3. 看 Vercel build/runtime logs

区分：

- build error
- route runtime error
- upstream provider error

### 4. 确认 Neon

检查：

- production branch 是否 ready
- `neondb` 是否存在
- `studymate` schema 是否存在
- migration 是否完成

### 5. 再查外部 API

- OpenAI
- DeepSeek
- Notion
