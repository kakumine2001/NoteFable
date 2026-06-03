# StudyMate UI Audit

Date: 2026-06-03
Scope: main chat UI, model menu, typed input, mobile empty state, mobile sidebar.

## Screenshots

1. `01-empty-main.png` - Desktop empty chat screen.
2. `02-model-menu.png` - Desktop model selector menu.
3. `03-typed-input.png` - Desktop input with drafted text.
4. `04-mobile-empty.png` - Mobile empty chat screen.
5. `05-mobile-sidebar.png` - Mobile sidebar overlay.

## Findings

1. Empty state is too empty.
   - Evidence: desktop and mobile empty screens show only background and bottom composer.
   - Source: `src/app/page.tsx` renders only `<div className="flex-1" />` for empty messages.
   - Impact: new users get no hint that StudyMate can summarize files, create review questions, use web search, or generate images.

2. Mobile composer is crowded.
   - Evidence: at 390px width, attachment, model, reasoning, web search, image mode, and send controls all sit in a compact bottom panel.
   - Impact: controls are technically reachable, but the primary action is visually competing with secondary settings.

3. Icon-only controls rely too much on hidden labels.
   - Evidence: Web search, image generation, attachment, send, and sidebar controls are mostly icon-only.
   - Source: controls have aria labels and titles, but no visible text.
   - Impact: accessibility metadata is present, but first-time users may not understand what each mode changes.

4. Model menu is clear but visually detached from the task.
   - Evidence: the model menu has readable labels and descriptions, but opens as a floating panel above the composer.
   - Impact: usable on desktop; on smaller screens it needs careful testing because it competes with the fixed composer area.

5. Visual identity is coherent.
   - Evidence: logo, soft background, rounded composer, and muted control colors are consistent.
   - Impact: the app feels calm and study-oriented, but the large empty canvas currently makes the product feel unfinished before the first message.

## Accessibility Risks

1. Empty textarea has no placeholder and no visible label.
   - Source: `src/app/page.tsx` uses `placeholder=""`.
   - Risk: screen reader users may see a generic textbox; sighted users see no prompt.

2. Menu buttons expose `aria-haspopup` and `aria-expanded`, but the button labels are only the current value.
   - Risk: "GPT-5.5" and "Medium" may not be enough context by themselves.

3. Color-only active mode states may be hard to distinguish.
   - Source: web search and image generation active states change background color.
   - Risk: users with low vision may miss whether a mode is enabled unless they inspect the icon state.

## Limits

- Database connection failed locally for `/api/sessions`, so saved session list behavior could not be reviewed.
- No message was submitted; streaming, response layout, error states, generated image results, and attachment previews were not audited in this pass.
- Screenshots are from local dev mode. The black Next.js dev tools button visible near the bottom-left is dev-only, not a production UI issue.
