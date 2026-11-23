"use client";

import { BlockNoteSchema, COLORS_DEFAULT, createCodeBlockSpec, createExtension, createHeadingBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs, type BlockNoteEditor, type Dictionary, type PartialBlock } from "@blocknote/core";
import { codeBlockOptions, syntaxHighlighter } from "@blocknote/code-block";
import { BlockNoteView } from "@blocknote/ariakit";
import { SideMenuExtension, SuggestionMenu, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BasicTextStyleButton, BlockColorsItem, ColorStyleButton, CreateLinkButton, DragHandleButton, DragHandleMenu, FileCaptionButton, FileDeleteButton, FileDownloadButton, FilePanel, FilePanelController, FilePreviewButton, FileRenameButton, FileReplaceButton, FormattingToolbar, FormattingToolbarController, SideMenu, SideMenuController, SuggestionMenuController, TableCellMergeButton, TableColumnHeaderItem, TableRowHeaderItem, getDefaultReactSlashMenuItems, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useEditorState, useExtensionState, usePortalElement, type DefaultReactSuggestionItem, type FilePanelProps, type SuggestionMenuProps } from "@blocknote/react";
import { CalendarDays, Check, CheckSquare, ChevronRight, Code2, Columns2, Columns3, Columns4, Copy, Heading1, Lightbulb, Loader2, Radical, Sigma, Sparkles, Trash2, Heading2, Heading3, List, ListOrdered, Minus, Plus, Quote, Table, Text, Type, Upload } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import "@blocknote/ariakit/style.css";
import { MAX_NOTE_FILE_BYTES } from "@/lib/note-file-keys";
import { storageLimitFromUpload } from "@/lib/storage-limit-client";
import { StorageLimitError } from "@/lib/usage-plans";
import { normalizeQuote } from "@/lib/chat-quote";
import { useTheme } from "@/lib/theme";
import { createCalloutBlockSpec } from "@/components/note-callout";
import { canInsertColumns, columnListSpec, columnSpec, computeColumnDropPosition, insertColumns } from "@/components/note-columns";
import { NoteIcon } from "@/components/note-icon";
import { NoteMentionContext, createMentionSpec, formatNoteDate, type MentionPage } from "@/components/note-mention";
import { dateMention, isNoteDate, localDate, notePageIdFromUrl, pageMention } from "@/lib/note-mention";
import { MathEditorProvider, canInsertInlineMath, convertSelectionToInlineMath, createMathBlockSpec, markNextMathBlockAutoOpen, markNextMathInlineAutoOpen, mathInlineSpec } from "@/components/note-math";
import { NOTE_TEXT_BLOCKS, blockMatchesTarget, codeBlockText, copyNoteBlocks, selectedRootBlocks, targetProps, type NoteBlockTarget } from "@/lib/note-block-actions";
import type { NoteContent } from "@/types/notes";
import { useI18n, useT } from "@/components/i18n-provider";
import { cachedBlockNoteDictionary, fallbackBlockNoteDictionary, loadBlockNoteDictionary } from "@/lib/i18n/blocknote-locales";
import type { Locale, TextDirection } from "@/lib/i18n/locale";
import { msg } from "@/lib/i18n/translate";
import { PageKindIcon } from "@/components/page-kind-icon";

export function sideMenuPlacementFor(dir: TextDirection): "left-start" | "right-start" {
  return dir === "rtl" ? "right-start" : "left-start";
}

export function submenuPositionFor(dir: TextDirection): "left" | "right" {
  return dir === "rtl" ? "left" : "right";
}

const CODE_LANGUAGES: Record<string, { name: string; aliases?: string[] }> = codeBlockOptions.supportedLanguages;
// BlockNote は未知の言語 ID で描画時に例外を投げる。保存済みの "" や「```foo」でも落ちないよう、
// 存在確認だけ常に真にして、実際の値は normalizeCodeLanguages で Plain Text に直す。
const SAFE_CODE_LANGUAGES = new Proxy(CODE_LANGUAGES, { has: () => true });
const isKnownLanguage = (language: unknown) => typeof language === "string" && Object.hasOwn(CODE_LANGUAGES, language);

// 子ブロックまでたどり、未対応の言語を持つコードブロックを Plain Text にそろえる。
function normalizeCodeLanguages<T extends { type: string; props?: Record<string, unknown>; children?: T[] }>(blocks: T[]): T[] {
  return blocks.map((block) => ({
    ...block,
    ...(block.type === "codeBlock" && !isKnownLanguage(block.props?.language) ? { props: { ...block.props, language: "text" } } : {}),
    ...(block.children ? { children: normalizeCodeLanguages(block.children) } : {}),
  }));
}

