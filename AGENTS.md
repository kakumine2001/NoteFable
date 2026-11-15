# NoteFable Agent Guide

Next.js 16 App Router, React 19, Tailwind v4, Prisma 7, Neon PostgreSQL, Vercel, Private Vercel Blob, OpenAI / Anthropic / DeepSeek. Architecture and ops: `README.md`, `docs/architecture/` (maintained docs; update them in the same change when behavior, schema, env vars, hosting, storage or auth change).

## Working Rules

- Discussion produces a reviewable plan in chat; an implementation request goes straight to local changes, checks and a local preview. No plan or analysis files unless asked.
- Read the area's doc before exploring code: `docs/architecture/` covers chat-flow, image-flow, notes-flow, provider-requests, database, deployment, i18n, android and android-native.
- Production deploys only by merging a PR that passed the review flow (Review and Validation). Never push to `main` directly or deploy any other way unless the user asks in the current chat.
- UI: inspect the existing screen and keep its language, spacing and motion. Translate UI via `useT()` / `useI18n()`, mark constant text with `msg()`, update both zh and ja dictionaries (`docs/architecture/i18n.md`).
- Keep `/` and `/app` static under `src/app/[locale]/`; no cookies or headers in layouts. Regenerate `zh-hant.ts` after dictionary changes; close mobile drawers outside `runTransition`.
- No secrets in code or docs; provider credentials stay server-side.

## Branches and Parallel Agents

Several agents work on this repo at the same time. These rules keep their work from colliding.

- One task, one branch, one worktree. Start with `npm run git:cleanup` (fetches, removes merged worktrees and branches) and `git worktree list`, then cut the branch from `origin/main` in its own worktree and name it after the task. Don't start a task in a checkout that holds another task's uncommitted changes, and don't put two features on one branch.
- Before building something, check `origin/main` and the open branches for it: another agent may already have shipped it.
- One writing agent per worktree. A second agent on the same task reviews; it does not edit the same files.
- Commit on the task branch as soon as a unit of work passes its checks; don't leave finished work uncommitted. Never commit, stash or revert another agent's uncommitted changes.
- Keep branches short-lived. Merge with a merge commit (no squash or rebase), so the cleanup can tell the branch is merged.
- The agent that merges cleans up in the same turn, from the main checkout (it can't remove the worktree it runs in): `npm run git:cleanup` removes the worktree, the local branch and `origin/<branch>`, and fast-forwards the main checkout. It skips anything with uncommitted changes or unmerged commits and lists it; resolve those, don't leave them. A merged branch is finished: new work goes on a new branch.

## Auth

- Keep the anonymous signed device-cookie model unless an auth redesign is requested. It separates ownership; it is not access control. No public multi-user features unless requested.
- Optional Google login (Auth.js, JWT, no DB adapter) links to `User` via `googleSub`: key on the provider account id, never `token.sub`. A device cookie pointing at a Google-linked row must not be served anonymously.
- Daily usage limits: plans in `src/lib/usage-plans.ts`, enforcement in `src/lib/usage-limits.ts`. Preserve rejected drafts across sign-in and navigation.

## Models and API

- `src/lib/models.ts` defines the built-in models, capabilities and reasoning levels. The server decides which are offered through `NOTEFABLE_MODELS` (`src/lib/model-registry.ts`, format in `docs/architecture/deployment.md`); web and Android take the list from the server (`ModelsProvider`, `GET /api/models`) and never hard-code it. Server code reads models through `getModelRegistry()`.
- Provider routing and request code stay in code: an env-defined model can only reuse an existing provider. After changing `models.ts`, regenerate the Android fallback with `scripts/gen-native-models.ts`.
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
- Image binaries live in Private Vercel Blob (`BLOB_READ_WRITE_TOKEN` on Vercel; local falls back to `NOTEFABLE_STORAGE_DIR`); Postgres holds metadata only. Serve via `/api/attachments/[id]/image` with an ownership check and a short-lived single-image redirect; never give the browser a wildcard read token.

## Database

- Production: Neon, db `neondb`, schema `notefable`. Schema changes only via `npm run prisma:migrate` / `prisma migrate deploy` (Vercel runs it before build).
- Never run `prisma db push` (any flags) or `prisma migrate reset` against production.
- Don't point Preview deployments at the production database.

## Android

- `mobile/android/` is the only Android client (Kotlin/Compose, see `docs/architecture/android-native.md`); the old Capacitor wrapper was removed. `mobile/` holds only native clients: `android/` and `ios/` (native iOS, not started); no cross-platform shells. Native UI must replicate the web UI: measure the web first (CSS, computed styles at 412x915, i18n dictionaries), never invent styling, dark mode or copy; leave out controls that have no working feature yet. When the web UI changes, native must match before the next APK is delivered: batch the catch-up there instead of building an APK per web tweak, and say in the final report which web changes native still lacks.
- Don't commit APKs, build outputs or `local.properties` (use forward slashes for `sdk.dir`).
- Every delivered APK goes to the Google Drive release folder in `docs/architecture/android.md`, and the folder holds exactly one APK: the latest. Upload the new one, verify size and folder, then move all older APKs to the trash and return the link.
- `globals.css` rules are unlayered and beat Tailwind utilities: restyle at breakpoints with an equal-or-higher-specificity `@media` rule placed after, not `hidden` / `sm:hidden`. Panels needing the Back key push a history entry (`use-back-to-close.ts`).
- Native Google login: token audience is the Web client ID.

## Review and Validation

Match the effort to the change. The full suite and the review run once per task, at the end, not after every edit.

| Change | Checks | Review effort |
| --- | --- | --- |
| Docs and comments only | none | none: commit, PR, merge |
| Dictionary text only | `npm run typecheck` | none: commit, PR, merge |
| Other code | `npx vitest run <file>` while iterating; `npm test`, `npm run typecheck`, `npm run lint` once at the end | `high` |
| Auth, database and migrations, storage, API routes, usage limits, model routing | the same, plus `npx prisma validate` for schema changes | `xhigh` |

Every task that needs review goes through the same flow:

1. Self-review: when the checks pass, review your own diff with your built-in reviewer (Claude Code: `/code-review <effort>`; Codex: `codex review --uncommitted`). Verify each finding, fix the valid ones, rerun the checks, commit.
2. PR: bring `origin/main` in, push the branch, open a PR.
3. Cross-review: the other agent reviews the PR read-only, with fresh context and only the requirements, the PR diff and these rules. Claude Code → `codex review -c review_model='"gpt-6.1-sol"' -c model_reasoning_effort='"<effort>"' --base origin/main`; Codex → `claude -p --model claude-sonnet-5-5 --effort <effort> "/code-review <effort> <PR number>"`. Verify the findings, fix the valid ones, push. Review again only when a fix changed behavior beyond what the finding asked for.
4. Merge: once the cross-review has no open valid findings and the checks pass, merge the PR into `main` with a merge commit (`gh pr merge --merge`), then run `npm run git:cleanup`. Merging deploys production; this flow is the release approval, so don't push to `main` any other way.
- Other cross-calls (questions, second opinions): Claude Code → Codex `codex exec -m gpt-6.1-sol -c model_reasoning_effort=high ...`; Codex → Claude Code `claude -p --model claude-sonnet-5-5 --effort high ...`.
- Verify UI changes in a browser. No Playwright/E2E unless asked.

## Keep This File Small

Durable rules only. No dated notes, probe results, retired infrastructure, personal paths, secrets or IDs, or copies of docs; put explanations in `README.md` / `docs/architecture/`.
