import { isEmojiIcon } from "@/lib/emoji-icon";
import { validateCanvasPage } from "@/lib/canvas-document";
import { NoteValidationError } from "@/lib/note-document";
import { msg } from "@/lib/i18n/translate";
import { AdapterError, MAX_READ_CHARS, type PageAdapter } from "@/lib/page-ai/adapter";
import { readSlides } from "@/lib/page-ai/canvas-adapter";
import { canvasStorage } from "@/lib/page-ai/storage";
import { LAYOUT_IDS, SLIDE_TRANSITIONS } from "@/lib/slides/model";
import {
  applySlidesEdits,
  buildAiSlidesDeck,
  MAX_AI_CREATE_SLIDES,
  MAX_AI_SLIDES_OPS,
  SLIDE_THEME_IDS,
  SLIDE_THEME_MODES,
  SlidesEditError,
  type CreateSlideInput,
} from "@/lib/slides/ai-edit";

// スライド（幻灯片）の AI アダプター（SA2）。
// ツール名（propose_slides_create / propose_slides_edit）は履歴に残るため、公開後に変更しない。
// OpenAI / DeepSeek の strict: true と Anthropic Messages API の両方で通る JSON Schema を使い、座標は一切要求しない。

const SLIDES_CREATE_TOOL = {
  name: "propose_slides_create",
  description:
    `Propose a brand-new slide deck in the user's NoteFable Workspace. This does NOT create anything unless the user turned on auto-apply: the user sees a visual preview and must approve it, so never say the slide deck was created unless the tool result says it was applied. Never output pixel coordinates; layout and pagination are computed automatically on the server. Pass up to ${MAX_AI_CREATE_SLIDES} entries in \`slides\`; each entry becomes one slide (plus automatic continuation slides if body content overflows; put a cover slide first with layout="title" if desired). \`body\` supports Markdown (bullets, numbered lists, code blocks, LaTeX math $...$ / $$...$$, and GFM tables). \`theme\` picks one of the 8 built-in themes (${SLIDE_THEME_IDS.join(", ")}) and mode ("light" or "dark"). \`icon\` is a single emoji or null; \`parentId\` puts the deck inside another page or null for top-level.`,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Slide deck title (at most 200 characters)." },
      icon: { type: ["string", "null"], description: "A single emoji icon, or null." },
      parentId: { type: ["string", "null"], description: "Parent page ID to place the slide deck inside, or null." },
      theme: {
        type: "object",
        description: "Deck theme selection. Pass null for themeId or mode to use defaults (simple, light).",
        properties: {
          themeId: {
            type: ["string", "null"],
            enum: [...SLIDE_THEME_IDS, null],
            description: `One of the 8 built-in themes (${SLIDE_THEME_IDS.join(", ")}), or null for default.`,
          },
          mode: {
            type: ["string", "null"],
            enum: [...SLIDE_THEME_MODES, null],
            description: 'Theme appearance ("light" or "dark"), or null for default.',
          },
        },
        required: ["themeId", "mode"],
        additionalProperties: false,
      },
      slides: {
        type: "array",
        description: `Ordered list of slides to build (at most ${MAX_AI_CREATE_SLIDES} entries; pass [] for a single cover slide).`,
        items: {
          type: "object",
          properties: {
            title: { type: ["string", "null"], description: "Slide heading text (at most 200 characters), or null." },
            body: {
              type: ["string", "null"],
              description: "Slide body Markdown (bullets, numbered lists, code blocks, LaTeX math, GFM tables), or null.",
            },
            notes: { type: ["string", "null"], description: "Optional plain-text speaker notes (at most 20,000 characters), or null." },
            layout: {
              type: ["string", "null"],
              enum: [...LAYOUT_IDS, null],
              description: `Optional slide layout (${LAYOUT_IDS.join(", ")}), or null to choose automatically.`,
            },
            section: { type: ["string", "null"], description: "Optional section row title starting at this slide, or null." },
          },
          required: ["title", "body", "notes", "layout", "section"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "icon", "parentId", "theme", "slides"],
    additionalProperties: false,
  },
};

const SLIDES_EDIT_TOOL = {
  name: "propose_slides_edit",
  description:
    `Propose structured edits to an existing slide deck (kind slides only). This does NOT change the slide deck unless auto-apply is on: the user reviews a before/after visual preview before applying, so never say the slide deck was updated unless the tool result says it was applied. Call read_note first and pass its noteId and version. ALWAYS target slides by their stable slide.id from read_note (never by slide number!). Never output pixel coordinates. Up to ${MAX_AI_SLIDES_OPS} operations per call. Supported ops: "update_slide" (slideId + any of title, body Markdown, notes, layout, hidden, transition, section; preserves existing images/whiteboard frames/shapes/lines, freeform text boxes, and existing tables unless body includes a replacement table), "update_element" (slideId, elementId, body Markdown; rewrites ONLY that text or shape element without touching other elements on the slide), "set_layout" (slideId, layout; never drops content), "split_slide" (slideId -> first slide uses title/body/notes/layout, second slide uses secondTitle/secondBody/secondNotes/secondLayout, optional ref), "merge_slides" (slideIds [2+], optional title/body/notes/layout), "add_slide" (afterSlideId or atStart=true for beginning or both null for end, title, body, notes, layout, hidden, transition, section, optional ref), "delete_slides" (slideIds), "reorder_slides" (slideIds as full permutation or subset + afterSlideId/atStart), "restyle_deck" (themeId from the 8 built-in themes, themeMode light|dark, optional slideLayouts [{slideId, layout}] — omit slides whose layout should not change; strictly preserves 100% of slide text, inline formatting, links, tables, media, shapes and speaker notes). Pass null for fields unused by an operation.`,
  parameters: {
    type: "object",
    properties: {
      noteId: { type: "string", description: "The slide deck page ID from search_notes, list_pages, or read_note." },
      version: { type: "integer", description: "The version integer shown by read_note." },
      title: { type: ["string", "null"], description: "New slide deck page title, or null to keep the current title." },
      operations: {
        type: "array",
        description: `Ordered list of structured slide operations (at most ${MAX_AI_SLIDES_OPS} per call).`,
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "update_slide",
                "update_element",
                "set_layout",
                "split_slide",
                "merge_slides",
                "add_slide",
                "delete_slides",
                "reorder_slides",
                "restyle_deck",
              ],
              description: "Operation type.",
            },
            slideId: { type: ["string", "null"], description: "Target stable slide ID (from read_note or earlier local ref) for update_slide, update_element, set_layout, split_slide; null otherwise." },
            elementId: { type: ["string", "null"], description: "Target stable element ID (from read_note) for update_element; null otherwise." },
            slideIds: { type: ["array", "null"], items: { type: "string" }, description: "Target stable slide IDs for merge_slides (2+), delete_slides (1+), or reorder_slides; null otherwise." },
            afterSlideId: { type: ["string", "null"], description: "For add_slide / reorder_slides: insert immediately after this stable slide ID, or null." },
            atStart: { type: ["boolean", "null"], description: "For add_slide / reorder_slides when afterSlideId is null: true to insert at start, false/null to append at end." },
            ref: { type: ["string", "null"], description: "Optional temporary local ref ID for a slide created by add_slide or the second slide of split_slide, or null." },
            title: { type: ["string", "null"], description: "Slide title text (for update_slide, add_slide, merge_slides, or first slide of split_slide), or null." },
            body: { type: ["string", "null"], description: "Slide or element body Markdown (bullets, numbered lists, code blocks, math, tables), or null." },
            notes: { type: ["string", "null"], description: "Plain-text speaker notes (pass empty string to clear, null to keep unchanged), or null." },
            layout: { type: ["string", "null"], enum: [...LAYOUT_IDS, null], description: `Slide layout (${LAYOUT_IDS.join(", ")}), or null.` },
            hidden: { type: ["boolean", "null"], description: "For update_slide / add_slide: hide or show the slide, or null." },
            transition: { type: ["string", "null"], enum: [...SLIDE_TRANSITIONS, null], description: "Slide transition (none, fade, slide), or null." },
            section: { type: ["string", "null"], description: "Section row title starting at this slide, or null." },
            secondTitle: { type: ["string", "null"], description: "For split_slide: title of the second slide, or null." },
            secondBody: { type: ["string", "null"], description: "For split_slide: body Markdown of the second slide, or null." },
            secondNotes: { type: ["string", "null"], description: "For split_slide: speaker notes of the second slide, or null." },
            secondLayout: { type: ["string", "null"], enum: [...LAYOUT_IDS, null], description: "For split_slide: layout of the second slide, or null." },
            themeId: { type: ["string", "null"], enum: [...SLIDE_THEME_IDS, null], description: `For restyle_deck: built-in theme (${SLIDE_THEME_IDS.join(", ")}), or null.` },
            themeMode: { type: ["string", "null"], enum: [...SLIDE_THEME_MODES, null], description: 'For restyle_deck: "light" or "dark", or null.' },
            slideLayouts: {
              type: ["array", "null"],
              description: "For restyle_deck: optional per-slide layout changes using stable slide IDs, or null.",
              items: {
                type: "object",
                properties: {
                  slideId: { type: "string", description: "Stable slide ID from read_note." },
                  layout: { type: "string", enum: [...LAYOUT_IDS], description: "Target layout." },
                },
                required: ["slideId", "layout"],
                additionalProperties: false,
              },
            },
          },
          required: [
            "op", "slideId", "elementId", "slideIds", "afterSlideId", "atStart", "ref",
            "title", "body", "notes", "layout", "hidden", "transition", "section",
            "secondTitle", "secondBody", "secondNotes", "secondLayout",
            "themeId", "themeMode", "slideLayouts",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["noteId", "version", "title", "operations"],
    additionalProperties: false,
  },
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export const slidesAdapter: PageAdapter = {
  kind: "slides",
  needsData: true,
  ...canvasStorage("slides"),

  read(page) {
    const header = `# ${page.title}\n\n`;
    const budget = Math.max(0, MAX_READ_CHARS - header.length);
    const body = readSlides(page, budget);
    return `${header}${body || "(This page has no text.)"}`;
  },

  readNote() {
    return "This page is a slide deck, not a note. You can read its theme, sections, slides (with stable slide IDs and layouts), elements (with IDs, roles, rich text, tables and image descriptions) and speaker notes. To change it, use propose_slides_edit with this noteId and version, targeting slides by their stable slide IDs (never propose_note_edit).";
  },

  edit: {
    tool: SLIDES_EDIT_TOOL,
    async propose(_ctx, page, rawArgs) {
      const value = asObject(rawArgs);
      const label = msg("Edit proposal rejected");
      if (value.title !== null && value.title !== undefined && typeof value.title !== "string") {
        throw new AdapterError("title must be a string or null.", label);
      }
      try {
        const result = applySlidesEdits(page.data, value.operations);
        const requestedTitle = typeof value.title === "string" ? value.title.trim() : "";
        const nextTitle = requestedTitle || page.title;
        const checked = validateCanvasPage("slides", { title: nextTitle, icon: null, data: result.data });
        const renamed = checked.title !== page.title;
        return {
          ...(renamed ? { title: { before: page.title, after: checked.title } } : {}),
          changes: result.changes,
          focusIds: result.focusIds,
          proposed: { title: checked.title, data: checked.data },
          unchanged: result.unchanged && !renamed,
        };
      } catch (error) {
        if (error instanceof SlidesEditError || error instanceof NoteValidationError) {
          throw new AdapterError(error.message, label);
        }
        throw error;
      }
    },
  },

  create: {
    tool: SLIDES_CREATE_TOOL,
    async propose(_ctx, rawArgs) {
      const value = asObject(rawArgs);
      const label = msg("Page proposal rejected");
      const title = typeof value.title === "string" ? value.title.trim() : "";
      if (!title) throw new AdapterError("title must be a non-empty string.", label);
      if (value.icon !== null && value.icon !== undefined && typeof value.icon !== "string") {
        throw new AdapterError("icon must be a single emoji or null.", label);
      }
      const icon = typeof value.icon === "string" && value.icon.trim() ? value.icon.trim() : null;
      if (icon !== null && !isEmojiIcon(icon)) {
        throw new AdapterError("icon must be a single emoji or null.", label);
      }
      if (value.parentId !== null && value.parentId !== undefined && typeof value.parentId !== "string") {
        throw new AdapterError("parentId must be a page ID or null.", label);
      }
      const parentId = typeof value.parentId === "string" && value.parentId.trim() ? value.parentId.trim().slice(0, 200) : null;
      if (value.slides !== null && value.slides !== undefined && !Array.isArray(value.slides)) {
        throw new AdapterError("slides must be an array.", label);
      }
      if (value.theme !== null && value.theme !== undefined && (typeof value.theme !== "object" || Array.isArray(value.theme))) {
        throw new AdapterError("theme must be an object or null.", label);
      }

      try {
        const built = buildAiSlidesDeck({
          title,
          theme: (value.theme ?? null) as { themeId?: string | null; mode?: string | null } | null,
          slides: (value.slides ?? []) as CreateSlideInput[],
        });
        const checked = validateCanvasPage("slides", { title, icon, data: built.data });
        return {
          title: checked.title,
          icon: checked.icon,
          content: built.content,
          parentId,
          changes: built.changes,
          focusIds: built.focusIds,
          proposed: { title: checked.title, icon: checked.icon, data: checked.data },
        };
      } catch (error) {
        if (error instanceof SlidesEditError || error instanceof NoteValidationError) {
          throw new AdapterError(error.message, label);
        }
        throw error;
      }
    },
  },
};
