"use client";

import { BlockNoteSchema, createHeadingBlockSpec, defaultBlockSpecs, type BlockNoteEditor, type PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/ariakit";
import { SideMenuExtension, SuggestionMenu, filterSuggestionItems } from "@blocknote/core/extensions";
import { en } from "@blocknote/core/locales";
import { BasicTextStyleButton, BlockColorsItem, DragHandleButton, DragHandleMenu, FormattingToolbar, FormattingToolbarController, RemoveBlockItem, SideMenu, SideMenuController, SuggestionMenuController, getDefaultReactSlashMenuItems, getFormattingToolbarItems, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useEditorState, useExtensionState, usePortalElement, type DefaultReactSuggestionItem } from "@blocknote/react";
import { Copy, Plus, Text } from "lucide-react";
import { useImperativeHandle, type KeyboardEvent, type Ref } from "react";
import "@blocknote/ariakit/style.css";
import { NOTE_TEXT_BLOCKS, codeBlockText, copyNoteBlocks, selectedRootBlocks, type NoteBlockTarget } from "@/lib/note-block-actions";
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

type Editor = BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;
export type NoteEditorHandle = { focusStart: () => void; focusEnd: () => void };

function convertBlocks(editor: Editor, target: NoteBlockTarget, blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]) {
  editor.focus();
  editor.transact(() => {
    for (const block of blocks) {
      const update = target.type === "codeBlock"
        ? { type: "codeBlock", content: [{ type: "text", text: codeBlockText(block), styles: {} }] }
        : { type: target.type, props: target.type === "heading" ? { level: target.level } : {} };
      editor.updateBlock(block, update as PartialBlock<typeof schema.blockSchema>);
    }
  });
}

function duplicateBlocks(editor: Editor, blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]) {
  const roots = selectedRootBlocks(blocks);
  if (!roots.length) return;
  editor.focus();
  editor.transact(() => {
    const copies = editor.insertBlocks(copyNoteBlocks(roots) as PartialBlock<typeof schema.blockSchema>[], roots.at(-1)!, "after");
    editor.setTextCursorPosition(copies[0], "end");
  });
}

function BlockMenu() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const hovered = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  const block = hovered && editor.getBlock(hovered.id);
  if (!block) return null;
  return <DragHandleMenu>
    <Components.Generic.Menu.Root sub position="right" portalElement={portalElement}>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger icon={<Text size={16} />}>Turn into</Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {NOTE_TEXT_BLOCKS.map((target) => <Components.Generic.Menu.Item key={target.key} className="bn-menu-item"
          checked={block.type === target.type && (target.type !== "heading" || (block.type === "heading" && block.props.level === target.level))}
          onClick={() => convertBlocks(editor, target, [block])}>{target.title}</Components.Generic.Menu.Item>)}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
    <BlockColorsItem>Color</BlockColorsItem>
    <Components.Generic.Menu.Divider />
    <Components.Generic.Menu.Item className="bn-menu-item" icon={<Copy size={16} />} onClick={() => duplicateBlocks(editor, [block])}>Duplicate</Components.Generic.Menu.Item>
    <RemoveBlockItem>Delete</RemoveBlockItem>
  </DragHandleMenu>;
}

function NoteSideMenu() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const hovered = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  return <SideMenu>
    <Components.SideMenu.Button className="bn-button" label="Click to add below. Alt-click to add above." icon={<Plus size={18} />}
      onClick={(event) => {
        const block = hovered && editor.getBlock(hovered.id);
        if (!block) return;
        const empty = Array.isArray(block.content) && block.content.length === 0;
        const target = !event.altKey && empty ? block : editor.insertBlocks([{ type: "paragraph" }], block, event.altKey ? "before" : "after")[0];
        editor.focus();
        editor.setTextCursorPosition(target);
        editor.getExtension(SuggestionMenu)?.openSuggestionMenu("/");
      }} />
    <DragHandleButton dragHandleMenu={BlockMenu} />
  </SideMenu>;
}

function NoteFormattingToolbar() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const selected = useEditorState({ editor, selector: () => editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block] });
  return <FormattingToolbar>
    <Components.FormattingToolbar.Select className="bn-select" portalElement={portalElement} items={NOTE_TEXT_BLOCKS.map((target) => ({
      text: target.title, icon: <Text size={16} />,
      isSelected: selected.every((block) => block.type === target.type && (target.type !== "heading" || (block.type === "heading" && block.props.level === target.level))),
      onClick: () => convertBlocks(editor, target, selected),
    }))} />
    {getFormattingToolbarItems().slice(1)}
    <BasicTextStyleButton basicTextStyle="code" />
  </FormattingToolbar>;
}

