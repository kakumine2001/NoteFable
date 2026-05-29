<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Project Notes

- Keep this file short. Store detailed project structure, deployment notes, and current decisions in the Obsidian vault instead. When local files and the vault disagree, treat the repo files as current.
- Current StudyMate knowledge note: `C:\Users\kakumine\Desktop\知識倉庫\Projects\StudyMate\StudyMate 当前状态.md`
- Tech stack: Next.js 16 App Router, React 19, Tailwind CSS v4, Prisma 7/PostgreSQL, OpenAI Responses API, DeepSeek Chat Completions API, and Render.
- Model capabilities are centralized in `src/lib/models.ts`. Update that file first when model behavior changes, then keep frontend and API validation aligned with it.
- DeepSeek is text-only in this project. Do not enable image input or image generation for DeepSeek models. DeepSeek web search, when enabled, uses Tavily results as text context.
- OpenAI handles normal text/image-input chat through `/api/chat`; image generation is an explicit UI mode and goes through `/api/images`. Do not infer image generation from prompt text.
- Text-like files and PDFs are extracted as text context. Image files are stored through `src/lib/storage.ts`; keep image binaries out of PostgreSQL and store only metadata/storage paths.
- Render config lives in `render.yaml` and currently uses the existing `render_db` through `DATABASE_URL`. Do not add a new Render database unless explicitly asked.

## Validation

- Prefer simple validation by default: `npm run typecheck` and `npm run lint`.
- Run `render blueprints validate` when `render.yaml` changes.
- Run `npx prisma validate` when Prisma schema or migrations change.
- For frontend source, UI layout, styling, responsive behavior, or visual appearance changes, verify the requested behavior with the Codex in-app Browser plugin. Check the relevant viewport instead of relying only on code inspection.
- Do not run Playwright/E2E/deep browser test suites by default unless the user asks.
