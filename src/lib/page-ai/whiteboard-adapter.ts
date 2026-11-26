import { isEmojiIcon } from "@/lib/emoji-icon";
import { validateCanvasPage } from "@/lib/canvas-document";
import { NoteValidationError } from "@/lib/note-document";
import { msg } from "@/lib/i18n/translate";
import { AdapterError, MAX_READ_CHARS, type PageAdapter } from "@/lib/page-ai/adapter";
import { readWhiteboard } from "@/lib/page-ai/canvas-adapter";
import { canvasStorage } from "@/lib/page-ai/storage";
import { DiagramSourceError, diagramToWhiteboard } from "@/lib/whiteboard/diagram";
import {
  AI_FONT_SIZES,
  AI_LAYOUTS,
  AI_PLACEMENTS,
  AI_SHAPE_TYPES,
  AI_STROKE_STYLES,
  applyWhiteboardEdits,
  buildStructuredWhiteboard,
  MAX_AI_WHITEBOARD_OPS,
  WhiteboardEditError,
  type StructuredCreateConnection,
  type StructuredCreateFrame,
  type StructuredCreateItem,
} from "@/lib/whiteboard/ai-edit";

// ホワイトボードの AI アダプター（WA2）。
// ツール名（propose_whiteboard_create / propose_whiteboard_edit）は履歴に残るため、公開後に変更しない。
// OpenAI / DeepSeek の strict: true と Anthropic Messages API の両方で通る JSON Schema を使う。

const WHITEBOARD_CREATE_TOOL = {
  name: "propose_whiteboard_create",
  description:
    "Propose a brand-new whiteboard in the user's NoteFable Workspace. This does NOT create anything unless the user turned on auto-apply: the user sees a visual preview and must approve it, so never say the whiteboard was created unless the tool result says it was applied. Never output pixel coordinates; layout is computed automatically. Provide EITHER a `mermaid` diagram string (flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, timeline, gantt, quadrantChart, or mindmap) OR structured `frames` / `items` / `connections` (or all null for an empty whiteboard). Use plain Unicode for math (no LaTeX). `icon` is a single emoji or null; `parentId` puts it inside another page or null for top-level.",
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "Whiteboard title (at most 200 characters)." },
      icon: { type: ["string", "null"], description: "A single emoji icon, or null." },
      parentId: { type: ["string", "null"], description: "Parent page ID to place the whiteboard inside, or null." },
      mermaid: {
        type: ["string", "null"],
        description:
          "Optional Mermaid source (flowchart, sequenceDiagram, stateDiagram-v2, classDiagram, erDiagram, timeline, gantt, quadrantChart, or mindmap) converted into editable elements. Pass null when using frames/items/connections or making an empty board.",
      },
      frames: {
        type: ["array", "null"],
        description: "Optional named frames to group structured items. Pass null if not used.",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "Short local reference ID for this frame (used by items' frameRef)." },
            name: { type: "string", description: "Frame title." },
            layout: { type: ["string", "null"], enum: ["row", "column", "grid", null], description: "Arrangement inside the frame (row, column, or grid; null defaults to grid)." },
          },
          required: ["ref", "name", "layout"],
          additionalProperties: false,
        },
      },
      items: {
        type: ["array", "null"],
        description: "Optional structured shapes, sticky notes, or text elements laid out deterministically. Pass null when using mermaid or making an empty board.",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "Short local reference ID (used by connections' fromRef/toRef)." },
            type: { type: "string", enum: [...AI_SHAPE_TYPES], description: "Element kind." },
            text: { type: "string", description: "Label text (plain Unicode, no LaTeX)." },
            color: { type: ["string", "null"], description: "Color name (default, yellow, blue, green, orange, red, purple, teal, pink, gray) or hex color, or null." },
            frameRef: { type: ["string", "null"], description: "Optional ref from frames[] to place this item inside, or null." },
          },
          required: ["ref", "type", "text", "color", "frameRef"],
          additionalProperties: false,
        },
      },
      connections: {
        type: ["array", "null"],
        description: "Optional bound arrows linking items by their local ref IDs. Pass null if none.",
        items: {
          type: "object",
          properties: {
            fromRef: { type: "string", description: "Source item ref." },
            toRef: { type: "string", description: "Target item ref." },
            label: { type: ["string", "null"], description: "Optional arrow label, or null." },
            color: { type: ["string", "null"], description: "Optional color name or hex color, or null." },
          },
          required: ["fromRef", "toRef", "label", "color"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "icon", "parentId", "mermaid", "frames", "items", "connections"],
    additionalProperties: false,
  },
};

