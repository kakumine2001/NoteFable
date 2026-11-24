import { createAttachmentResolver } from "@/lib/note-attachments";
import { NoteValidationError, validateNoteContent } from "@/lib/note-document";
import { isEmojiIcon } from "@/lib/emoji-icon";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { blocksToMarkdown, type NoteBlock } from "@/lib/note-markdown";
import { applyPageEdits, MAX_EDITS, PageEditError, parseNewPageMarkdown } from "@/lib/page-edit";
import { discardStoredFiles } from "@/lib/stored-files";
import { msg } from "@/lib/i18n/translate";
import { AdapterError, type AdapterContext, type PageAdapter } from "@/lib/page-ai/adapter";
import { noteStorage } from "@/lib/page-ai/storage";

// ノート（BlockNote の本文）のアダプター。モデルは Markdown で読み書きし、read_note の [n] 番号で場所を指す。
// ツール名（propose_note_edit・propose_note_create）は会話の履歴に残っているので、変えない。

// 本文の Markdown の書き方（編集と新規で同じ）。
const MARKDOWN_FORMAT = "each non-empty line becomes one block; # to ### headings, - bullets, 1. numbered items, - [ ] tasks, > quotes, code fences, --- dividers, '▸ text' toggles ('# ▸ text' is a toggle heading; indent the hidden content by 2 spaces below it), '> [!💡] text' callouts (any single emoji), GFM tables (a '| a | b |' header row, a '| --- | --- |' line, then rows; the whole table is one block, so replace it as a whole), and block math ('$$' on its own lines around LaTeX); indent nested list items by 2 spaces; **bold**, *italic*, ~~strike~~, `code`, `$inline math$`, [text](https://url)";

const EDIT_TOOL = {
  name: "propose_note_edit",
  description: `Propose changes to one of the user's notes in their NoteFable Workspace (kind note only: whiteboards and slide decks cannot be changed with it). This does NOT change the note unless the user turned on auto-apply: the user sees the proposal and must approve it, so never say the note was changed unless the tool result says it was applied. Call read_note first and pass its noteId and version; if the note changed since then the proposal is rejected and you must read again. Edits refer to the [n] block numbers shown by read_note (all edits in one call use the numbering of that read). Operations: "replace" swaps block n and its nested children for the markdown; "insert_after" adds the markdown after block n (block 0 = at the very start of the note); "delete" removes block n and its nested children (markdown must be null). read_note shows an uploaded image or file as [Image: name — caption] or [File: name]; you can replace or delete those blocks like any other (the user is warned that the upload leaves the note), and a replacement may contain an image line (below). To put an image the user sent in this chat into the note, use the line \`![caption](attachment:ID)\` with an ID from list_chat_attachments, on its own line. Markdown: ${MARKDOWN_FORMAT}. Up to ${MAX_EDITS} edits per call. Use title to rename the note (null keeps the title).`,
  parameters: {
    type: "object",
    properties: {
      noteId: { type: "string", description: "The note ID from search_notes or read_note." },
      version: { type: "integer", description: "The version shown by read_note." },
      title: { type: ["string", "null"], description: "New note title, or null to keep it." },
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            op: { type: "string", enum: ["replace", "insert_after", "delete"] },
            block: { type: "integer", description: "Block number from read_note; 0 only for insert_after at the start." },
            markdown: { type: ["string", "null"], description: "New content; null for delete." },
          },
          required: ["op", "block", "markdown"],
          additionalProperties: false,
        },
      },
    },
    required: ["noteId", "version", "title", "edits"],
    additionalProperties: false,
  },
};

const CREATE_TOOL = {
  name: "propose_note_create",
  description: `Propose a brand-new note in the user's NoteFable Workspace. This does NOT create anything unless the user turned on auto-apply: the user sees the proposal and must approve it, so never say the note was created unless the tool result says it was applied. Use it only when the user asks for a new note (to change an existing note use propose_note_edit). markdown is the note body in the same format as propose_note_edit (${MARKDOWN_FORMAT}). Do not repeat the title as a heading in the body. To include an image the user sent in this chat, put \`![caption](attachment:ID)\` on its own line, with an ID from list_chat_attachments. icon is one emoji or null. parentId puts the new note inside another page as a sub-page (an ID from search_notes, list_pages or read_note); null makes a top-level note.`,
  parameters: {
    type: "object",
    properties: {
      title: { type: "string", description: "The note title (at most 200 characters)." },
      markdown: { type: ["string", "null"], description: "The note body, or null for an empty note." },
      icon: { type: ["string", "null"], description: "A single emoji for the note icon, or null." },
      parentId: { type: ["string", "null"], description: "The page to put the new note inside, or null for a top-level note." },
    },
    required: ["title", "markdown", "icon", "parentId"],
    additionalProperties: false,
  },
};

