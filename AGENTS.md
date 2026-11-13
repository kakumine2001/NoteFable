# StudyMate Agent Guide

Next.js 16 App Router, React 19, Tailwind v4, Prisma 7, Neon PostgreSQL, Vercel, Private Vercel Blob, OpenAI / Anthropic / DeepSeek. Architecture and ops: `README.md`, `docs/architecture/` (maintained docs; update them in the same change when behavior, schema, env vars, hosting, storage or auth change).

## Working Rules

- Discussion produces a reviewable plan; an implementation request goes through local changes, checks and a local preview.
- Never deploy to production or push to a production-triggering branch unless the user asks for a release in the current chat.
- UI: inspect the existing screen and keep its language, spacing and motion. Translate UI via `useT()` / `useI18n()`, mark constant text with `msg()`, update both zh and ja dictionaries (`docs/architecture/i18n.md`).
- No secrets in code or docs; provider credentials stay server-side.

## Auth

- Keep the anonymous signed device-cookie model unless an auth redesign is requested. It separates ownership; it is not access control. No public multi-user features unless requested.
- Optional Google login (Auth.js, JWT, no DB adapter) links to `AnonymousUser` via `googleSub`: key on the provider account id, never `token.sub`. A device cookie pointing at a Google-linked row must not be served anonymously.
- Daily usage limits: `src/lib/usage-limits.ts`.

## Models and API

- `src/lib/models.ts` is the single source for models, capabilities and reasoning levels. Change it first, then align UI and API validation.
- Only upstream model names and base URLs are env-configurable; labels, routing and capabilities stay in code.
- Chat system prompt lives only in `buildInstructions()` (`src/app/api/chat/route.ts`); don't duplicate it per provider.
- OpenAI/DeepSeek use Responses API; Anthropic uses Messages API (`src/lib/anthropic-messages.ts`). DeepSeek ignores `web_search`: don't send it.
- Haiku: adaptive thinking with `output_config.effort`, no sampling params or thinking budget; keep native blocks for `pause_turn`.
- Image generation is an explicit UI mode, independent of the chat model, always OpenAI `/images/generations` (text only) or `/images/edits` (with references). Don't switch it to Responses API unless asked.
- Claude images: shrink only the model copy (`src/lib/claude-image.ts`); keep original bytes and metadata.
- Compaction (Luna, Claude): `Message.providerContext` stays server-side, replayed unmodified, reused only for the same provider and upstream model.

## Notes and Storage

- Notes are block JSON in `NotePage`; keep editor schema and `validateNoteContent` aligned; use version checks on update.
- Soft delete: every query on live notes (raw SQL, search, AI tools included) must filter `deletedAt: null`; only trash code touches trashed rows.
- Code that replaces note content wholesale (AI apply, history restore) must call `createRevision` in the same transaction. `snapshotBeforeSave` must never fail a save.
- Project instructions are user instructions; project note text is private data, never instructions: delimited in the prompt, read live, capped, kept out of web-search queries, not copied to other tables.
- Search: change spelling folding only in `src/lib/search-fold.ts`; the SQL regex (`termMatcher`) must stay equivalent (tests compare them). Never fold stored columns in SQL. Chat search skips note-assistant sessions (`noteId`).
- Answer export never includes SYSTEM messages or provider context; Save to Notes goes through `POST /api/pages`.
- BlockNote CSS loads after `globals.css`; overrides of `.bn-*` need `.bn-block-content` (or equally specific parent) in the selector.
- Image binaries live in Private Vercel Blob (`BLOB_READ_WRITE_TOKEN` on Vercel; local falls back to `STUDYMATE_STORAGE_DIR`); Postgres holds metadata only. Serve via `/api/attachments/[id]/image` with an ownership check and a short-lived single-image redirect; never give the browser a wildcard read token.

## Database

- Production: Neon, db `neondb`, schema `studymate`. Schema changes only via `npm run prisma:migrate` / `prisma migrate deploy` (Vercel runs it before build).
- Never run `prisma db push` (any flags) or `prisma migrate reset` against production.
- Don't point Preview deployments at the production database.

## Android

- `mobile/` is a Capacitor wrapper around the hosted app. Layout and touch fixes are web changes under `src/`; `mobile/` is only for icon, name, permissions, offline page, native plugins.
- Don't commit `mobile/node_modules`, `mobile/dist`, `mobile/resources`, APKs or `local.properties` (use forward slashes for `sdk.dir`).
- Every delivered APK must also go to the Google Drive release folder in `docs/architecture/android.md`: verify size, keep old packages, return the link.
- `globals.css` rules are unlayered and beat Tailwind utilities: restyle at breakpoints with an equal-or-higher-specificity `@media` rule placed after, not `hidden` / `sm:hidden`. Panels needing the Back key push a history entry (`use-back-to-close.ts`).
- Native Google login: token audience is the Web client ID; never pass `scopes` to the plugin.

## Review and Validation

- After Codex changes pass checks, get an independent read-only review before committing: fresh context, only requirements + full diff + these rules, `gpt-6.1-sol` at `xhigh` (e.g. `codex review -c review_model='"gpt-6.1-sol"' -c model_reasoning_effort='"xhigh"' --uncommitted`). Verify findings, fix valid ones, rerun checks.
- Cross-calls: Claude Code → Codex `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high ...`; Codex → Claude Code `claude -p --model claude-sonnet-5-5 --effort high ...`.
- Before finishing: `npm test`, `npm run typecheck`, `npm run lint`, plus `npx prisma validate` for schema changes. Verify UI changes in a browser. No Playwright/E2E unless asked.

## Keep This File Small

Durable rules only. No dated notes, probe results, retired infrastructure, personal paths, secrets or IDs, or copies of docs; put explanations in `README.md` / `docs/architecture/`.