// 入力ルールは Notion に合わせる: 「> 」はトグル、「" 」と「| 」が引用（BlockNote の既定は「> 」が引用）。
const toggleSpec: typeof defaultBlockSpecs.toggleListItem = { ...defaultBlockSpecs.toggleListItem, extensions: [...(defaultBlockSpecs.toggleListItem.extensions ?? []), createExtension({
  key: "notes-toggle-input-rule",
  inputRules: [{ find: /^>\s$/, replace: () => ({ type: "toggleListItem", props: {} }) }],
})] };
const quoteSpec: typeof defaultBlockSpecs.quote = { ...defaultBlockSpecs.quote, extensions: [createExtension({
  key: "notes-quote-input-rule",
  inputRules: [{ find: /^["“”|｜]\s$/, replace: () => ({ type: "quote", props: {} }) }],
})] };

const schema = BlockNoteSchema.create({
  blockSpecs: {
    paragraph: defaultBlockSpecs.paragraph,
    // 見出しは Notion と同じく折りたたみ（トグル見出し）にもできる。
    heading: createHeadingBlockSpec({ levels: [1, 2, 3], allowToggleHeadings: true }),
    bulletListItem: defaultBlockSpecs.bulletListItem,
    numberedListItem: defaultBlockSpecs.numberedListItem,
    checkListItem: defaultBlockSpecs.checkListItem,
    toggleListItem: toggleSpec,
    quote: quoteSpec,
    callout: createCalloutBlockSpec(),
    // 言語選択とシンタックスハイライト付きのコードブロック。未指定は Plain Text。
    codeBlock: createCodeBlockSpec({ defaultLanguage: "text", supportedLanguages: SAFE_CODE_LANGUAGES, indentLineWithTab: true }),
    divider: defaultBlockSpecs.divider,
    table: defaultBlockSpecs.table,
    // Notion の /image /file に相当。アップロードしたものだけを置ける（外部 URL の埋め込みは受け付けない）。
    image: defaultBlockSpecs.image,
    file: defaultBlockSpecs.file,
    mathBlock: createMathBlockSpec(),
    // 段組み（ブロックを左右に並べる）。ブロックを他のブロックの左右へドラッグするか、/2 columns などで作る。
    columnList: columnListSpec,
    column: columnSpec,
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mathInline: mathInlineSpec,
    mention: createMentionSpec,
  },
});

type Editor = BlockNoteEditor<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;
type NotePartialBlock = PartialBlock<typeof schema.blockSchema, typeof schema.inlineContentSchema, typeof schema.styleSchema>;
export type NoteEditorHandle = { focusStart: () => void; focusEnd: () => void };

function convertBlocks(editor: Editor, target: NoteBlockTarget, blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]) {
  editor.focus();
  editor.transact(() => {
    for (const block of blocks) {
      // 表・画像・区切り線など、文字のブロックでないものは変換しない。
      if (!Array.isArray(block.content)) continue;
      // 種類を変えても共通の props は引き継がれる。コールアウトの既定の灰色だけは「色なし」と対応させる:
      // 色のないブロック → コールアウトは灰色に、灰色のコールアウト → 他の種類は色なしに。
      const background = "backgroundColor" in block.props ? block.props.backgroundColor : undefined;
      const recolor = block.type === target.type ? {}
        : target.type === "callout" && background === "default" ? { backgroundColor: "gray" }
          : block.type === "callout" && background === "gray" ? { backgroundColor: "default" } : {};
      const update = target.type === "codeBlock"
        ? { type: "codeBlock", content: [{ type: "text", text: codeBlockText(block), styles: {} }] }
        : { type: target.type, props: { ...targetProps(target), ...recolor } };
      editor.updateBlock(block, update as NotePartialBlock);
    }
  });
}

function duplicateBlocks(editor: Editor, blocks = editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block]) {
  const roots = selectedRootBlocks(blocks);
  if (!roots.length) return;
  editor.focus();
  editor.transact(() => {
    const copies = editor.insertBlocks(copyNoteBlocks(roots) as NotePartialBlock[], roots.at(-1)!, "after");
    editor.setTextCursorPosition(copies[0], "end");
  });
}

// ファイルの追加パネルから始めたアップロードのブロック。失敗してもブロックを残す（パネルが理由を出し、やり直せる）。
const panelUploads = new Set<string>();

// 画像・ファイルを自分のサービスへアップロードし、ブロックに入れる URL と表示名を返す。
async function uploadNoteFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/pages/files", { method: "POST", body: form });
  const data = await response.json().catch(() => null) as { url?: string; name?: string; error?: string } | null;
  // 容量の上限なら、ノートの画面に案内を出す（貼り付け・ドロップのときは、ここで投げた文がどこにも出ないため）。
  const storage = storageLimitFromUpload(response.status, data);
  if (storage) throw storage;
  // BlockNote の貼り付け・ドロップからも呼ばれるので、サーバーの文がないときも読める文を必ず入れる。
  if (!response.ok || !data?.url) throw new Error(data?.error || msg("Upload failed. Try again."));
  return { props: { url: data.url, name: data.name ?? file.name } };
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

type SlashItem = DefaultReactSuggestionItem & { key?: string; hint?: string };

// Notion のスラッシュメニューに合わせ、アイコンとマークダウン記法のヒントを揃える。
const SLASH_LOOK: Record<string, { icon: ReactNode; hint?: string }> = {
  paragraph: { icon: <Type size={18} /> },
  heading: { icon: <Heading1 size={18} />, hint: "#" },
  heading_2: { icon: <Heading2 size={18} />, hint: "##" },
  heading_3: { icon: <Heading3 size={18} />, hint: "###" },
  toggle_heading: { icon: <Heading1 size={18} /> },
  toggle_heading_2: { icon: <Heading2 size={18} /> },
  toggle_heading_3: { icon: <Heading3 size={18} /> },
  toggle_list: { icon: <ChevronRight size={18} />, hint: ">" },
  callout: { icon: <Lightbulb size={18} /> },
  table: { icon: <Table size={18} /> },
  check_list: { icon: <CheckSquare size={18} />, hint: "[]" },
  bullet_list: { icon: <List size={18} />, hint: "-" },
  numbered_list: { icon: <ListOrdered size={18} />, hint: "1." },
  code_block: { icon: <Code2 size={18} />, hint: "```" },
  quote: { icon: <Quote size={18} />, hint: '"' },
  divider: { icon: <Minus size={18} />, hint: "---" },
  math_block: { icon: <Sigma size={18} />, hint: "$$" },
  math_inline: { icon: <Radical size={18} />, hint: "$" },
  columns_2: { icon: <Columns2 size={18} /> },
  columns_3: { icon: <Columns3 size={18} /> },
  columns_4: { icon: <Columns4 size={18} /> },
};

function SlashMenu({ items, selectedIndex, onItemClick }: SuggestionMenuProps<SlashItem>) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  if (!items.length) return <div className="notes-slash-menu"><div className="notes-slash-empty">{t("No results")}</div></div>;
  return <div ref={listRef} className="notes-slash-menu" role="listbox" id="bn-suggestion-menu">
    {items.map((item, index) => {
      const look = item.key ? SLASH_LOOK[item.key] : undefined;
      return <div key={`${item.group}:${item.title}`}>
        {item.group && item.group !== items[index - 1]?.group && <div className="notes-slash-group">{item.group}</div>}
        <button type="button" role="option" id={`bn-suggestion-menu-item-${index}`} aria-selected={index === selectedIndex} className="notes-slash-item"
          onMouseDown={(event) => event.preventDefault()} onClick={() => onItemClick?.(item)}>
          <span className="notes-slash-icon">{look?.icon ?? item.icon}</span>
          <span className="notes-slash-title">{item.title}</span>
          {(item.hint ?? look?.hint) && <span className="notes-slash-hint">{item.hint ?? look?.hint}</span>}
        </button>
      </div>;
    })}
  </div>;
}

