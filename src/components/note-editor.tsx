"use client";

import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs, type PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/ariakit";
import { useCreateBlockNote } from "@blocknote/react";
import "@blocknote/ariakit/style.css";
import type { NoteContent } from "@/types/notes";

const schema = BlockNoteSchema.create({ blockSpecs: {
  paragraph: defaultBlockSpecs.paragraph,
  heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: false }),
  bulletListItem: defaultBlockSpecs.bulletListItem,
  numberedListItem: defaultBlockSpecs.numberedListItem,
  checkListItem: defaultBlockSpecs.checkListItem,
  quote: defaultBlockSpecs.quote,
  codeBlock: defaultBlockSpecs.codeBlock,
  divider: defaultBlockSpecs.divider,
} });

export default function NoteEditor({ blocks, onChange, editable }: {
  blocks: NoteContent["blocks"]; onChange: (blocks: NoteContent["blocks"]) => void; editable: boolean;
}) {
  const editor = useCreateBlockNote({
    schema,
    initialContent: blocks.length ? blocks as PartialBlock<typeof schema.blockSchema>[] : undefined,
  });
  return <div className="notes-block-editor"><BlockNoteView editor={editor} theme="light" editable={editable} onChange={() => onChange(editor.document)} /></div>;
}