export default function NoteEditor({ blocks, onChange, editable, editorRef, onFocusTitle }: {
  blocks: NoteContent["blocks"]; onChange: (blocks: NoteContent["blocks"]) => void; editable: boolean;
  editorRef: Ref<NoteEditorHandle>; onFocusTitle: () => void;
}) {
  const editor = useCreateBlockNote({
    schema,
    tabBehavior: "prefer-indent",
    domAttributes: { editor: { "aria-label": "Page content" } },
    dictionary: { ...en, placeholders: { ...en.placeholders, emptyDocument: "Type '/' for commands", default: "Type '/' for commands" } },
    initialContent: blocks.length ? blocks as PartialBlock<typeof schema.blockSchema>[] : undefined,
  });
  function focusStart() {
    const first = editor.document[0];
    editor.focus();
    editor.setTextCursorPosition(first, "start");
  }
  function focusEnd() {
    let last = editor.document.at(-1)!;
    while (last.children.length) last = editor.getBlock(last.children.at(-1)!.id)!;
    if (last.type !== "paragraph" || last.content.length) {
      const inserted = editor.insertBlocks([{ type: "paragraph" }], editor.document.at(-1)!, "after")[0];
      last = editor.getBlock(inserted.id)!;
    }
    editor.focus();
    editor.setTextCursorPosition(last, "end");
  }
  useImperativeHandle(editorRef, () => ({ focusStart, focusEnd }));

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable || event.nativeEvent.isComposing || !(event.target instanceof HTMLElement) || !event.target.closest(".bn-editor")) return;
    if (event.key === "ArrowUp" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const selection = window.getSelection();
      const first = editor.document[0];
      if (selection?.isCollapsed && editor.getTextCursorPosition().block.id === first.id) {
        const content = event.currentTarget.querySelector(".bn-inline-content");
        if (content && selection.anchorNode && content.contains(selection.anchorNode)) {
          const range = document.createRange();
          range.selectNodeContents(content);
          range.setEnd(selection.anchorNode, selection.anchorOffset);
          if (!range.toString().length) { event.preventDefault(); event.stopPropagation(); onFocusTitle(); }
        }
      }
    }
    const mod = event.ctrlKey || event.metaKey;
    if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "d") {
      event.preventDefault(); event.stopPropagation(); duplicateBlocks(editor);
    } else if (mod && !event.altKey && event.key.toLowerCase() === "e") {
      event.preventDefault(); event.stopPropagation(); editor.toggleStyles({ code: true });
    } else if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault(); event.stopPropagation(); editor.toggleStyles({ strike: true });
    } else if ((event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) || (event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey)) {
      const digit = event.code.replace(/^Digit/, "");
      const target = NOTE_TEXT_BLOCKS.find((item) => item.digit === digit);
      if (target) { event.preventDefault(); event.stopPropagation(); convertBlocks(editor, target); }
    }
  }

  return <div className="notes-block-editor" onKeyDownCapture={onKeyDown}>
    <BlockNoteView editor={editor} theme="light" editable={editable} slashMenu={false} sideMenu={false} formattingToolbar={false} onChange={() => onChange(editor.document)}>
      <FormattingToolbarController formattingToolbar={NoteFormattingToolbar} />
      <SideMenuController sideMenu={NoteSideMenu} />
      <SuggestionMenuController triggerCharacter="/" getItems={async (query) => {
        const defaults = getDefaultReactSlashMenuItems(editor) as (DefaultReactSuggestionItem & { key: string })[];
        const turning = /^turn(?:\s|$)/i.test(query);
        const textItems = NOTE_TEXT_BLOCKS.map((target) => {
          const item = defaults.find((item) => item.key === target.key)!;
          return { ...item, title: target.title, group: "Basic blocks", aliases: [...(item.aliases ?? []), ...target.aliases],
            badge: target.digit === undefined ? undefined : `${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘+⌥" : "Ctrl+Shift"}+${target.digit}`,
            onItemClick: turning ? () => convertBlocks(editor, target) : item.onItemClick };
        });
        return filterSuggestionItems(turning ? textItems : [...textItems, ...defaults.filter((item) => !NOTE_TEXT_BLOCKS.some((target) => target.key === item.key))], turning ? query.replace(/^turn\s*/i, "") : query);
      }} />
    </BlockNoteView>
    <button type="button" className="notes-editor-tail" tabIndex={-1} aria-label="Continue writing at end of page" disabled={!editable} onClick={focusEnd} />
  </div>;
}
