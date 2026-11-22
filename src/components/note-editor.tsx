"use client";

import { BlockNoteSchema, COLORS_DEFAULT, createCodeBlockSpec, createExtension, createHeadingBlockSpec, defaultBlockSpecs, defaultInlineContentSpecs, type BlockNoteEditor, type Dictionary, type PartialBlock } from "@blocknote/core";
import { codeBlockOptions, syntaxHighlighter } from "@blocknote/code-block";
import { BlockNoteView } from "@blocknote/ariakit";
import { SideMenuExtension, SuggestionMenu, filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from "@blocknote/core/extensions";
import { BasicTextStyleButton, BlockColorsItem, ColorStyleButton, CreateLinkButton, DragHandleButton, DragHandleMenu, FileCaptionButton, FileDeleteButton, FileDownloadButton, FilePanel, FilePanelController, FilePreviewButton, FileRenameButton, FileReplaceButton, FormattingToolbar, FormattingToolbarController, SideMenu, SideMenuController, SuggestionMenuController, TableCellMergeButton, TableColumnHeaderItem, TableRowHeaderItem, getDefaultReactSlashMenuItems, useBlockNoteEditor, useComponentsContext, useCreateBlockNote, useEditorState, useExtensionState, usePortalElement, type DefaultReactSuggestionItem, type FilePanelProps, type SuggestionMenuProps } from "@blocknote/react";
import { Check, CheckSquare, ChevronRight, Code2, Copy, Heading1, Lightbulb, Loader2, Radical, Sigma, Trash2, Heading2, Heading3, List, ListOrdered, Minus, Plus, Quote, Table, Text, Type, Upload } from "lucide-react";
import { useEffect, useImperativeHandle, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type Ref } from "react";
import "@blocknote/ariakit/style.css";
import { MAX_NOTE_FILE_BYTES } from "@/lib/note-file-keys";
import { createCalloutBlockSpec } from "@/components/note-callout";
import { MathEditorProvider, canInsertInlineMath, convertSelectionToInlineMath, createMathBlockSpec, markNextMathBlockAutoOpen, markNextMathInlineAutoOpen, mathInlineSpec } from "@/components/note-math";
import { NOTE_TEXT_BLOCKS, blockMatchesTarget, codeBlockText, copyNoteBlocks, selectedRootBlocks, targetProps, type NoteBlockTarget } from "@/lib/note-block-actions";
import type { NoteContent } from "@/types/notes";
import { useI18n, useT } from "@/components/i18n-provider";
import { cachedBlockNoteDictionary, fallbackBlockNoteDictionary, loadBlockNoteDictionary } from "@/lib/i18n/blocknote-locales";
import type { Locale, TextDirection } from "@/lib/i18n/locale";
import { msg } from "@/lib/i18n/translate";

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
  },
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    mathInline: mathInlineSpec,
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

// 画像・ファイルを自分のサービスへアップロードし、ブロックに入れる URL と表示名を返す。
async function uploadNoteFile(file: File) {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch("/api/pages/files", { method: "POST", body: form });
  const data = await response.json().catch(() => null) as { url?: string; name?: string; error?: string } | null;
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
        <button type="button" role="option" aria-selected={index === selectedIndex} className="notes-slash-item"
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
    try {
      // editor.uploadFile を通すので、ブロック側の「読み込み中」表示も BlockNote に任せられる。
      const result = await editor.uploadFile?.(file, blockId);
      // 待っている間にブロックが消されたら何もしない。
      if (result && editor.getBlock(blockId)) editor.updateBlock(blockId, typeof result === "string" ? { props: { url: result, name: file.name } } : result);
    } catch (error) {
      setState({ phase: "failed", message: error instanceof Error && error.message ? error.message : msg("Upload failed. Try again.") });
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
  editorRef: Ref<NoteEditorHandle>; onFocusTitle: () => void;
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

function NoteEditorBody({ blocks, onChange, editable, editorRef, onFocusTitle, base }: NoteEditorProps & { base: Dictionary }) {
  const { t, dir } = useI18n();
  const sideMenuFloatingOptions = useMemo(
    () => ({ useFloatingOptions: { placement: sideMenuPlacementFor(dir) } }),
    [dir],
  );
  const editor = useCreateBlockNote({
    schema,
    extensions: [syntaxHighlighter],
    tabBehavior: "prefer-indent",
    // 表: 見出しの行・列、セルの結合と分割、セルごとの文字色・背景色（いずれも BlockNote の既定では無効）。
    tables: { headers: true, splitCells: true, cellBackgroundColor: true, cellTextColor: true },
    uploadFile: uploadNoteFile,
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

  return <div className="notes-block-editor" onKeyDownCapture={onKeyDown} onMouseMove={trackCodeHover} onFocus={trackCodeHover} onMouseLeave={() => setCodeHover(null)}>
    <MathEditorProvider editor={editor} editable={editable}>
    <BlockNoteView editor={editor} theme="light" editable={editable} slashMenu={false} sideMenu={false} formattingToolbar={false} filePanel={false} onChange={() => {
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
        const blockItems = [...textItems, ...mathItems, ...defaults.filter((item) => !NOTE_TEXT_BLOCKS.some((target) => target.key === item.key))];
        // 一覧が長くなるので、色と操作のコマンド（Notion の /red、/blue background、/duplicate、/delete）は文字を打った時だけ候補に出す。
        return filterSuggestionItems(query.trim() ? [...blockItems, ...commandItems(editor, t)] : blockItems, query);
      }} />
    </BlockNoteView>
    </MathEditorProvider>
    {codeHover && <button type="button" className={`notes-code-copy ${copiedId === codeHover.id ? "is-copied" : ""}`} style={{ top: codeHover.top, right: codeHover.right }}
      aria-label={copiedId === codeHover.id ? t("Copied") : t("Copy code")} title={copiedId === codeHover.id ? t("Copied") : t("Copy code")}
      onMouseDown={(event) => event.preventDefault()} onClick={() => void copyCode(codeHover.id)}>
      {copiedId === codeHover.id ? <Check size={14} strokeWidth={2} /> : <Copy size={14} strokeWidth={1.8} />}
    </button>}
    <button type="button" className="notes-editor-tail" tabIndex={-1} aria-label={t("Continue writing at end of note")} disabled={!editable} onClick={focusEnd} />
  </div>;
}