const WHITEBOARD_EDIT_TOOL = {
  name: "propose_whiteboard_edit",
  description:
    `Propose structured edits to an existing whiteboard (kind whiteboard only). This does NOT change the whiteboard unless auto-apply is on: the user reviews a before/after preview before applying, so never say the whiteboard was updated unless the tool result says it was applied. Call read_note first and pass its noteId and version. Never output pixel coordinates; positions and arrow bindings are computed automatically on the server. Up to ${MAX_AI_WHITEBOARD_OPS} operations per call. Supported ops: "add_element" (elementType, text, color, fontSize, frameId, nearId, placement, ref), "add_frame" (text=frame name, elementIds=optional existing items to wrap, nearId, placement, ref), "connect" (fromId, toId, text=optional label, color, strokeStyle, ref), "update_element" (elementId, text, color, strokeStyle, fontSize), "delete_elements" (elementIds; cascades bound text & mindmap subtrees), "set_frame" (elementIds, frameId or null to remove from frame), "arrange" (elementIds, layout=row|column|grid|cluster, optional frameId or text=new frame name, ref), "group_elements" (elementIds, ungroup=true|false). Use temporary \`ref\` strings on newly added elements/frames so later operations in the same call can reference them. Pass null for fields unused by an operation.`,
  parameters: {
    type: "object",
    properties: {
      noteId: { type: "string", description: "The whiteboard page ID from search_notes, list_pages, or read_note." },
      version: { type: "integer", description: "The version integer shown by read_note." },
      title: { type: ["string", "null"], description: "New whiteboard title, or null to keep the current title." },
      operations: {
        type: "array",
        description: `Ordered list of structured whiteboard operations (at most ${MAX_AI_WHITEBOARD_OPS} per call).`,
        items: {
          type: "object",
          properties: {
            op: {
              type: "string",
              enum: [
                "add_element",
                "add_frame",
                "connect",
                "update_element",
                "delete_elements",
                "set_frame",
                "arrange",
                "group_elements",
              ],
              description: "Operation type.",
            },
            ref: { type: ["string", "null"], description: "Temporary local ref ID for an element/frame created by this op, or null." },
            elementType: { type: ["string", "null"], enum: [...AI_SHAPE_TYPES, null], description: "For add_element: shape kind; null otherwise." },
            elementId: { type: ["string", "null"], description: "For update_element: existing element ID or local ref; null otherwise." },
            elementIds: { type: ["array", "null"], items: { type: "string" }, description: "For delete_elements, set_frame, arrange, group_elements, or add_frame; null otherwise." },
            text: { type: ["string", "null"], description: "Label text, frame name, or arrow label (plain Unicode, no LaTeX), or null." },
            color: { type: ["string", "null"], description: "Color name (default, yellow, blue, green, orange, red, purple, teal, pink, gray) or hex color, or null." },
            strokeStyle: { type: ["string", "null"], enum: [...AI_STROKE_STYLES, null], description: "Line style (solid, dashed, dotted), or null." },
            fontSize: { type: ["string", "null"], enum: [...AI_FONT_SIZES, null], description: "Text size preset (small, medium, large, xl), or null." },
            fromId: { type: ["string", "null"], description: "For connect: source element ID or local ref; null otherwise." },
            toId: { type: ["string", "null"], description: "For connect: target element ID or local ref; null otherwise." },
            frameId: { type: ["string", "null"], description: "Target frame ID or local ref (for set_frame, null removes from frame)." },
            nearId: { type: ["string", "null"], description: "Optional anchor element/frame ID or local ref to place near, or null." },
            placement: { type: ["string", "null"], enum: [...AI_PLACEMENTS, null], description: "Side relative to nearId (right, below, left, above), or null." },
            layout: { type: ["string", "null"], enum: [...AI_LAYOUTS, null], description: "For arrange: row, column, grid, or cluster; null otherwise." },
            ungroup: { type: ["boolean", "null"], description: "For group_elements: true to ungroup, false/null to group." },
          },
          required: [
            "op", "ref", "elementType", "elementId", "elementIds", "text", "color",
            "strokeStyle", "fontSize", "fromId", "toId", "frameId", "nearId",
            "placement", "layout", "ungroup",
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

export const whiteboardAdapter: PageAdapter = {
  kind: "whiteboard",
  needsData: true,
  ...canvasStorage("whiteboard"),

  read(page) {
    const header = `# ${page.title}\n\n`;
    const budget = Math.max(0, MAX_READ_CHARS - header.length);
    const body = readWhiteboard(page, budget);
    return `${header}${body || "(This page has no text.)"}`;
  },

  readNote() {
    return "This page is a whiteboard, not a note. You can read its structured frames, elements (with IDs, types, text, groups and page links) and arrow/line connections. To change it, use propose_whiteboard_edit with this noteId and version (never propose_note_edit).";
  },

  edit: {
    tool: WHITEBOARD_EDIT_TOOL,
    async propose(_ctx, page, rawArgs) {
      const value = asObject(rawArgs);
      const label = msg("Edit proposal rejected");
      if (value.title !== null && value.title !== undefined && typeof value.title !== "string") {
        throw new AdapterError("title must be a string or null.", label);
      }
      try {
        const result = applyWhiteboardEdits(page.data, value.operations);
        const requestedTitle = typeof value.title === "string" ? value.title.trim() : "";
        const nextTitle = requestedTitle || page.title;
        const checked = validateCanvasPage("whiteboard", { title: nextTitle, icon: null, data: result.data });
        const renamed = checked.title !== page.title;
        return {
          ...(renamed ? { title: { before: page.title, after: checked.title } } : {}),
          changes: result.changes,
          focusIds: result.focusIds,
          proposed: { title: checked.title, data: checked.data },
          unchanged: result.unchanged && !renamed,
        };
      } catch (error) {
        if (error instanceof WhiteboardEditError || error instanceof NoteValidationError) {
          throw new AdapterError(error.message, label);
        }
        throw error;
      }
    },
  },

  create: {
    tool: WHITEBOARD_CREATE_TOOL,
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

      if (value.mermaid !== null && value.mermaid !== undefined && typeof value.mermaid !== "string") {
        throw new AdapterError("mermaid must be a string or null.", label);
      }
      const mermaid = typeof value.mermaid === "string" && value.mermaid.trim() ? value.mermaid.trim() : null;
      const frames = value.frames === null || value.frames === undefined ? null : Array.isArray(value.frames) ? value.frames as StructuredCreateFrame[] : null;
      const items = value.items === null || value.items === undefined ? null : Array.isArray(value.items) ? value.items as StructuredCreateItem[] : null;
      const connections = value.connections === null || value.connections === undefined ? null : Array.isArray(value.connections) ? value.connections as StructuredCreateConnection[] : null;

      if (value.frames !== null && value.frames !== undefined && !Array.isArray(value.frames)) {
        throw new AdapterError("frames must be an array or null.", label);
      }
      if (value.items !== null && value.items !== undefined && !Array.isArray(value.items)) {
        throw new AdapterError("items must be an array or null.", label);
      }
      if (value.connections !== null && value.connections !== undefined && !Array.isArray(value.connections)) {
        throw new AdapterError("connections must be an array or null.", label);
      }

      const hasStructured = Boolean(frames?.length || items?.length || connections?.length);
      if (mermaid && hasStructured) {
        throw new AdapterError("Provide either mermaid or structured frames/items/connections, not both.", label);
      }

      try {
        let data;
        let content = "";
        let focusIds: string[] = [];

        if (mermaid) {
          const converted = await diagramToWhiteboard(mermaid);
          data = converted.data;
          const visibleCount = data.elements.filter((el) => !(el.type === "text" && el.containerId)).length;
          content = `Diagram (${converted.kind}, ${visibleCount} element${visibleCount === 1 ? "" : "s"})`;
          focusIds = data.elements
            .filter((el) => !(el.type === "text" && el.containerId))
            .map((el) => el.id)
            .slice(0, 200);
        } else if (hasStructured) {
          const built = buildStructuredWhiteboard({ frames, items, connections });
          data = built.data;
          content = built.summaryLines.slice(0, 12).join("\n");
          focusIds = built.focusIds.slice(0, 200);
        } else {
          data = { elements: [] };
          content = "";
        }

        const checked = validateCanvasPage("whiteboard", { title, icon, data });
        return {
          title: checked.title,
          icon: checked.icon,
          content,
          parentId,
          focusIds,
          proposed: { title: checked.title, icon: checked.icon, data: checked.data },
        };
      } catch (error) {
        if (error instanceof DiagramSourceError || error instanceof WhiteboardEditError || error instanceof NoteValidationError) {
          throw new AdapterError(error.message, label);
        }
        throw error;
      }
    },
  },
};