const BLOCK_COLORS = [
  { key: "default", title: msg("Default") }, { key: "gray", title: msg("Gray") }, { key: "brown", title: msg("Brown") },
  { key: "orange", title: msg("Orange") }, { key: "yellow", title: msg("Yellow") }, { key: "green", title: msg("Green") },
  { key: "blue", title: msg("Blue") }, { key: "purple", title: msg("Purple") }, { key: "pink", title: msg("Pink") }, { key: "red", title: msg("Red") },
] as const;

// スラッシュメニューから、キャレットのあるブロックに対して行う操作。
function commandItems(editor: Editor, t: ReturnType<typeof useT>): SlashItem[] {
  const current = () => editor.getTextCursorPosition().block;
  const paint = (prop: "textColor" | "backgroundColor", color: string) => () => {
    const block = current();
    // 区切り線など、その色を持てないブロックには何もしない。
    if (prop in editor.schema.blockSchema[block.type].propSchema) editor.updateBlock(block, { props: { [prop]: color } } as NotePartialBlock);
  };
  const swatch = (prop: "textColor" | "backgroundColor", color: (typeof BLOCK_COLORS)[number]["key"]) => {
    const value = color === "default" ? undefined : COLORS_DEFAULT[color][prop === "textColor" ? "text" : "background"];
    return <span className="notes-slash-swatch" style={prop === "textColor" ? { color: value } : { background: value }}>A</span>;
  };
  return [
    ...BLOCK_COLORS.map((color) => ({ title: t(color.title), group: t("Color"), aliases: [color.key, "color"], icon: swatch("textColor", color.key), onItemClick: paint("textColor", color.key) })),
    ...BLOCK_COLORS.map((color) => ({ title: t("{color} background", { color: t(color.title) }), group: t("Background color"), aliases: [`${color.key} background`, "background"],
      icon: swatch("backgroundColor", color.key), onItemClick: paint("backgroundColor", color.key) })),
    { title: t("Duplicate"), group: t("Actions"), aliases: ["duplicate", "copy"], icon: <Copy size={18} />, onItemClick: () => duplicateBlocks(editor, [current()]) },
    { title: t("Delete"), group: t("Actions"), aliases: ["delete", "remove"], icon: <Trash2 size={18} />, onItemClick: () => editor.removeBlocks([current()]) },
  ];
}

// ハンドルのブロックが選択範囲に含まれていれば選択全体を、そうでなければそのブロックだけを対象にする。
function menuTargets(editor: Editor, block: Editor["document"][number]) {
  const selected = editor.getSelection()?.blocks ?? [];
  return selected.some((item) => item.id === block.id) ? selected : [block];
}

function BlockMenu() {
  const { t, dir } = useI18n();
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const hovered = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  const block = hovered && editor.getBlock(hovered.id);
  if (!block) return null;
  return <DragHandleMenu>
    {/* 「Turn into」は文字のブロックだけ（表・画像・区切り線は変換できない）。 */}
    {Array.isArray(block.content) && <Components.Generic.Menu.Root sub position={submenuPositionFor(dir)} portalElement={portalElement}>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger icon={<Text size={16} />}>{t("Turn into")}</Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown">
        {NOTE_TEXT_BLOCKS.map((target) => <Components.Generic.Menu.Item key={target.key} className="bn-menu-item"
          checked={blockMatchesTarget(block, target)}
          onClick={() => convertBlocks(editor, target, [block])}>{t(target.title)}</Components.Generic.Menu.Item>)}
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>}
    <BlockColorsItem>{t("Color")}</BlockColorsItem>
    {/* 表のときだけ出る（BlockNote 側で判定）。Notion の「Header row / Header column」。 */}
    <TableRowHeaderItem>{t("Header row")}</TableRowHeaderItem>
    <TableColumnHeaderItem>{t("Header column")}</TableColumnHeaderItem>
    <Components.Generic.Menu.Divider />
    <Components.Generic.Menu.Item className="bn-menu-item" icon={<Copy size={16} />} onClick={() => duplicateBlocks(editor, menuTargets(editor, block))}>
      {t("Duplicate")}<span className="notes-menu-shortcut">{MOD}+D</span>
    </Components.Generic.Menu.Item>
    <Components.Generic.Menu.Item className="bn-menu-item" icon={<Trash2 size={16} />} onClick={() => editor.removeBlocks(selectedRootBlocks(menuTargets(editor, block)))}>
      {t("Delete")}<span className="notes-menu-shortcut">Del</span>
    </Components.Generic.Menu.Item>
  </DragHandleMenu>;
}

