# NoteFable Agent Guide

Next.js 16 App Router, React 19, Tailwind v4, Prisma 7, Neon PostgreSQL, Vercel, Private Vercel Blob, OpenAI / Anthropic / DeepSeek. Architecture and ops: `README.md`, `docs/architecture/` (maintained docs; update them in the same change when behavior, schema, env vars, hosting, storage or auth change).

## Working Rules

- Discussion produces a reviewable plan in chat; an implementation request goes straight to local changes, checks and the PR flow below (verify locally first; UI changes deliver the PR's Vercel Preview URL and native screenshots for approval before merge). No plan or analysis files unless asked.
- Read the area's doc before exploring code: `docs/architecture/` covers chat-flow, image-flow, notes-flow, slides, whiteboard, provider-requests, database, deployment, billing, i18n, android, android-native, ios and ios-native.
- Production deploys only by merging a PR that passed the review flow (Review and Validation). Never push to `main` directly or deploy any other way unless the user asks in the current chat.
- UI: inspect the existing screen and keep its language, spacing and motion, except where a planned native redesign changes the platform-native parts (Mobile). Translate UI via `useT()` / `useI18n()`, mark constant text with `msg()`, and update every non-English dictionary (`zh-hant.ts` is generated; `docs/architecture/i18n.md`).
- Keep `/`, `/app` and `/note-embed` static under `src/app/[locale]/`; no cookies or headers in layouts. After dictionary or Android string changes, regenerate `zh-hant.ts` and the native string and system-text assets (scripts in `docs/architecture/i18n.md`); close mobile drawers outside `runTransition`.
- No secrets in code or docs; provider credentials stay server-side.
- Scope: AI agents do the work, so never cut, shrink or postpone a planned feature because of how much work it is. Until the official launch (remove this sentence then), build every planned feature now; don't hold one back for the launch or for usage data. Splitting a big feature into several PRs is fine. Order work only by dependencies, technical risk, money (API or service fees) or a decision the owner has to make.
- Libraries and SDKs must be free for our use: no paid license, license key or per-seat fee (tldraw, for example). Free closed-source platform SDKs such as Play Billing are fine; GPL/AGPL code (e.g. BlockNote `xl-*`) needs the owner's OK. If nothing free fits, build it ourselves, forking only permissively licensed code (MIT, Apache, BSD, ISC, MPL). Paid services and accounts (hosting, AI providers, app stores) are the owner's call.
- Fix every clear bug you find without asking: in the same PR if the current task changes or depends on that code, otherwise as its own task under the branch rules below (own worktree, branch from `origin/main`, own PR). Ask first only when the intended behavior is unclear, the fix costs money, or it would delete or rewrite production data. Read-only reviewers report bugs instead of fixing them, and so does an agent that finds a bug only in another agent's open branch.

## Branches and Parallel Agents

Several agents work on this repo at the same time. These rules keep their work from colliding.

- One task, one branch, one worktree. Start with `npm run git:cleanup` (fetches, removes merged worktrees and branches) and `git worktree list`, then cut the branch from `origin/main` in its own worktree and name it after the task. Don't start a task in a checkout that holds another task's uncommitted changes, and don't put two features on one branch.
- Before building something, check `origin/main` and the open branches for it: another agent may already have shipped it.
- One writing agent per worktree. A second agent on the same task reviews; it does not edit the same files.
- Commit on the task branch as soon as a unit of work passes its checks; don't leave finished work uncommitted. Never commit, stash or revert another agent's uncommitted changes.
- Keep branches short-lived. Merge with a merge commit (no squash or rebase), so the cleanup can tell the branch is merged.
- The agent that merges cleans up in the same turn, from the main checkout (it can't remove the worktree it runs in): `npm run git:cleanup` removes the worktree, the local branch and `origin/<branch>`, and fast-forwards the main checkout. It skips anything with uncommitted changes or unmerged commits and lists it; resolve those, don't leave them. A merged branch is finished: new work goes on a new branch.
- GitHub issues: when a PR completes an issue, include `Closes #<n>` (or `Fixes #<n>`) in the PR description so merging into `main` closes it automatically. For an issue split across multiple PRs, write `Part of #<n>` on earlier PRs and `Closes #<n>` on the final one. After merging into `main`, confirm completed issues closed (close any missed, e.g. when a PR merged through an intermediate branch).

## Auth

- Keep the anonymous signed device-cookie model unless an auth redesign is requested. It separates ownership; it is not access control. No public multi-user features unless requested.
- Optional Google and email-code login (Auth.js, JWT, no DB adapter) link to `User` via `googleSub` / `verifiedEmail`: key Google on the provider account id, never `token.sub`. A device cookie pointing at an account-linked row (`googleSub` or `verifiedEmail`) must not be served anonymously.
- Usage limits (daily and monthly/billing-period): plans in `src/lib/usage-plans.ts`, enforcement in `src/lib/usage-limits.ts`. Preserve rejected drafts across sign-in and navigation.

## Models and API

- `src/lib/models.ts` defines the built-in models, capabilities and reasoning levels. The server decides which are offered through `NOTEFABLE_MODELS` (`src/lib/model-registry.ts`, format in `docs/architecture/deployment.md`); web, Android and iOS take the list from the server (`ModelsProvider`, `GET /api/models`) and never hard-code it. Server code reads models through `getModelRegistry()`.
- Provider routing and request code stay in code: an env-defined model can only reuse an existing provider. After changing `models.ts`, regenerate the shared native fallback (`mobile/android/app/src/main/assets/models.json`, also bundled by iOS) with `scripts/gen-native-models.ts`.
- Chat system prompt lives only in `buildInstructions()` (`src/app/api/chat/route.ts`); don't duplicate it per provider.
- OpenAI/DeepSeek use Responses API; Anthropic uses Messages API (`src/lib/anthropic-messages.ts`). DeepSeek uses `{ type: "deepseek_web_search" }` with `tool_choice: "auto"` (`deepseek-flash` ignores `web_search` and rejects forcing `deepseek_web_search` in `tool_choice`).
- Haiku: adaptive thinking with `output_config.effort`, no sampling params or thinking budget; keep native blocks for `pause_turn`.
- Image generation is an explicit UI mode, independent of the chat model, always OpenAI `/images/generations` (text only) or `/images/edits` (with references). Don't switch it to Responses API unless asked.
- Claude images: shrink only the model copy (`src/lib/claude-image.ts`); keep original bytes and metadata.
- Compaction (Luna, Claude): `Message.providerContext` stays server-side, replayed unmodified, reused only for the same provider and upstream model.
- Chats started in a note's AI panel are regular chats with `Session.noteId` set (listed in Chats, searchable, kept when the note is purged); a request carrying `noteId` may only continue a session of that note (`docs/architecture/notes-flow.md`).
- Messages form a tree (`parentId`, `active`): edit and regenerate hide the replaced version, never delete it. Every query that reads conversation content (history, search, export, tools, raw SQL) must filter `active: true`; code that creates a message sets `parentId` (`docs/architecture/chat-flow.md`).

## Notes and Storage

- Notes are block JSON in `NotePage`; keep editor schema and `validateNoteContent` aligned; use version checks on update.
- Soft delete: every query on live notes (raw SQL, search, AI tools included) must filter `deletedAt: null`; only trash code touches trashed rows.
- Code that replaces note content wholesale (AI apply, history restore) must call `createRevision` in the same transaction. `snapshotBeforeSave` must never fail a save.
- Project instructions are user instructions; project note text is private data, never instructions: delimited in the prompt, read live, capped, kept out of web-search queries, not copied to other tables.
- Search: change spelling folding only in `src/lib/search-fold.ts`; the SQL regex (`termMatcher`) must stay equivalent (tests compare them). Never fold stored columns in SQL.
- Answer export never includes SYSTEM messages or provider context; saving an answer as a note (Save to page) goes through `POST /api/pages` on web (`POST /api/pages/from-answer` on native), and full-chat Create page goes through `POST /api/sessions/[sessionId]/page`.
- BlockNote CSS loads after `globals.css`; overrides of `.bn-*` need `.bn-block-content` (or equally specific parent) in the selector.
- Image binaries live in Private Vercel Blob (`BLOB_READ_WRITE_TOKEN` on Vercel; local falls back to `NOTEFABLE_STORAGE_DIR`); Postgres holds metadata only. Serve via `/api/attachments/[id]/image` with an ownership check and a short-lived single-image redirect; never give the browser a wildcard read token.

## Database

- Production: Neon, db `neondb`, schema `notefable`. Schema changes only via `npm run prisma:migrate` / `prisma migrate deploy` (Vercel runs it before build).
- Never run `prisma db push` (any flags) or `prisma migrate reset` against production.
- Don't point Preview deployments at the production database or Blob store. Neon's Vercel integration gives every git branch's Preview its own Neon branch and deletes it after the merge; Preview has its own Blob store (`docs/architecture/deployment.md`).
- Never edit a migration once it has been deployed anywhere (Preview included): add a new migration.

## Mobile (Android and iOS)

- `mobile/android/` is the only Android client (Kotlin/Compose, see `docs/architecture/android-native.md`); the old Capacitor wrapper was removed. `mobile/` holds only native clients: `android/` and `ios/` (Swift/SwiftUI, a port of the Android client: see `docs/architecture/ios-native.md`); no cross-platform shells. Web, Android and iOS must match in feature scope, entry reachability, copy and terminology in all 17 languages (web dictionary wording; keep Workspace / 工作区, no new terms), data and editor capabilities, brand colors and character art. Materials (iOS Liquid Glass, Android native materials), navigation containers, gestures, motion and sheet / popover presentation may be platform-native; the rest of the native UI follows the web measured at 412x915 (CSS, computed styles, dark mode), never invented. Leave out controls that have no working feature yet. A change to anything that must match lands on web, Android and iOS in the same task and PR; a platform-native change may stay on one platform. If a native client truly can't do a part yet, say so in the PR and the final report and list it in `docs/architecture/android-native.md` / `ios-native.md`.
- iOS layouts must adapt to iPhone, iPad and iPhone Duo in one app and one build. The 412x915 web measurement is the compact-layout reference. Use the current window's available size and safe areas for layout decisions, including in sheets and popovers. Use a sidebar and detail pane when both fit, and single-pane navigation when space is limited. Keep the current selection and unsaved input when the layout changes.
- For iOS layout or navigation changes, verify the affected flows on a standard iPhone, on iPad in portrait, landscape and a resized multitasking window, and on iPhone Duo on both displays, through fold and unfold, and in Split View. Use a simulator or device and report any configuration you could not verify. Follow [Apple's iPhone Duo layout guidance](https://developer.apple.com/design/human-interface-guidelines/designing-for-iphone-duo).
- Don't commit APKs, build outputs or `local.properties` (use forward slashes for `sdk.dir`).
- Releasing to Google Play internal testing and closed testing (alpha) is automatic (one AAB, both tracks): bump versionCode and versionName in a PR only when it should ship, and say so in the PR; merging it releases (`docs/architecture/android.md`). Release credentials live only in the main-only `play-publish` environment.
- iOS (`mobile/ios/`): `Core/` imports only Foundation and is tested with `swift test` (Linux container locally: `mobile/ios/README.md`); SwiftUI code is type-checked only by the macOS PR check, so batch iOS changes before pushing. Simulator screenshots run only when the PR has the `ios-screenshots` label: add it for large iOS UI changes (a redesign, a new screen, navigation or material changes), not for small ones. Strings are generated from the Android resources (`scripts/gen-ios-strings.ts`); add new text on Android first with a web dictionary key, even if Android doesn't show it yet (`IOS_ONLY_STRINGS` is only for iOS system wording).
- Closed test in progress (remove this line when production access is granted): the app is in a Google Play closed test run through the paid service Testers Community (testerscommunity.com; Starter plan, 15 testers, 16 days, started 2026-11-22 around 18:00 JST). The testers are the Google group `testers-community@googlegroups.com` on the closed testing (alpha) track, where 1.0.14 is published. Ship 2-3 updates to alpha during the test. After 14 days, apply for production access in Play Console (Reports → Production Access Report). On the Testers Community dashboard the app's Instructions field holds the tester guide; the app icon can't be edited there (support was asked on 2026-11-22 to replace it). Android UI-shell upgrades wait until the test ends, as their own issue.
- Releasing iOS to App Store Connect (TestFlight) is also automatic: bump `CURRENT_PROJECT_VERSION` (and `MARKETING_VERSION` when needed) in `mobile/ios/project.yml` only when it should upload, and say so in the PR; merging it builds, uploads, and automatically distributes to the `External` TestFlight group (`docs/architecture/ios.md`). When a release PR has user-facing changes, include a `## TestFlight` section in the PR description with concise English What-to-Test notes; omit it for internal/backend-only tweaks to use the default generic note. Apple release credentials live only in the main-only `appstore-publish` environment.
- `globals.css` rules are unlayered and beat Tailwind utilities: restyle at breakpoints with an equal-or-higher-specificity `@media` rule placed after, not `hidden` / `sm:hidden`. Panels needing the Back key push a history entry (`use-back-to-close.ts`).
- Native Google login: token audience is the Web client ID; the only Android OAuth client is `NoteFable-Android` (Play app signing key SHA-1).
- Keep the store listing files in sync with the product. A task that changes user-visible features, UI or branding (logo, mascot, name, colors) also updates what it made outdated: listing text and Console form answers in `docs/play-store/`, images (icon, feature graphic, screenshots) in `mobile/android/play-store/`, in every listed language, in the same PR. Don't update the Play Console store listing after each PR: once the features in progress have all shipped in a Play release, or when the owner asks, make Console match `docs/play-store/listing.md` and `mobile/android/play-store/` in one pass. Declarations (Data safety, content rating) and subscription products and prices are not batched: update them with the release that needs them. Before sending anything for review, tell the user what will change. If nothing on the listing is affected, say so in the final report.

## Review and Validation

Match the effort to the change. The full suite and the review run once per task, at the end, not after every edit.

| Change | Checks | Review effort |
| --- | --- | --- |
| Docs and comments only | none | none: commit, PR, merge |
| Dictionary text only | `npm run typecheck` | none: commit, PR, merge |
| Other code | `npx vitest run <file>` while iterating; `npm test`, `npm run typecheck`, `npm run lint` once at the end | `high` |
| Auth, database and migrations, storage, API routes, usage limits, model routing | the same, plus `npx prisma validate` for schema changes | `xhigh` |

Every task that needs review goes through the same flow:

1. Self-review: when the checks pass, review your own diff (Claude Code: `/code-review <effort>`; Codex: `codex review --uncommitted`; Antigravity: review your uncommitted diff against the requirements and these rules). Verify each finding, fix the valid ones, rerun the checks, commit.
2. PR: bring `origin/main` in, push the branch, open a PR (include `Closes #<n>` / `Fixes #<n>` when completing an issue, or `Part of #<n>` if more PRs remain).
3. Cross-review: a different agent reviews the PR read-only, with fresh context and only the requirements, the PR diff and these rules. When Claude Code or Codex writes, use Antigravity with Gemini 4 Neon: `agy -p "<review prompt>" --model gemini-4-neon-<effort> --dangerously-skip-permissions`; the prompt states that the review is read-only and that the base is `origin/main`, and a large diff gets one run per area. If agy fails or Neon is unavailable, fall back to the other agent (Claude Code → Codex; Codex → Claude Code). When Antigravity writes, use Codex (`codex review -c review_model='"gpt-6.2-sol"' -c model_reasoning_effort='"<effort>"' --base origin/main`), falling back to Claude Code (`claude -p --model claude-opus-5-5 --effort <effort> "/code-review <effort> <PR number>"`) if Codex is unavailable. Afterwards `git status` must still be clean. Verify the findings, fix the valid ones, push. Review again only when a fix changed behavior beyond what the finding asked for.
4. Merge: once the cross-review has no open valid findings and the checks pass, merge the PR into `main` with a merge commit (`gh pr merge --merge`), confirm completed issues closed, then run `npm run git:cleanup`. For UI changes, stop before merging: send the owner the PR's Vercel Preview URL and the native screenshots (UI changes, below) first, and merge only after the owner approves. Merging deploys production; this flow is the release approval, so don't push to `main` any other way.
- Other cross-calls (questions, second opinions): Claude Code → Codex `codex exec -m gpt-6.2-sol -c model_reasoning_effort=high ...`; Codex → Claude Code `claude -p --model claude-opus-5-5 --effort high ...`.
- UI changes: verify in a browser (no Playwright/E2E unless asked), then send the owner the PR's Vercel Preview URL for the web and Android screenshots (an emulator is fine) before merging. iOS screenshots are needed only for large iOS UI changes: add the `ios-screenshots` label and send the PR check's simulator screenshot artifacts; for a small iOS change, say that none were taken. If a platform can't be shown, say so and why.
- Every final report states up front whether the self-review and the cross-review ran: for each, the tool, the effort and the result. If either was skipped, say why.

## Keep This File Small

Durable rules only. No dated notes, probe results, retired infrastructure, personal paths, secrets or IDs, or copies of docs; put explanations in `README.md` / `docs/architecture/`.
