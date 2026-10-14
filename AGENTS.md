# StudyMate Agent Guide

## Project

Tech stack: Next.js 16 App Router, React 19, Tailwind CSS v4, Prisma 7, Neon PostgreSQL, Vercel, Private Vercel Blob, OpenAI, Anthropic, and DeepSeek.

## Task and Context Routing

- Start from the current request: research/design discussion produces a reviewable plan; an implementation request proceeds through relevant validation within its authorized scope.
- UI changes preserve the established product language, spacing and motion. Inspect the existing implementation and actual screen before adapting controls; do not apply a global visual profile automatically.
- Production URLs, environment setup and operational details are maintained in [README.md](README.md) and `docs/architecture/`. Verify the actual deployment when diagnosing production; do not maintain a second URL or deployment SHA here.
- Model/API changes: read the source-of-truth table and Model and API Rules below. Storage/auth/database changes: read the corresponding rules and maintained architecture documents.

## Scope Rules

- Keep the current anonymous device-cookie session model unless the user explicitly asks for an authentication redesign.
- The signed device cookie separates session ownership; it is not real access control. Optional Google login (Auth.js, JWT sessions, no DB adapter) links a Google account to an `AnonymousUser` row via `googleSub`; key it on the provider account id, never on `token.sub`. A device cookie that points at a Google-linked row must not be served anonymously (signed-out browsers get a fresh anonymous user).
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
| Anonymous identity and Google-linked user | `src/lib/auth.ts` |
| Profile (display name, emoji icon, uploaded photo) and the shared account state | `src/lib/user-profile.ts`, `src/lib/account-store.ts`, `src/app/api/account/*`, `src/components/account-button.tsx`, `src/components/profile-menu.tsx` |
| Google login (Auth.js) | `src/lib/google-auth.ts`, `src/app/api/auth/[...nextauth]/route.ts` |
| Google login inside the Android app | `src/lib/native-google-login.ts`, `src/app/api/native-auth/*`, `src/lib/native-app.ts` |
| Chat flow and system instructions | `src/app/api/chat/route.ts` |
| Chat organization (manual titles, pins, independent projects) | `src/components/chat-sidebar.tsx`, `src/components/chat-actions.tsx`, `src/lib/session-organization-sync.ts`, `src/app/api/sessions/*`, `src/app/api/chat-projects/*` |
| Chat tools (Notes search/read/propose edit/propose create) and tool loops | `src/lib/page-tools.ts`, `src/lib/page-edit.ts`, `src/lib/note-markdown.ts`, `src/lib/chat-tools.ts`, `src/lib/responses-tool-loop.ts` |
| Image generation | `src/app/api/images/route.ts` |
| File and attachment handling | `src/lib/files.ts`, `src/lib/client-chat-upload.ts`, `src/lib/chat-upload-ticket.ts`, `src/lib/chat-uploads.ts`, `src/app/api/uploads/*` |
| Image storage | `src/lib/storage.ts` |
| Database connection/schema | `src/lib/prisma.ts` |
| Database models | `prisma/schema.prisma` |
| Internal pages and autosave | `src/lib/note-document.ts`, `src/lib/note-save-queue.ts`, `src/app/api/pages/*` |
| Note AI assistant (inside a note) | `src/components/note-assistant.tsx`, `noteId` handling in `src/app/api/chat/route.ts`, `Session.noteId` |
| Note images/files and groups | `src/lib/note-file-keys.ts`, `src/lib/note-attachments.ts`, `src/lib/note-files.ts`, `src/app/api/pages/files`, `src/lib/note-groups.ts`, `src/app/api/pages/groups` |
| Human-readable architecture | `README.md` and `docs/architecture/` |

## Model and API Rules