function NoteSideMenu() {
  const t = useT();
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const hovered = useExtensionState(SideMenuExtension, { editor, selector: (state) => state?.block });
  return <SideMenu>
    <Components.SideMenu.Button className="bn-button" label={t("Click to add below. Alt-click to add above.")} icon={<Plus size={18} strokeWidth={1.8} />}
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

// 画像・ファイルの追加パネル。Notion の「Embed link」は出さず、アップロードだけにする。
function NoteFilePanel(props: FilePanelProps) {
  const t = useT();
  return <FilePanel {...props} tabs={[{ name: t("Upload"), tabPanel: <NoteUploadTab {...props} /> }]} />;
}

// ブラウザ標準の「Choose File」ではなく、アプリの見た目のボタンで選ばせる。進行中と失敗も画面に出す。
function NoteUploadTab({ blockId }: FilePanelProps) {
  const t = useT();
  const editor = useBlockNoteEditor(schema);
  const [state, setState] = useState<{ phase: "idle" | "uploading" | "failed"; message?: string }>({ phase: "idle" });
  const block = editor.getBlock(blockId);
  if (!block) return null;
  const isImage = block.type === "image";

  async function upload(file: File | null) {
    if (!file) return;
    // 大きすぎるファイルは送る前に断る（サーバーの上限と同じ）。
    if (file.size > MAX_NOTE_FILE_BYTES) {
      setState({ phase: "failed", message: msg("That file is larger than {size} MB.") });
      return;
    }
    setState({ phase: "uploading" });
    panelUploads.add(blockId);
    try {
      // editor.uploadFile を通すので、ブロック側の「読み込み中」表示も BlockNote に任せられる。
      const result = await editor.uploadFile?.(file, blockId);
      // 待っている間にブロックが消されたら何もしない。
      if (result && editor.getBlock(blockId)) editor.updateBlock(blockId, typeof result === "string" ? { props: { url: result, name: file.name } } : result);
    } catch (error) {
      setState({ phase: "failed", message: error instanceof Error && error.message ? error.message : msg("Upload failed. Try again.") });
    } finally {
      panelUploads.delete(blockId);
    }
  }

  return (
    <div className="note-upload">
      <label className={`note-upload-button ${state.phase === "uploading" ? "is-busy" : ""}`}>
        {state.phase === "uploading" ? <><Loader2 size={16} className="note-upload-spin" />{t("Uploading…")}</> : <><Upload size={16} />{isImage ? t("Choose an image") : t("Choose a file")}</>}
        <input type="file" className="sr-only" accept={isImage ? "image/png,image/jpeg,image/webp,image/gif" : undefined}
          disabled={state.phase === "uploading"} onChange={(event) => { const file = event.target.files?.[0] ?? null; event.target.value = ""; void upload(file); }} />
      </label>
      <p className={`note-upload-hint ${state.phase === "failed" ? "is-error" : ""}`} role={state.phase === "failed" ? "alert" : undefined}>
        {state.phase === "failed" ? t(state.message ?? "", { size: MAX_NOTE_FILE_BYTES / 1024 / 1024 }) : t("Up to 4 MB.")}
      </p>
    </div>
  );
}

const NoteAskAiContext = createContext<((text: string) => void) | null>(null);
function InlineMathToolbarButton() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const t = useT();
  const allowed = useEditorState({ editor, selector: () => canInsertInlineMath(editor) });
  if (!allowed) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={t("Inline equation")}
      mainTooltip={t("Inline equation")}
      secondaryTooltip={`${MOD}+Shift+E`}
      icon={<Radical size={16} />}
      onClick={() => convertSelectionToInlineMath(editor)}
    />
  );
}

function NoteFormattingToolbar() {
  const editor = useBlockNoteEditor(schema);
  const Components = useComponentsContext()!;
  const portalElement = usePortalElement();
  const onAskAi = useContext(NoteAskAiContext);
  const selected = useEditorState({ editor, selector: () => editor.getSelection()?.blocks ?? [editor.getTextCursorPosition().block] });
  // 画像・ファイルのブロックを選んでいるときは、文字の装飾ではなくファイル用の操作を出す。
  const media = selected.length === 1 && (selected[0].type === "image" || selected[0].type === "file");
  const t = useT();
  const typeItems = NOTE_TEXT_BLOCKS.map((target) => ({
    text: t(target.title), icon: <Text size={16} />,
    // 種類の違うブロックをまとめて選択すると一致する項目がなくなり、BlockNote の Select が落ちる。
    // Notion と同じく先頭ブロックの種類を表示する。
    isSelected: !!selected[0] && blockMatchesTarget(selected[0], target),
    onClick: () => convertBlocks(editor, target, selected),
  }));
  if (media) return <FormattingToolbar>
    <FileCaptionButton />
    <FileReplaceButton />
    <FileRenameButton />
    <FileDownloadButton />
    <FilePreviewButton />
    <FileDeleteButton />
  </FormattingToolbar>;
  return <FormattingToolbar>
    {onAskAi && <>
      <button type="button" className="notes-toolbar-ask-ai"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          const text = normalizeQuote(editor.getSelectedText() || window.getSelection()?.toString() || "");
          if (text) onAskAi(text);
        }}>
        <Sparkles size={14} aria-hidden="true" />
        <span>{t("Ask AI")}</span>
      </button>
      <span className="notes-toolbar-sep" />
    </>}
    {/* 区切り線など対応する種類がない選択では、BlockNote 標準と同じく種類の選択を出さない（Select が落ちるため）。 */}
    {typeItems.some((item) => item.isSelected) && <>
      <Components.FormattingToolbar.Select className="bn-select" portalElement={portalElement} items={typeItems} />
      <span className="notes-toolbar-sep" />
    </>}
    {/* Notion と同じ並び: 種類 | リンク | B I U S コード | 色。配置・インデント操作は出さない。 */}
    <CreateLinkButton />
    <span className="notes-toolbar-sep" />
    <BasicTextStyleButton basicTextStyle="bold" />
    <BasicTextStyleButton basicTextStyle="italic" />
    <BasicTextStyleButton basicTextStyle="underline" />
    <BasicTextStyleButton basicTextStyle="strike" />
    <BasicTextStyleButton basicTextStyle="code" />
    <InlineMathToolbarButton />
    <span className="notes-toolbar-sep" />
    <ColorStyleButton />
    {/* 表で複数のセルを選んだ時だけ出る。 */}
    <TableCellMergeButton />
  </FormattingToolbar>;
}

