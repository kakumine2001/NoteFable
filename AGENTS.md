# StudyMate Agent Guide

## Project

Tech stack: Next.js 16 App Router, React 19, Tailwind CSS v4, Prisma 7, Neon PostgreSQL, Vercel, Private Vercel Blob, OpenAI, DeepSeek, and Notion.

## Task and Context Routing

- Start from the current request: research/design discussion produces a reviewable plan; an implementation request proceeds through relevant validation within its authorized scope.
- UI changes preserve the established product language, spacing and motion. Inspect the existing implementation and actual screen before adapting controls; do not apply a global visual profile automatically.
- Production URLs, environment setup and operational details are maintained in [README.md](README.md) and `docs/architecture/`. Verify the actual deployment when diagnosing production; do not maintain a second URL or deployment SHA here.
- Model/API changes: read the source-of-truth table and Model and API Rules below. Storage/auth/database changes: read the corresponding rules and maintained architecture documents.

## Scope Rules

- Keep the current anonymous device-cookie session model unless the user explicitly asks for an authentication redesign.
- The signed device cookie separates session ownership; it is not real access control.
- Do not add public multi-user product features unless explicitly requested.
- Keep secrets and provider credentials server-side.

## Documentation Sync

- Treat `README.md` and `docs/architecture/` as maintained documentation, not as stale reference files.
- When a material change affects documented behavior or operations — such as hosting, deployment, database/schema, model endpoints, environment variables, storage, authentication, or local development setup — update the affected documentation in the same change.
- Review this `AGENTS.md` as well when the change affects durable coding guidance or safety rules.
- Do not create documentation-only churn for incidental refactors, temporary debugging, or implementation details that do not change the documented system state.
- Replace stale statements instead of appending contradictory history. Add verification dates only when they materially help.
- Never commit passwords, API keys, tokens, connection secrets, or other private credentials to documentation.

## Source of Truth

| Concern | Source |
| --- | --- |
| Model capabilities and reasoning levels | `src/lib/models.ts` |
| Anonymous identity | `src/lib/auth.ts` |
| Chat flow and system instructions | `src/app/api/chat/route.ts` |
| Image generation | `src/app/api/images/route.ts` |
| File and attachment handling | `src/lib/files.ts` |
| Image storage | `src/lib/storage.ts` |
| Database connection/schema | `src/lib/prisma.ts` |
| Database models | `prisma/schema.prisma` |
| Notion integration | `src/lib/notion.ts` and `src/app/api/notion/pages/route.ts` |
| Internal pages and autosave | `src/lib/note-document.ts`, `src/lib/note-save-queue.ts`, `src/app/api/pages/*` |
| Notion file export | `src/lib/notion-files.ts`, `src/lib/notion-saves.ts`, `src/app/api/notion/saves/*` |
| Human-readable architecture | `README.md` and `docs/architecture/` |

## Model and API Rules

- Treat `src/lib/models.ts` as the single source of truth for supported models, capabilities, and reasoning levels.
- Update model definitions first, then align frontend and API validation.
- Only the upstream model name (`OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `DEEPSEEK_FLASH_MODEL`) and provider base URL are environment-configurable. Display labels, provider routing, capabilities, and reasoning levels stay in code so client and API keep one contract.
- OpenAI and DeepSeek chat both use their Responses API paths. Only OpenAI uses provider-native web search; the current DeepSeek API ignores built-in `web_search`. Do not advertise or send unsupported search tools.
- The shared chat system instructions live in `buildInstructions()` inside `src/app/api/chat/route.ts`. Do not duplicate the prompt in provider-specific branches or in this file.
- Image generation is an explicit UI mode. Do not infer image generation from normal chat prompt text.
- `/api/images` uses `/images/generations` for text-only generation and `/images/edits` when reference images are supplied.
- Do not switch image generation to the Responses API unless the user explicitly asks for that redesign and the current upstream compatibility is revalidated.
- Keep provider-specific differences behind shared helpers where possible.

## Storage

- Internal Pages store native block JSON in `NotePage`, scoped to `AnonymousUser`. Keep the editor schema and server block validation aligned; use version checks for updates. Local draft caches do not replace server persistence or provide identity recovery.

- Production image binaries are stored in Private Vercel Blob through `@vercel/blob`.
- `BLOB_READ_WRITE_TOKEN` is required on Vercel.
- Local development may fall back to `STUDYMATE_STORAGE_DIR` when the Blob token is absent.
- PostgreSQL stores attachment metadata and `imageStoragePath`, not image binaries.
- Images are served through `/api/attachments/[id]/image`, which checks anonymous ownership before reading storage.

## Notion File Export

- Keep the two Notion API versions separate: `NOTION_API_VERSION` for existing page/database calls, `NOTION_FILE_API_VERSION` for `file_uploads`, `users/me`, and appending content blocks. Do not bump the shared version.
- File metadata rules (supported extensions, size limits, part splitting) live in `src/lib/notion-files.ts` so the drawer and the server validate identically.
- Browser upload tokens are issued per chunk in `src/app/api/notion/uploads/route.ts`. Keep them scoped to the exact pathname and chunk size, and never expose `BLOB_READ_WRITE_TOKEN` to the client.
- Staged files live under `notion-staging/<saveId>/<fileId>/<index>` and must be released on success and on cancel. The daily cron route requires `CRON_SECRET`.
- Keep page creation and content appending as separate recorded steps so a failure continues on the same page instead of creating a second one.

## Database Safety

- Production database: Neon PostgreSQL, database `neondb`, schema `studymate`.
- `src/lib/prisma.ts` explicitly passes the schema from `DATABASE_URL` to the Prisma PostgreSQL adapter.
- Production schema changes must use `npm run prisma:migrate` / `prisma migrate deploy`.
- Never run destructive Prisma commands against production:
  - `prisma db push`
  - `prisma db push --accept-data-loss`
  - `prisma db push --force-reset`
  - `prisma migrate reset`
- Vercel builds run migration before application build via `vercel.json`.
- Do not point Preview deployments at a production database unless that behavior is explicitly intended.

## Validation

Before finishing code changes, run the checks relevant to the change:

- `npm test`
- `npm run typecheck`
- `npm run lint`
- `npx prisma validate` when Prisma schema or migrations change

For UI/layout changes, verify the affected view in a browser. Do not add or run Playwright/E2E tests unless explicitly requested.

## Keep This File Small

This file is for durable rules that help coding agents avoid breaking the project.

Do not add:
- dated investigation notes
- one-off probe results
- retired infrastructure history
- personal filesystem paths
- fixed secret values, database hosts, or IDs
- long copies of prompts or architecture docs

Put human-facing explanation in `README.md` or `docs/architecture/` instead.
