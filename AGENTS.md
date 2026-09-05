<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project

StudyMate is a privately used, personal AI gateway for accessing capable models from environments where signing in to the owner's personal AI accounts is inconvenient. It provides session chat, file attachments, image generation, and web search.

- Live URL: `https://studymate-lzki.onrender.com`
- Knowledge vault: `C:\Users\kakumine\Desktop\知識倉庫\Projects\StudyMate\StudyMate 当前状态.md`
- Tech stack: Next.js 16.2.6 App Router, React 19, Tailwind CSS v4, Prisma 7 / PostgreSQL, Render (free tier)

## Product Intent & Scope

- This is a personal utility for the owner's private use, not a public SaaS product or a general-purpose multi-user platform.
- Its primary purpose is convenient AI access at the owner's workplace without signing in to personal upstream AI accounts on that device.
- Keep the current anonymous, device-cookie-based session model unless the user explicitly requests an authentication redesign.
- Do not describe the signed device cookie as access control: it separates session ownership but does not prevent an unknown visitor from using the deployed service.
- Prefer changes that improve reliable, low-friction personal use over growth, onboarding, billing, organization, or collaboration features.

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
| `gpt-5.6-sol` | OpenAI | ✓ | ✓ | ✓ |
| `deepseek-v4-flash-vision-exp` | DeepSeek | ✓ | ✗ | ✓ (native `web_search`) |

**Rules:**
- Update `src/lib/models.ts` first when model behavior changes, then align frontend and API validation.
- GPT-5.6 Sol supports `none`, `low`, `medium`, `high`, `xhigh`, and `max` reasoning effort; the default is `medium`.
- DeepSeek-V4-Flash-Vision accepts image input but not image generation. Its Responses API reasoning effort supports `none`, `low`, `medium`, `high`, `xhigh`, and `max`; default is `high`.
- DeepSeek web search uses the Responses API server-side `web_search` tool. In `auto` mode, DeepSeek decides whether to search; `force` requires the tool and `off` omits it.
- Normal chat uses automatic web search: OpenAI and DeepSeek receive their provider-native `web_search` tool with automatic selection.
- OpenAI and DeepSeek chat both go through the Responses API (`/responses`). Neither provider uses a StudyMate-side search-result injection flow.
- Verified 2026-08-16 (via Render API): production sets `DEEPSEEK_BASE_URL=https://api.deepseek.com` (no `/v1`) and does NOT set `DEEPSEEK_FLASH_MODEL`/`DEEPSEEK_PRO_MODEL`, so upstream model IDs are the UI IDs `deepseek-v4-flash`/`deepseek-v4-pro` (both exist on the official API). Local `.env` matches (`https://api.deepseek.com`); both `/responses` and `/v1/responses` forms work (both return 200).
- Tavily is fully retired: zero references in `src/`, and `TAVILY_API_KEY` was removed from local `.env`, `render.yaml`, and production (verified 2026-08-16). Do not reintroduce it.

## Chat System Prompt

The single source of truth is `buildInstructions(webSearchMode)` in `src/app/api/chat/route.ts`; both the OpenAI and DeepSeek branches call it, so the two providers always receive identical instructions. Base system prompt:

```text
You are StudyMate, a concise, friendly AI study assistant. Help users learn clearly.
Answer in the user's language unless they ask otherwise.
When speaking Japanese, do not use polite/formal Japanese; reply in a more casual style.
Format answers as clean Markdown: use short headings, bullets or numbered lists for grouped points, and fenced code blocks for code, commands, or config.
Do not use horizontal rules, repeated separator lines, or decorative dividers.
```

Both branches append this sentence when Web search mode is `auto`:

```text
Use web search when the answer depends on current, changing, niche, or uncertain information; skip it for stable knowledge you can answer reliably.
```

- DeepSeek's native search events are handled inside the final Responses stream; only `response.output_text.delta` is forwarded to the client.
- When changing the chat system prompt, edit `buildInstructions` only — never inline a separate copy in one provider branch — and update this section and `README.md`.

## API & Proxy Rules