type NoteEditorProps = {
  blocks: NoteContent["blocks"]; onChange: (blocks: NoteContent["blocks"]) => void; editable: boolean;
  editorRef: Ref<NoteEditorHandle>; onFocusTitle: () => void; onAskAi?: (text: string) => void;
  // 「@」で選べる自分のページ（/note-embed では渡さず、「@」を打った時に読む）と、メンションやページのリンクを押した時に開く処理。
  // onOpenPage はその場で開けたら true。false なら（古いアプリの埋め込みなど）リンクを新しいウィンドウで開く。
  // pageMentions が偽（openPage を処理できない古いアプリの埋め込み）のときは、ページのメンションを「@」の候補に出さない。
  pages?: MentionPage[]; currentPageId?: string; onOpenPage?: (id: string) => boolean; pageMentions?: boolean;
};

export default function NoteEditor(props: NoteEditorProps) {
  const { t, locale } = useI18n();
  const [loaded, setLoaded] = useState<{ locale: Locale; dictionary: Dictionary } | null>(() => {
    const hit = cachedBlockNoteDictionary(locale);
    return hit ? { locale, dictionary: hit } : null;
  });
  const innerRef = useRef<NoteEditorHandle>(null);
  const pendingFocus = useRef<"start" | "end" | null>(null);

  useImperativeHandle(props.editorRef, () => ({
    focusStart: () => { if (innerRef.current) innerRef.current.focusStart(); else pendingFocus.current = "start"; },
    focusEnd: () => { if (innerRef.current) innerRef.current.focusEnd(); else pendingFocus.current = "end"; },
  }));

  const dictionary = loaded?.locale === locale ? loaded.dictionary : cachedBlockNoteDictionary(locale);

  useEffect(() => {
    if (cachedBlockNoteDictionary(locale)) return;
    let live = true;
    void loadBlockNoteDictionary(locale)
      .then((next) => { if (live) setLoaded({ locale, dictionary: next }); })
      .catch(() => { if (live) setLoaded({ locale, dictionary: fallbackBlockNoteDictionary() }); });
    return () => { live = false; };
  }, [locale]);

  useEffect(() => {
    if (!dictionary || !pendingFocus.current) return;
    const action = pendingFocus.current;
    pendingFocus.current = null;
    if (action === "start") innerRef.current?.focusStart();
    else innerRef.current?.focusEnd();
  }, [dictionary]);

  if (!dictionary) return <p className="notes-loading">{t("Loading editor…")}</p>;
  return <NoteEditorBody key={locale} {...props} editorRef={innerRef} base={dictionary} />;
}

type MentionItem = DefaultReactSuggestionItem & { key?: string };

function MentionMenu({ items, selectedIndex, onItemClick }: SuggestionMenuProps<MentionItem>) {
  const t = useT();
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);
  if (!items.length) return <div className="notes-slash-menu"><div className="notes-slash-empty">{t("No results")}</div></div>;
  return <div ref={listRef} className="notes-slash-menu" role="listbox" id="bn-suggestion-menu">
    {items.map((item, index) => <div key={item.key ?? index}>
      {item.group && item.group !== items[index - 1]?.group && <div className="notes-slash-group">{item.group}</div>}
      <button type="button" role="option" id={`bn-suggestion-menu-item-${index}`} aria-selected={index === selectedIndex} className="notes-slash-item"
        onMouseDown={(event) => event.preventDefault()} onClick={() => onItemClick?.(item)}>
        <span className="notes-slash-icon">{item.icon}</span>
        <span className="notes-slash-title">{item.title}</span>
        {item.subtext && <span className="notes-slash-hint">{item.subtext}</span>}
      </button>
    </div>)}
  </div>;
}

// /note-embed は一覧を持たないので、「@」やメンションのために自分で読む。
function useMentionPages(given: MentionPage[] | undefined, blocks: NoteContent["blocks"]) {
  const [fetched, setFetched] = useState<MentionPage[] | null>(null);
  const started = useRef(false);
  const loadPages = useCallback(() => {
    if (given || started.current) return;
    started.current = true;
    void fetch("/api/pages", { cache: "no-store" }).then((response) => response.ok ? response.json() : null)
      .then((data: { pages?: MentionPage[] } | null) => { if (data?.pages) setFetched(data.pages.map(({ id, kind, title, icon }) => ({ id, kind, title, icon }))); else started.current = false; })
      .catch(() => { started.current = false; });
  }, [given]);
  // ページのメンションがあるノートは、開いた時にタイトルを最新にするため読む。最初の内容だけを見る（入力のたびに全体を文字列にしない）。
  const [hasPageMention] = useState(() => !given && JSON.stringify(blocks).includes('"kind":"page"'));
  useEffect(() => { if (hasPageMention) loadPages(); }, [hasPageMention, loadPages]);
  return { pages: given ?? fetched, loadPages };
}