// チャットの画像（attachment:ID）をノートのファイルに写してから提案を作る。提案を作れなかったら、写したファイルを消す
// （容量を占めたままにしない）。作れたら写したファイルを返し、提案の保存に失敗したときは枠組みが消す。
async function withAttachments<T extends object>(ctx: AdapterContext, label: string, work: (resolve: (markdowns: string[]) => Promise<string[]>) => Promise<T>): Promise<T & { copiedFiles: string[] }> {
  const resolver = createAttachmentResolver(ctx.userId, ctx.sessionId, ctx.excludeMessageIds);
  try {
    const draft = await work(resolver);
    return { ...draft, copiedFiles: [...resolver.copied] };
  } catch (error) {
    await discardStoredFiles(resolver.copied);
    if (error instanceof PageEditError || error instanceof NoteValidationError) throw new AdapterError(error.message, label);
    throw error;
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

export const noteAdapter: PageAdapter = {
  kind: "note",
  ...noteStorage,

  read(page) {
    return `# ${page.title}\n\n${blocksToMarkdown(page.blocks, 0, { n: 0 })}`;
  },

  edit: {
    tool: EDIT_TOOL,
    async propose(ctx, page, args) {
      const value = object(args);
      if (value.title !== null && value.title !== undefined && typeof value.title !== "string") throw new AdapterError("title must be a string or null.", msg("Edit proposal rejected"));
      return withAttachments(ctx, msg("Edit proposal rejected"), async (resolve) => {
        // 添付画像の参照は、すべての edit をまとめて検証・コピーしてから URL に置き換える（順番に処理し、並列にはしない）。
        let edits = value.edits;
        if (Array.isArray(value.edits)) {
          const entries = value.edits.map((edit: unknown) => edit && typeof edit === "object" ? edit as Record<string, unknown> : null);
          const markdowns = entries.map((entry) => entry && typeof entry.markdown === "string" ? entry.markdown : "");
          const resolved = await resolve(markdowns);
          edits = value.edits.map((edit: unknown, index: number) => entries[index] && typeof entries[index]!.markdown === "string" ? { ...entries[index], markdown: resolved[index] } : edit);
        }
        const { blocks, changes } = applyPageEdits(page.blocks as NoteBlock[], edits);
        const requested = typeof value.title === "string" ? value.title.trim() : "";
        const content = validateNoteContent({ title: requested || page.title, blocks });
        assertNoteFilesOwner(content.blocks, ctx.userId);
        return {
          ...(content.title !== page.title ? { title: { before: page.title, after: content.title } } : {}),
          changes,
          proposed: { title: content.title, blocks: content.blocks },
          unchanged: !changes.length && content.title === page.title,
        };
      });
    },
  },

  create: {
    tool: CREATE_TOOL,
    async propose(ctx, args) {
      const value = object(args);
      const label = msg("Note proposal rejected");
      const title = typeof value.title === "string" ? value.title.trim() : "";
      if (!title) throw new AdapterError("title must be a non-empty string.", label);
      if (value.icon !== null && value.icon !== undefined && typeof value.icon !== "string") throw new AdapterError("icon must be a single emoji or null.", label);
      const icon = typeof value.icon === "string" && value.icon.trim() ? value.icon.trim() : null;
      if (icon !== null && !isEmojiIcon(icon)) throw new AdapterError("icon must be a single emoji or null.", label);
      if (value.parentId !== null && value.parentId !== undefined && typeof value.parentId !== "string") throw new AdapterError("parentId must be a page ID or null.", label);
      const parentId = typeof value.parentId === "string" && value.parentId.trim() ? value.parentId.trim().slice(0, 200) : null;
      return withAttachments(ctx, label, async (resolve) => {
        const blocks = parseNewPageMarkdown(typeof value.markdown === "string" ? (await resolve([value.markdown]))[0] : value.markdown);
        const content = validateNoteContent({ title, icon, blocks });
        assertNoteFilesOwner(content.blocks, ctx.userId);
        return {
          title: content.title, icon: content.icon, content: blocksToMarkdown(content.blocks), parentId,
          proposed: { title: content.title, icon: content.icon, blocks: content.blocks },
        };
      });
    },
  },
};