- Production `OPENAI_BASE_URL` is a compatible proxy.
- Verified 2026-07-14: the production proxy does not expose `POST /conversations` (plain `404`). HTTP `POST /responses` rejects `previous_response_id` with `previous_response_id is only supported on Responses WebSocket v2`. `wss://sub.khurio.art/v1/responses` accepts the WebSocket upgrade, but four probes were closed with `1013 no available account`; do not depend on either stateful path unless proxy support changes and is revalidated.
- **Do not use `/responses` for image generation** — the proxy can return Cloudflare/HTML errors for synchronous calls.
- `/api/images` always uses `/images/generations` (text-only) or `/images/edits` (reference images).
- Non-ASCII strings in `/responses` JSON must be sent as `\uXXXX` escapes — raw UTF-8 can be corrupted by the proxy.
- Image generation is an explicit UI mode triggered by the user; never infer it from prompt text.
- Leave unspecified `size`/`quality` as `auto`.

## Notion Integration

- Notion export uses the direct Notion REST API from the Next.js backend, not MCP.
- Required env vars:
  - `NOTION_API_KEY`
  - `NOTION_DATABASE_ID`
- `/api/notion/pages` writes a new row/page into the fixed Notion database.
- StudyMate Notion database verified 2026-06-29:
  - Database title: `Studymate Inbox`
  - Database ID: `38e987fd085480298f03ecfcf68764a3`
  - Current title property: `名前`
- First version is text-only: edited title/content are written as Notion page body paragraphs; attachment binaries are not uploaded.

## Data & Storage

- Keep image binaries out of PostgreSQL. Store only metadata and `imageStoragePath` in the `Attachment` table.
- Text files and PDFs are extracted as text context via `src/lib/files.ts`.
- Images served from local storage via `GET /api/attachments/[id]/image`.

## Database Safety ⚠️

StudyMate production uses Neon PostgreSQL, verified 2026-06-16.

- Provider/platform: Neon
- Environment: production
- Database: `neondb`, schema `studymate`
- Host: `ep-frosty-pond-at27m4s8-pooler.c-9.us-east-1.aws.neon.tech`
- Render service `studymate` (`srv-d89gl33bc2fs73f78fc0`) has `DATABASE_URL` set as a direct secret env var.
- Current Render `DATABASE_URL` includes `schema=studymate`, but the runtime `pg` search path still resolves to `public`; ensure app connections set `search_path=studymate` or move/query tables consistently before assuming production chat persistence works.
- `render.yaml` must keep `DATABASE_URL` as `sync: false`; do not point it back to Render `fromDatabase`.
- Production schema changes: `prisma migrate deploy` only.
- `npm run prisma:migrate` retries only transient Neon connection failures (`P1001`/`P1002`) up to five times; non-connection migration errors fail immediately.
- Do not run destructive Prisma commands against production:
  - `prisma db push`
  - `prisma db push --accept-data-loss`
  - `prisma db push --force-reset`
  - `prisma migrate reset`
- Old Render Postgres `render_db` (`dpg-d82rmsn2gups7397v0t0-a`) is still shared with Kaku Log, expired at `2026-06-13T12:09:22Z`, and is currently `suspended` by `billing`. Do not use it for StudyMate unless explicitly asked.

## Validation

- Default: `npm test`, `npm run typecheck`, and `npm run lint`.
- On `render.yaml` changes: `render blueprints validate`.
- On Prisma schema/migration changes: `npx prisma validate`.
- For UI/layout/styling changes: verify with the Codex in-app Browser plugin at the relevant viewport.
- Do not run Playwright/E2E tests unless explicitly asked.

## Local Dev

Docker must be running before starting local dev.
Local PostgreSQL 18.4 runs in Docker container `studymate-pg18-dev` and exposes `localhost:5432` for the `.env` `DATABASE_URL`.
It uses database `studymate`, schema `public`, and Docker volume `postgres18-docker_pg18-data` mounted at `/var/lib/postgresql`.
Initialize or update the local schema with `npx prisma migrate deploy`; do not expect a newly created container/volume to contain application tables.