- Treat `src/lib/models.ts` as the single source of truth for supported models, capabilities, and reasoning levels.
- Update model definitions first, then align frontend and API validation.
- Only the upstream model name (`OPENAI_TEXT_MODEL`, `OPENAI_IMAGE_MODEL`, `DEEPSEEK_FLASH_MODEL`, `ANTHROPIC_HAIKU_MODEL`) and provider base URL are environment-configurable. Display labels, provider routing, capabilities, and reasoning levels stay in code so client and API keep one contract.
- OpenAI and DeepSeek chat use their Responses API paths; Anthropic uses Messages API via `src/lib/anthropic-messages.ts`. OpenAI and Anthropic use provider-native web search; the current DeepSeek API ignores built-in `web_search`. Do not advertise or send unsupported search tools.
- Haiku uses adaptive thinking with `output_config.effort`; do not send sampling parameters or the old thinking token budget. Preserve native content blocks for `pause_turn` continuation, and include search citations in the saved answer.
- The shared chat system instructions live in `buildInstructions()` inside `src/app/api/chat/route.ts`. Do not duplicate the prompt in provider-specific branches or in this file.
- Image generation is an explicit UI mode. Do not infer image generation from normal chat prompt text. It is independent of the selected chat model: every model can use it, and `/api/images` always calls the OpenAI image endpoints; the selected model is only recorded with the saved message.
- `/api/images` uses `/images/generations` for text-only generation and `/images/edits` when reference images are supplied.
- Do not switch image generation to the Responses API unless the user explicitly asks for that redesign and the current upstream compatibility is revalidated.
- Keep provider-specific differences behind shared helpers where possible.
- Claude image inputs use `src/lib/claude-image.ts` to fit provider transport budgets. Preserve original bytes and attachment metadata for storage/preview; optimize only the model copy for both current and historical images. Do not treat internal compressed-image budgets as raw upload limits.
- Native chat compaction is enabled for Luna and Claude. Keep `Message.providerContext` server-side, replay native items without rewriting them, and reuse checkpoints only for the same provider and upstream model; preserve the visible transcript.

## Storage

- Internal Notes store native block JSON in `NotePage`, scoped to `AnonymousUser`. Keep the editor schema and server block validation aligned; use version checks for updates. Local draft caches do not replace server persistence or provide identity recovery.

- BlockNote's own CSS loads after `globals.css` with equal specificity. When overriding `.bn-*` elements in the editor, include `.bn-block-content` (or an equally specific parent) in the selector or the override is silently ignored.
- Production image binaries are stored in Private Vercel Blob through `@vercel/blob`.
- `BLOB_READ_WRITE_TOKEN` is required on Vercel.
- Local development may fall back to `STUDYMATE_STORAGE_DIR` when the Blob token is absent.
- PostgreSQL stores attachment metadata and `imageStoragePath`, not image binaries.
- Images are served through `/api/attachments/[id]/image`, which checks anonymous ownership before returning a short-lived, single-image private Blob read redirect (or local image bytes). Never grant a wildcard read token to the browser.

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

## Android

- `mobile/` is a Capacitor wrapper that opens the hosted web app. Mobile layout and touch behavior are web changes under `src/`; only app-level things (icon, name, permissions, offline page, native plugins) belong in `mobile/`. Native UI, if ever built, gets its own directory under `mobile/`.
- Do not commit `mobile/node_modules`, `mobile/dist`, `mobile/resources`, APKs or `local.properties`. In `local.properties` write `sdk.dir` with forward slashes on Windows.
- Phone layout (under 640px) lives in the same codebase as desktop. `globals.css` rules are unlayered and beat Tailwind utilities, so hide or restyle a class-styled element at a breakpoint with a `@media` rule of equal or higher specificity placed after it, not with `hidden` / `sm:hidden`. Panels that need the Android Back key (drawer, bottom sheets) push a history entry; see `use-back-to-close.ts`.
- Setup, build, limits and the in-app Google login flow (the token audience is the Web client ID; never pass `scopes` to the plugin) are in [docs/architecture/android.md](docs/architecture/android.md).

## Cross-Agent Calls

- For the current review workflow, use Grok 4.7 through Cursor CLI: `agent -p --model grok-4.7-medium --mode ask --trust --workspace <repo> <prompt>`. Review the full affected diff read-only, verify and fix its findings, then commit and deploy only after relevant checks pass. Keep this reviewer until the user requests a change.

Pin these models when Codex and Claude Code call each other in this project, unless the user names another:

- Claude Code calling Codex for review: `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high ...`
- Codex calling Claude Code: `claude -p --model claude-sonnet-5-5 --effort high ...`

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