function NoteEditorBody({ blocks, onChange, editable, editorRef, onFocusTitle, onAskAi, base, pages: givenPages, currentPageId, onOpenPage, pageMentions = true }: NoteEditorProps & { base: Dictionary }) {
  const { t, dir, locale } = useI18n();
  const { resolved: resolvedTheme } = useTheme();
  const { pages, loadPages } = useMentionPages(givenPages, blocks);
  const openPage = useCallback((id: string) => {
    if (onOpenPage?.(id)) return;
    window.open(`/app?view=pages&page=${encodeURIComponent(id)}`, "_blank", "noopener,noreferrer");
  }, [onOpenPage]);
  // エディターの設定は最初の 1 回だけ作られるので、リンクのクリックからは最新の onOpenPage を参照で読む。
  const openPageRef = useRef(onOpenPage);
  useEffect(() => { openPageRef.current = onOpenPage; }, [onOpenPage]);
  const mentionContext = useMemo(() => ({ pages, loadPages, openPage }), [pages, loadPages, openPage]);
  const sideMenuFloatingOptions = useMemo(
    () => ({ useFloatingOptions: { placement: sideMenuPlacementFor(dir) } }),
    [dir],
  );
  // 下の uploadFile から、作ったエディターを参照する（設定は作る前に渡すため）。
  const uploadEditorRef = useRef<{ getBlock: (id: string) => { props: unknown } | undefined; removeBlocks: (ids: string[]) => unknown } | null>(null);
  const editor = useCreateBlockNote({
    schema,
    extensions: [syntaxHighlighter],
    tabBehavior: "prefer-indent",
    // 表: 見出しの行・列、セルの結合と分割、セルごとの文字色・背景色（いずれも BlockNote の既定では無効）。
    tables: { headers: true, splitCells: true, cellBackgroundColor: true, cellTextColor: true },
    uploadFile: async (file: File, blockId?: string) => {
      try {
        return await uploadNoteFile(file);
      } catch (error) {
        // 容量の上限で断られたとき、貼り付け・ドロップで作られた空のブロック（「Loading...」のまま）は残さない。理由はノートの上の案内に出る。
        // BlockNote は貼り付け・ドロップのアップロードで投げた例外を受け止めないので、何も変えない結果を返してから、そのブロックを消す。
        // 中身のあるブロックの差し替え（Replace）は投げ直して、開いているパネルに理由を出す。
        const current = blockId ? uploadEditorRef.current?.getBlock(blockId)?.props as { url?: unknown } | undefined : undefined;
        const placeholder = current !== undefined && !current.url;
        if (error instanceof StorageLimitError && blockId && !panelUploads.has(blockId) && placeholder) {
          setTimeout(() => {
            const target = uploadEditorRef.current;
            const props = target?.getBlock(blockId)?.props as { url?: unknown } | undefined;
            if (target && props && !props.url) target.removeBlocks([blockId]);
          }, 0);
          return { props: {} };
        }
        throw error;
      }
    },
    // ブロックを他のブロックの左右へドラッグすると縦線を出し、離すと段組みにする（note-columns.ts）。
    dropCursor: { hooks: { computeDropPosition: computeColumnDropPosition } },
    // 編集中にリンクを押すと BlockNote は新しいウィンドウで開く。アプリ内のページへのリンクは、その場でページを切り替える。
    links: { onClick: (event) => {
      const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
      const href = anchor?.getAttribute("href") ?? "";
      const id = notePageIdFromUrl(href, window.location.origin);
      if (id && openPageRef.current && !event.metaKey && !event.ctrlKey && !event.shiftKey && openPageRef.current(id)) return true;
      if (href) window.open((anchor as HTMLAnchorElement).href, "_blank", "noopener,noreferrer");
      return true;
    } },
    // ウェブページからコピーした画像は外部 URL の画像ブロックになり、保存が拒否される。画像だけ含む HTML は文字だけ貼り付ける（スクリーンショットなどのファイルは uploadFile に回る）。
    pasteHandler: ({ event, editor: target, defaultPasteHandler }) => {
      const data = event.clipboardData;
      if (data && !data.files.length && /<img[\s>]/i.test(data.getData("text/html"))) {
        const text = data.getData("text/plain");
        event.preventDefault();
        if (text) target.pasteText(text);
        return true;
      }
      return defaultPasteHandler();
    },
    domAttributes: { editor: { "aria-label": t("Note content") } },
    dictionary: { ...base, placeholders: { ...base.placeholders, emptyDocument: t("Press '/' for commands…"), default: t("Press '/' for commands…"), heading: t("Heading") } },
    initialContent: blocks.length ? normalizeCodeLanguages(blocks) as NotePartialBlock[] : undefined,
  });
  useEffect(() => { uploadEditorRef.current = editor; }, [editor]);
  function focusStart() {
    const first = editor.document[0];
    editor.focus();
    editor.setTextCursorPosition(first, "start");
  }
  function focusEnd() {
    // 最後が段組みなら、段の中ではなく段組みの下に新しい段落を置く。
    const tail = editor.document.at(-1)!;
    if (tail.type === "columnList") {
      const inserted = editor.insertBlocks([{ type: "paragraph" }], tail, "after")[0];
      editor.focus();
      editor.setTextCursorPosition(inserted, "end");
      return;
    }
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

  // コードブロックにホバーした時だけ、右上に Notion と同じ「Copy」ボタンを重ねる。
  const [codeHover, setCodeHover] = useState<{ id: string; top: number; right: number } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // マウスの移動だけでなく、キーボードでコードブロックにキャレットが入った時にも出す。
  function trackCodeHover(event: Pick<MouseEvent<HTMLDivElement>, "target" | "currentTarget">) {
    const target = event.target as HTMLElement;
    if (target.closest(".notes-code-copy")) return;
    const code = target.closest<HTMLElement>('.bn-block-content[data-content-type="codeBlock"]');
    const id = code?.closest(".bn-block-outer")?.getAttribute("data-id");
    if (!code || !id) { if (codeHover) setCodeHover(null); return; }
    const wrap = event.currentTarget.getBoundingClientRect();
    const rect = code.getBoundingClientRect();
    const next = { id, top: Math.round(rect.top - wrap.top + 6), right: Math.round(wrap.right - rect.right + 6) };
    if (next.id !== codeHover?.id || next.top !== codeHover.top || next.right !== codeHover.right) setCodeHover(next);
  }
  async function copyCode(id: string) {
    const block = editor.getBlock(id);
    if (!block) return;
    try {
      await navigator.clipboard.writeText(codeBlockText(block));
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => current === id ? null : current), 1500);
    } catch { /* クリップボード権限がない環境では何もしない。 */ }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!editable || event.nativeEvent.isComposing || !(event.target instanceof HTMLElement) || !event.target.closest(".bn-editor")) return;
    if (event.key === "ArrowUp" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const selection = window.getSelection();
      // 先頭が段組みなら、左の段の最初のブロックが「最初のブロック」。
      let first = editor.document[0];
      while ((first.type === "columnList" || first.type === "column") && first.children.length) first = first.children[0];
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
    } else if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "e") {
      event.preventDefault(); event.stopPropagation(); editor.toggleStyles({ code: true });
    } else if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === "e") {
      event.preventDefault(); event.stopPropagation(); convertSelectionToInlineMath(editor);
    } else if (mod && event.shiftKey && !event.altKey && event.key.toLowerCase() === "s") {
      event.preventDefault(); event.stopPropagation(); editor.toggleStyles({ strike: true });
    } else if ((event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey) || (event.metaKey && event.altKey && !event.ctrlKey && !event.shiftKey)) {
      const digit = event.code.replace(/^Digit/, "");
      const target = NOTE_TEXT_BLOCKS.find((item) => item.digit === digit);
      if (target) { event.preventDefault(); event.stopPropagation(); convertBlocks(editor, target); }
    }
  }

  // 「@」の候補: 自分のページと日付（今日・明日・昨日、YYYY-MM-DD を打てばその日）。
  function mentionItems(query: string): MentionItem[] {
    loadPages();
    const typed = query.trim();
    const q = typed.toLowerCase();
    const insert = (content: ReturnType<typeof pageMention> | ReturnType<typeof dateMention>) => () => {
      editor.insertInlineContent([content as never, " "]);
    };
    // 打ちかけの日付（2026-1 など）の間も候補を残す。候補が空になると BlockNote がメニューを閉じ、日付を打ち終えられない。
    const partialDate = /^\d{1,4}(?:-\d{0,2}(?:-\d{0,2})?)?$/.test(typed) && !isNoteDate(typed);
    const dates = [
      { key: "today", title: t("Today"), date: localDate(0) }, { key: "tomorrow", title: t("Tomorrow"), date: localDate(1) }, { key: "yesterday", title: t("Yesterday"), date: localDate(-1) },
      ...(isNoteDate(typed) ? [{ key: "typed", title: formatNoteDate(typed, locale), date: typed }] : []),
    ].filter((item) => !q || partialDate || item.key === "typed" || item.title.toLowerCase().includes(q) || item.key.includes(q))
      .map((item) => ({ key: `date:${item.key}`, title: item.title, subtext: formatNoteDate(item.date, locale), group: t("Date"), icon: <CalendarDays size={18} />, onItemClick: insert(dateMention(item.date)) }));
    const pageItems = (pageMentions ? pages ?? [] : []).filter((page) => page.id !== currentPageId && (!q || (page.title || t("Untitled")).toLowerCase().includes(q)))
      .slice(0, 8).map((page) => ({ key: `page:${page.id}`, title: page.title || t("Untitled"), group: t("Link to page"),
        icon: page.icon ? <span className="notes-mention-menu-emoji"><NoteIcon icon={page.icon} /></span> : <PageKindIcon kind={page.kind} size={18} />, onItemClick: insert(pageMention(page.id, page.title)) }));
    return [...pageItems, ...dates];
  }

  // アプリ内のページへのリンク（?view=pages&page=ID）は新しいタブではなく、その場でページを切り替える。
  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    const anchor = (event.target as HTMLElement).closest?.("a[href]");
    // 編集できるときは BlockNote の links.onClick（上）が処理する。ここはロック中など読み取り専用のときだけ。
    if (editable || !anchor || anchor.classList.contains("note-mention") || !onOpenPage || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const id = notePageIdFromUrl(anchor.getAttribute("href") ?? "", window.location.origin);
    if (!id) return;
    // 開けないとき（古いアプリの埋め込み）は何もしない：ブラウザ・BlockNote の元の動きに任せる。
    if (!onOpenPage(id)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  return <NoteMentionContext.Provider value={mentionContext}><NoteAskAiContext.Provider value={onAskAi ?? null}><div className="notes-block-editor" onClickCapture={onClickCapture} onKeyDownCapture={onKeyDown} onMouseMove={trackCodeHover} onFocus={trackCodeHover} onMouseLeave={() => setCodeHover(null)}>
    <MathEditorProvider editor={editor} editable={editable}>
    <BlockNoteView editor={editor} theme={resolvedTheme} editable={editable} slashMenu={false} sideMenu={false} formattingToolbar={false} filePanel={false} onChange={() => {
      // 入力ルールで未知の言語が入った場合も、保存前に Plain Text へ直す。
      const unknown: string[] = [];
      const visit = (list: typeof editor.document) => list.forEach((block) => {
        if (block.type === "codeBlock" && !isKnownLanguage(block.props.language)) unknown.push(block.id);
        visit(block.children);
      });
      visit(editor.document);
      if (unknown.length) { editor.transact(() => unknown.forEach((id) => editor.updateBlock(id, { props: { language: "text" } }))); return; }
      // 型の上の Block は BlockNote 既定のスキーマ。コールアウトを含むこのエディターの文書も、保存する JSON としては同じ形。
      onChange(editor.document as unknown as NoteContent["blocks"]);
    }}>
      <FormattingToolbarController formattingToolbar={NoteFormattingToolbar} />
      <FilePanelController filePanel={NoteFilePanel} />
      <SideMenuController sideMenu={NoteSideMenu} floatingUIOptions={sideMenuFloatingOptions} />
      <SuggestionMenuController triggerCharacter="/" suggestionMenuComponent={SlashMenu} getItems={async (query): Promise<SlashItem[]> => {
        // BlockNote 既定の「Others > Emoji」（絵文字ピッカーの呼び出し）は使わないので外す。
        const defaults = (getDefaultReactSlashMenuItems(editor) as (DefaultReactSuggestionItem & { key: string })[]).filter((item) => item.key !== "emoji");
        const turning = /^turn(?:\s|$)/i.test(query);
        const textItems = NOTE_TEXT_BLOCKS.map((target) => {
          // コールアウトは BlockNote の既定の項目にないので、ここで作る。
          const item = defaults.find((item) => item.key === target.key);
          return { ...item, key: target.key, title: t(target.title), group: t("Basic blocks"), aliases: [...(item?.aliases ?? []), ...target.aliases, target.title.toLowerCase()],
            badge: undefined, subtext: undefined,
            onItemClick: turning ? () => convertBlocks(editor, target)
              // 空の段落を置き換える時は元の背景色（default）が残るので、コールアウトの既定の灰色を明示する。
              : item?.onItemClick ?? (() => { insertOrUpdateBlockForSlashMenu(editor, { type: "callout", props: { backgroundColor: "gray" } }); }) };
        });
        if (turning) return filterSuggestionItems(textItems, query.replace(/^turn\s*/i, ""));
        const mathItems: SlashItem[] = [
          {
            key: "math_block", title: t("Block equation"), group: t("Basic blocks"),
            aliases: ["equation", "math", "block equation", "latex", "tex", "katex", "formula", "$$", "公式", "数学", "块级公式", "数式", "ブロック数式"],
            onItemClick: () => {
              markNextMathBlockAutoOpen();
              insertOrUpdateBlockForSlashMenu(editor, { type: "mathBlock", props: { latex: "" } });
            },
          },
          {
            key: "math_inline", title: t("Inline equation"), group: t("Basic blocks"),
            aliases: ["inline equation", "inline math", "math", "latex", "tex", "katex", "formula", "$", "行内公式", "インライン数式"],
            onItemClick: () => {
              markNextMathInlineAutoOpen();
              editor.insertInlineContent([{ type: "mathInline", props: { latex: "" } }, " "]);
            },
          },
        ];
        // 段組み（Notion の 2 columns など）。段の中ではさらに段を作れないので出さない。
        const columnItems: SlashItem[] = canInsertColumns(editor) ? [2, 3, 4].map((count) => ({
          key: `columns_${count}`, title: t("{count} columns", { count }), group: t("Basic blocks"),
          aliases: ["columns", "column", "layout", `${count} columns`, `${count}col`, "分栏", "分列", "段組み", "カラム", "列"],
          onItemClick: () => insertColumns(editor, count),
        })) : [];
        const blockItems = [...textItems, ...mathItems, ...columnItems, ...defaults.filter((item) => !NOTE_TEXT_BLOCKS.some((target) => target.key === item.key))];
        // 一覧が長くなるので、色と操作のコマンド（Notion の /red、/blue background、/duplicate、/delete）は文字を打った時だけ候補に出す。
        return filterSuggestionItems(query.trim() ? [...blockItems, ...commandItems(editor, t)] : blockItems, query);
      }} />
      <SuggestionMenuController triggerCharacter="@" suggestionMenuComponent={MentionMenu} getItems={async (query) => mentionItems(query)} />
    </BlockNoteView>
    </MathEditorProvider>
    {codeHover && <button type="button" className={`notes-code-copy ${copiedId === codeHover.id ? "is-copied" : ""}`} style={{ top: codeHover.top, right: codeHover.right }}
      aria-label={copiedId === codeHover.id ? t("Copied") : t("Copy code")} title={copiedId === codeHover.id ? t("Copied") : t("Copy code")}
      onMouseDown={(event) => event.preventDefault()} onClick={() => void copyCode(codeHover.id)}>
      {copiedId === codeHover.id ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.8} />}
    </button>}
    <button type="button" className="notes-editor-tail" tabIndex={-1} aria-label={t("Continue writing at end of note")} disabled={!editable} onClick={focusEnd} />
  </div></NoteAskAiContext.Provider></NoteMentionContext.Provider>;
}
