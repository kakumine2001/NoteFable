<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project

StudyMate is a multi-model AI study assistant with session chat, file attachments, image generation, and web search.

- Live URL: `https://studymate-lzki.onrender.com`
- Knowledge vault: `C:\Users\kakumine\Desktop\知識倉庫\Projects\StudyMate\StudyMate 当前状态.md`
- Tech stack: Next.js 16.2.6 App Router, React 19, Tailwind CSS v4, Prisma 7 / PostgreSQL, Render (free tier)

## Architecture

| Concern | Location |
|---|---|
| Model capabilities | `src/lib/models.ts` — single source of truth |
| Anonymous auth | `src/lib/auth.ts` — signed cookie (`deviceId`) |
| File/attachment handling | `src/lib/files.ts` |
| Image binary storage | `src/lib/storage.ts` → `data/storage/images/YYYY/MM/DD/` |
| Upstream error formatting | `src/lib/upstream-errors.ts` |
| Chat (text + file input) | `POST /api/chat` — SSE stream, 30 req/h |
| Image generation | `POST /api/images` — JSON, 10 req/h |
| Session management | `/api/sessions`, `/api/sessions/[id]`, `/api/sessions/[id]/messages` |

## Models

Current models (defined in `src/lib/models.ts`):

| Model ID | Provider | Image input | Image gen | Web search |
|---|---|---|---|---|
| `gpt-5.5` | OpenAI | ✓ | ✓ | ✓ |
| `deepseek-v4-flash` | DeepSeek | ✗ | ✗ | ✓ (Tavily) |
| `deepseek-v4-pro` | DeepSeek | ✗ | ✗ | ✓ (Tavily) |

**Rules:**
- Update `src/lib/models.ts` first when model behavior changes, then align frontend and API validation.
- DeepSeek is text-only. Never enable image input or image generation for DeepSeek models.
- DeepSeek web search injects Tavily results as text context — it does not use native tool calls.
- OpenAI chat goes through the Responses API (`/responses`); DeepSeek uses Chat Completions.

## API & Proxy Rules

- Production `OPENAI_BASE_URL` is a compatible proxy.
- **Do not use `/responses` for image generation** — the proxy can return Cloudflare/HTML errors for synchronous calls.
- `/api/images` always uses `/images/generations` (text-only) or `/images/edits` (reference images).
- Non-ASCII strings in `/responses` JSON must be sent as `\uXXXX` escapes — raw UTF-8 can be corrupted by the proxy.
- Image generation is an explicit UI mode triggered by the user; never infer it from prompt text.
- Leave unspecified `size`/`quality` as `auto`.

## Data & Storage

- Keep image binaries out of PostgreSQL. Store only metadata and `imageStoragePath` in the `Attachment` table.
- Text files and PDFs are extracted as text context via `src/lib/files.ts`.
- Images served from local storage via `GET /api/attachments/[id]/image`.

## Database Safety ⚠️

`render_db.public` is **shared with Kaku Log**. Destructive schema operations will delete tables owned by the other project.

- Production schema changes: `prisma migrate deploy` only.
- **Never run** against the Render/shared database:
  - `prisma db push`
  - `prisma db push --accept-data-loss`
  - `prisma db push --force-reset`
  - `prisma migrate reset`
- Do not add a new Render database unless explicitly asked.

## Validation

- Default: `npm run typecheck` and `npm run lint`.
- On `render.yaml` changes: `render blueprints validate`.
- On Prisma schema/migration changes: `npx prisma validate`.
- For UI/layout/styling changes: verify with the Codex in-app Browser plugin at the relevant viewport.
- Do not run Playwright/E2E tests unless explicitly asked.

## Local Dev

Docker must be running before starting local dev.
Local PostgreSQL runs in Docker container `pg17-dev` and exposes `localhost:5432` for the `.env` `DATABASE_URL`.
