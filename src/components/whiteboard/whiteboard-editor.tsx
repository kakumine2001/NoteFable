"use client";

import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, FONT_FAMILY, getCommonBounds, getSceneVersion, languages, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles, BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { useI18n } from "@/components/i18n-provider";
import { LOCALE_TAGS, type Locale } from "@/lib/i18n/locale";
import { localizeSystemText, msg, type TranslateVars } from "@/lib/i18n/translate";
import { useTheme } from "@/lib/theme";
import { postToNative } from "@/lib/native-bridge";
import { MAX_NOTE_FILE_BYTES } from "@/lib/note-file-keys";
import { StorageLimitError } from "@/lib/usage-plans";
import { useMediaQuery } from "@/lib/use-media-query";
import { connectWhiteboardActions, type WhiteboardActions } from "@/lib/whiteboard/excalidraw-bridge";
import { deliverExport, exportWhiteboard, type WhiteboardExportFormat } from "@/lib/whiteboard/export";
import { pageCardLabel, pageIdFromLink, pageLinkUrl } from "@/lib/whiteboard/links";
import { importPdfPages, MAX_PDF_IMPORT_PAGES, type PdfImportResult } from "@/lib/whiteboard/pdf-import";
import { consumeWhiteboardReveal, WHITEBOARD_REVEAL_EVENT, type WhiteboardRevealDetail } from "@/lib/whiteboard/reveal";
import { isEmbeddedDataUrl, sceneToStored, storedToScene, type StoredWhiteboard, type WhiteboardElement } from "@/lib/whiteboard/scene";
import { uploadWhiteboardImage } from "@/lib/whiteboard/upload";
import { WhiteboardChrome, isDrawingTool, toolType, type WhiteboardTool, type WhiteboardUiState } from "@/components/whiteboard/whiteboard-ui";
import { WhiteboardLinkDialog } from "@/components/whiteboard/whiteboard-link-dialog";
import { WhiteboardMinimap } from "@/components/whiteboard/whiteboard-minimap";
import type { MentionPage } from "@/components/note-mention";

// ホワイトボードのエディター（Excalidraw をもとに、画面は NoteFable 自身のツールバーとパネル。docs/architecture/whiteboard.md）。
// 動的に読み込む（SSR しない）。/app のノート画面・分割表示・/note-embed（アプリの WebView）で使う。
// 本体の保存は呼び出し側（NotesWorkspace → NoteSaveQueue）が行う。ここは内容が変わったら onChange で保存する形（StoredWhiteboard）を渡す。

// 図形用のフォントは自分のサイトから配る（scripts/copy-whiteboard-assets.mjs が public/whiteboard/fonts へ写す）。CDN からは読まない。
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/whiteboard/";

// NoteFable の言語 → Excalidraw の言語コード。Excalidraw は訳が 85% 以上の言語だけを持つので、無いものは英語にする。
// Excalidraw の文言はほとんど出ない（画面は自前）。残るのは枠の既定の名前・読み上げ用の文など。
const EXCALIDRAW_LANGS: Record<Locale, string> = {
  en: "en", zh: "zh-CN", "zh-Hant": "zh-TW", ja: "ja-JP", ko: "ko-KR", es: "es-ES", fr: "fr-FR", de: "de-DE", "pt-BR": "pt-BR",
  it: "it-IT", id: "id-ID", vi: "vi-VN", th: "th-TH", hi: "hi-IN", ar: "ar-SA", tr: "tr-TR", ru: "ru-RU",
};
export function excalidrawLang(locale: Locale) {
  const code = EXCALIDRAW_LANGS[locale];
  return languages.some((language) => language.code === code) ? code : "en";
}

// Excalidraw は言語を設定するたびに <html lang/dir> を自分の言語に書き換える。NoteFable の設定（I18nProvider）に戻し続ける。
export function useKeepDocumentLanguage(locale: Locale, dir: "ltr" | "rtl") {
  useEffect(() => {
    const root = document.documentElement;
    const lang = LOCALE_TAGS[locale];
    const restore = () => {
      if (root.lang !== lang) root.lang = lang;
      if (root.dir !== dir) root.dir = dir;
    };
    restore();
    const observer = new MutationObserver(restore);
    observer.observe(root, { attributes: true, attributeFilter: ["lang", "dir"] });
    return () => observer.disconnect();
  }, [locale, dir]);
}

// ページの表示位置（スクロール・拡大率）は端末ごとに覚える（本体には入れない：動かすたびに版を進めない）。
const VIEWPORT_PREFIX = "notefable:whiteboard-viewport:v1:";
const MINIMAP_KEY = "notefable:whiteboard-minimap:v1";
type SavedViewport = { scrollX: number; scrollY: number; zoom: number };
function readViewport(pageId: string): SavedViewport | null {
  try {
    const value = JSON.parse(localStorage.getItem(VIEWPORT_PREFIX + pageId) ?? "null");
    if (value && [value.scrollX, value.scrollY, value.zoom].every((entry) => typeof entry === "number" && Number.isFinite(entry)) && value.zoom > 0) return value;
  } catch { /* 壊れた値は無視して、内容に合わせて表示する。 */ }
  return null;
}
function writeViewport(pageId: string, viewport: SavedViewport) {
  try { localStorage.setItem(VIEWPORT_PREFIX + pageId, JSON.stringify(viewport)); } catch { /* 覚えられなくても編集はできる。 */ }
}

// 新しい図形の既定：線は手書き風ではなく「きれい」（roughness 0）、文字は Nunito。
// 中日韓の文字は Nunito に無いので端末の文字で出る（手書き風の Excalifont なら Xiaolai が使われる）。
const CLEAN_DEFAULTS = {
  currentItemRoughness: 0,
  currentItemFontFamily: FONT_FAMILY.Nunito,
  currentItemRoundness: "round",
} as const;

export type WhiteboardEditorHandle = {
  // 検索の結果などで、その要素まで動かして選ぶ。見つからなければ false。
  reveal: (elementId: string) => boolean;
  // AI（#153）が使う：いま選んでいる要素の ID と、その中の文字。
  selectionContext: () => { ids: string[]; text: string };
};

export type WhiteboardEditorProps = {
  pageId: string;
  // 保存された本体（NoteCanvas.data）。開いた時に 1 回だけ読む（作り直すときは key を変える）。
  data: unknown;
  editable: boolean;
  embedded: boolean;
  onChange: (data: StoredWhiteboard) => void;
  // 要素のリンクがアプリ内のページを指すとき、その場で開く。開けたら true。
  onOpenPage?: (id: string) => boolean;
  // リンク先を選ぶためのページの一覧。/note-embed では渡さない（必要になった時に読む）。
  pages?: MentionPage[];
  title: string;
  icon: string | null;
  onTitleChange: (title: string) => void;
  onIconChange: (icon: string | null) => void;
  // 右下（AI ボタン、#153）用に空けておく場所の中身。
  aiSlot?: ReactNode;
  handleRef?: Ref<WhiteboardEditorHandle>;
};

type UploadState = { status: "uploading" } | { status: "done"; url: string; mimeType: string } | { status: "failed" };

// ペン・蛍光ペン・図形のそれぞれで覚えておく見た目。
type DrawMode = "pen" | "highlighter";
type ToolStyle = { strokeColor: string; opacity: number; strokeWidthKey: string; variability: string };
const PEN_DEFAULT: ToolStyle = { strokeColor: "#1e1e1e", opacity: 100, strokeWidthKey: "medium", variability: "variable" };
// 蛍光ペンは半透明の太い線（下の文字や画像が透けて見える）。
const HIGHLIGHTER_DEFAULT: ToolStyle = { strokeColor: "#ffd43b", opacity: 40, strokeWidthKey: "bold", variability: "constant" };
type StyleKeys = "currentItemStrokeColor" | "currentItemOpacity" | "currentItemStrokeWidthKey" | "currentItemStrokeVariability";
function styleOf(appState: AppState): ToolStyle {
  return { strokeColor: appState.currentItemStrokeColor, opacity: appState.currentItemOpacity, strokeWidthKey: appState.currentItemStrokeWidthKey, variability: appState.currentItemStrokeVariability };
}
function styleUpdate(style: ToolStyle): Pick<AppState, StyleKeys> {
  return {
    currentItemStrokeColor: style.strokeColor, currentItemOpacity: style.opacity,
    currentItemStrokeWidthKey: style.strokeWidthKey as AppState["currentItemStrokeWidthKey"],
    currentItemStrokeVariability: style.variability as AppState["currentItemStrokeVariability"],
  };
}

// 見えている範囲（scene の座標）。
function visibleRect(appState: AppState) {
  return { x: -appState.scrollX, y: -appState.scrollY, width: appState.width / appState.zoom.value, height: appState.height / appState.zoom.value };
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function WhiteboardEditor(props: WhiteboardEditorProps) {
  const { pageId, data, editable, embedded, onChange, onOpenPage, handleRef } = props;
  const { t, locale, dir } = useI18n();
  const { resolved: theme } = useTheme();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<WhiteboardActions | null>(null);
  const [ui, setUi] = useState<WhiteboardUiState | null>(null);
  // キャンバスの上に出すお知らせ。text は英語の文（訳は表示する時）、vars はその中の値。
  const [notice, setNotice] = useState<{ text: string; vars?: TranslateVars } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [linkDialog, setLinkDialog] = useState<{ mode: "link" | "card"; url?: string } | null>(null);
  const [sceneVersion, setSceneVersion] = useState("0");
  const [contentHidden, setContentHidden] = useState(false);
  const [minimapOpen, setMinimapOpen] = useState(() => {
    try { return localStorage.getItem(MINIMAP_KEY) === "1"; } catch { return false; }
  });
  const pdfInputRef = useRef<HTMLInputElement>(null);
  // 開いた時の内容（Excalidraw に 1 回だけ渡す）。
  const initial = useMemo(() => {
    const scene = storedToScene(data);
    const viewport = typeof window === "undefined" ? null : readViewport(pageId);
    return {
      elements: scene.elements as unknown as ExcalidrawElement[],
      files: scene.files as unknown as BinaryFiles,
      appState: {
        ...CLEAN_DEFAULTS,
        ...scene.appState,
        ...(viewport ? { scrollX: viewport.scrollX, scrollY: viewport.scrollY, zoom: { value: viewport.zoom } } : {}),
      } as Partial<AppState>,
      scrollToContent: !viewport,
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時の内容だけを使う（その後の変更は Excalidraw が持つ）。
  }, []);

  // ---- 保存 ----
  const uploads = useRef(new Map<string, UploadState>());
  const uploadedUrls = useRef(new Map<string, { url: string; mimeType: string }>());
  const lastSignature = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);

  const signatureOf = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    const persisted = [appState.viewBackgroundColor, appState.gridModeEnabled, appState.gridSize, appState.gridStep, appState.objectsSnapModeEnabled];
    return `${getSceneVersion(elements)}|${elements.length}|${uploadedUrls.current.size}|${JSON.stringify(persisted)}`;
  }, []);

  const updateContentHidden = useCallback(() => {
    if (!api || api.isDestroyed) return;
    const elements = api.getSceneElements();
    if (!elements.length) { setContentHidden(false); return; }
    const [x1, y1, x2, y2] = getCommonBounds(elements);
    const view = visibleRect(api.getAppState());
    setContentHidden(x2 < view.x || x1 > view.x + view.width || y2 < view.y || y1 > view.y + view.height);
  }, [api]);

  const serializeNow = useCallback(() => {
    if (!api || api.isDestroyed) return;
    const { data: stored } = sceneToStored({
      elements: api.getSceneElementsIncludingDeleted() as unknown as WhiteboardElement[],
      files: api.getFiles() as unknown as Parameters<typeof sceneToStored>[0]["files"],
      appState: api.getAppState(),
      uploaded: uploadedUrls.current,
    });
    onChangeRef.current(stored);
  }, [api]);

  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      if (!api || api.isDestroyed) return;
      const appState = api.getAppState();
      // 描いている途中・動かしている途中は待つ（終わってから 1 回だけ保存の形を作る）。
      if (appState.newElement || appState.selectedElementsAreBeingDragged || appState.isResizing || appState.isRotating) { scheduleSave(); return; }
      const signature = signatureOf(api.getSceneElementsIncludingDeleted(), appState);
      if (signature === lastSignature.current) return;
      lastSignature.current = signature;
      setSceneVersion(signature);
      updateContentHidden();
      if (editable) serializeNow();
    }, 400);
  }, [api, editable, serializeNow, signatureOf, updateContentHidden]);

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // ---- 画像のアップロード（Excalidraw は貼り付け・ドロップ・画像ツールの画像を data: で持つ。保存には note-files の URL を使う） ----
  const removeImagesOf = useCallback((fileId: string) => {
    if (!api || api.isDestroyed) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const images = new Set(elements.filter((element) => element.type === "image" && (element as { fileId?: string }).fileId === fileId).map((element) => element.id));
    if (!images.size) return;
    api.updateScene({
      elements: elements.filter((element) => !images.has(element.id) && !(element.type === "text" && images.has((element as { containerId?: string | null }).containerId ?? ""))),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api]);

  const startUploads = useCallback((elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
    const used = new Set(elements.filter((element) => !element.isDeleted && element.type === "image").map((element) => (element as { fileId?: string | null }).fileId).filter(Boolean));
    for (const [fileId, file] of Object.entries(files)) {
      if (!used.has(fileId) || uploads.current.has(fileId) || !isEmbeddedDataUrl(file.dataURL)) continue;
      uploads.current.set(fileId, { status: "uploading" });
      void uploadWhiteboardImage(file.dataURL, file.mimeType, fileId).then((result) => {
        uploads.current.set(fileId, { status: "done", ...result });
        uploadedUrls.current.set(fileId, result);
        // 保存し直す（signature の uploaded の数が変わる）。
        lastSignature.current = null;
        scheduleSave();
      }).catch((error: unknown) => {
        uploads.current.set(fileId, { status: "failed" });
        // 容量の上限は NotesWorkspace の案内（storage-limit-client）が出す。ここは画像を取り除くだけ。
        if (!(error instanceof StorageLimitError)) setNotice({ text: error instanceof Error && error.message ? error.message : msg("Upload failed. Try again.") });
        removeImagesOf(fileId);
      });
    }
  }, [removeImagesOf, scheduleSave]);

  // ---- 画面の状態（自前のツールバー・パネルに出すもの）。変わった時だけ描き直す。 ----
  const uiKey = useRef("");
  const readUi = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    const selected = elements.filter((element) => !element.isDeleted && appState.selectedElementIds[element.id]) as NonDeletedExcalidrawElement[];
    const next = deriveUiState(selected, appState);
    const key = JSON.stringify(next);
    if (key !== uiKey.current) { uiKey.current = key; setUi(next); }
  }, []);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    readUi(elements, appState);
    if (editable) startUploads(elements, files);
    if (signatureOf(elements, appState) !== lastSignature.current) scheduleSave();
  }, [editable, readUi, scheduleSave, signatureOf, startUploads]);

  // 最初の内容を「保存済み」として覚える（開いただけでは保存しない）。
  useEffect(() => {
    if (!api) return;
    const signature = signatureOf(api.getSceneElementsIncludingDeleted(), api.getAppState());
    lastSignature.current = signature;
    queueMicrotask(() => setSceneVersion(signature));
    actionsRef.current = connectWhiteboardActions(api as never, containerRef.current?.querySelector(".excalidraw") as HTMLElement | null);
    readUi(api.getSceneElements(), api.getAppState());
    queueMicrotask(updateContentHidden);
  }, [api, readUi, signatureOf, updateContentHidden]);

  // ---- 表示位置を覚える。見えている範囲に内容が無ければ「内容に戻る」を出す。 ----
  useEffect(() => {
    if (!api) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const off = api.onScrollChange((scrollX, scrollY, zoom) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        writeViewport(pageId, { scrollX, scrollY, zoom: zoom.value });
        updateContentHidden();
      }, 250);
    });
    return () => { clearTimeout(timer); off(); };
  }, [api, pageId, updateContentHidden]);

  useKeepDocumentLanguage(locale, dir);

  // ---- 検索の結果などから、要素まで動かす ----
  const reveal = useCallback((elementId: string) => {
    if (!api) return false;
    const element = api.getSceneElements().find((entry) => entry.id === elementId);
    if (!element) return false;
    api.setViewport({ target: element, fit: "scale-down", animation: true });
    api.selection.select(element.id);
    return true;
  }, [api]);
  useEffect(() => {
    if (!api) return;
    const pending = consumeWhiteboardReveal(pageId);
    if (pending) queueMicrotask(() => reveal(pending));
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<WhiteboardRevealDetail>).detail;
      if (detail?.pageId === pageId && consumeWhiteboardReveal(pageId)) reveal(detail.elementId);
    };
    window.addEventListener(WHITEBOARD_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(WHITEBOARD_REVEAL_EVENT, onReveal);
  }, [api, pageId, reveal]);

  useImperativeHandle(handleRef, () => ({
    reveal,
    selectionContext: () => {
      if (!api) return { ids: [], text: "" };
      const appState = api.getAppState();
      const elements = api.getSceneElements();
      const ids = elements.filter((element) => appState.selectedElementIds[element.id]).map((element) => element.id);
      const chosen = new Set(ids);
      const text = elements
        .filter((element) => element.type === "text" && (chosen.has(element.id) || chosen.has((element as { containerId?: string | null }).containerId ?? "")))
        .map((element) => (element as { originalText?: string; text?: string }).originalText ?? (element as { text?: string }).text ?? "")
        .filter(Boolean).join("\n");
      return { ids, text };
    },
  }), [api, reveal]);

  // ---- 要素のリンク：アプリ内のページはその場で開く ----
  const onLinkOpen = useCallback((element: NonDeletedExcalidrawElement, event: CustomEvent<{ nativeEvent: MouseEvent | React.PointerEvent<HTMLCanvasElement> }>) => {
    const id = pageIdFromLink(element.link, window.location.origin);
    if (!id) return;
    const native = event.detail.nativeEvent;
    event.preventDefault();
    if (onOpenPage && !(native.metaKey || native.ctrlKey || native.shiftKey) && onOpenPage(id)) return;
    window.open(pageLinkUrl(id), "_blank", "noopener,noreferrer");
  }, [onOpenPage]);

  // ---- 道具の切り替え。ペン・蛍光ペン・図形は、それぞれの色・太さ・不透明度を覚えておき、切り替える時に入れ替える ----
  const [drawMode, setDrawMode] = useState<DrawMode | null>(null);
  const drawModeRef = useRef<DrawMode | null>(null);
  const styles = useRef<Record<DrawMode | "shape", ToolStyle | null>>({ pen: PEN_DEFAULT, highlighter: HIGHLIGHTER_DEFAULT, shape: null });
  const switchStyle = useCallback((next: DrawMode | null) => {
    if (!api) return;
    const current = drawModeRef.current;
    if (current === next) return;
    const appState = api.getAppState();
    styles.current[current ?? "shape"] = styleOf(appState);
    const target = styles.current[next ?? "shape"];
    drawModeRef.current = next;
    setDrawMode(next);
    if (target) api.updateScene({ appState: styleUpdate(target), captureUpdate: CaptureUpdateAction.NEVER });
  }, [api]);
  const selectTool = useCallback((tool: WhiteboardTool) => {
    if (!api) return;
    switchStyle(tool === "pen" || tool === "highlighter" ? tool : null);
    if (tool === "image") { api.setActiveTool({ type: "image" }); return; }
    api.setActiveTool({ type: toolType(tool) } as never);
  }, [api, switchStyle]);
  // キーボード（P など）で道具が変わったときも、色の組を合わせる。
  const lastTool = useRef<string | null>(null);
  useEffect(() => {
    if (!ui || ui.tool === lastTool.current) return;
    lastTool.current = ui.tool;
    if (ui.tool === "freedraw" && !drawModeRef.current) queueMicrotask(() => switchStyle("pen"));
    else if (ui.tool !== "freedraw" && drawModeRef.current) queueMicrotask(() => switchStyle(null));
  }, [ui, switchStyle]);

  // アプリ（/note-embed）には、描く道具を使っている間を知らせる（端の戻るジェスチャーを避けてもらう）。手のひらの間は普通に戻れる。
  const drawing = Boolean(ui && editable && ui.tool !== "hand");
  useEffect(() => {
    if (!embedded) return;
    postToNative({ type: "drawing", active: drawing });
  }, [embedded, drawing]);
  useEffect(() => () => { if (embedded) postToNative({ type: "drawing", active: false }); }, [embedded]);

  // 手で触る端末（スマホ・アプリ）は、最初は手のひら（1 本指でスクロール）。ペンを選ぶと 1 本指で描き、2 本指で拡大縮小・移動する。
  const touchOnly = useMediaQuery("(pointer: coarse) and (hover: none)");
  useEffect(() => {
    if (!api || !editable || !(touchOnly || embedded)) return;
    api.setActiveTool({ type: "hand" });
  }, [api, editable, touchOnly, embedded]);

  // 画面の幅ではなく、キャンバスの幅で並べ方を変える（サイドバー・分割表示で狭くなる）。
  const [width, setWidth] = useState(1024);
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const compact = width < 640;
  const narrow = width < 1010;

  const fitToContent = useCallback(() => {
    if (!api) return;
    const elements = api.getSceneElements();
    if (elements.length) api.setViewport({ target: elements, fit: "scale-down", animation: true });
    else api.setViewport({ target: { x: 0, y: 0 }, fit: "none", animation: true });
  }, [api]);

  const sceneCenter = useCallback(() => {
    const view = visibleRect(api!.getAppState());
    return { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  }, [api]);

  // ---- リンクとページのカード ----
  const setLinkOnSelection = useCallback((link: string | null) => {
    if (!api) return;
    const state = api.getAppState();
    api.updateScene({
      elements: api.getSceneElementsIncludingDeleted().map((element) => state.selectedElementIds[element.id] && !element.isDeleted ? newElementWith(element, { link }) : element),
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
  }, [api]);

  const insertPageCard = useCallback((page: MentionPage) => {
    if (!api) return;
    const center = sceneCenter();
    const created = convertToExcalidrawElements([{
      type: "rectangle", x: center.x - 140, y: center.y - 36, width: 280, height: 72,
      strokeColor: "#1971c2", backgroundColor: "#e7f5ff", fillStyle: "solid", roughness: 0, strokeWidth: 1, roundness: { type: 3 },
      link: pageLinkUrl(page.id), customData: { notefablePage: { id: page.id, kind: page.kind ?? "note" } },
      label: { text: pageCardLabel(page, t("Untitled")), fontSize: 18, fontFamily: FONT_FAMILY.Nunito, textAlign: "left", verticalAlign: "middle" },
    }]);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    api.setActiveTool({ type: "selection" });
    api.selection.select(created[0].id);
  }, [api, sceneCenter, t]);

  const openLinkDialog = useCallback(() => {
    if (!api) return;
    const state = api.getAppState();
    const selected = api.getSceneElements().filter((element) => state.selectedElementIds[element.id]);
    if (!selected.length) return;
    const links = new Set(selected.map((element) => element.link ?? ""));
    const current = links.size === 1 ? [...links][0] : "";
    setLinkDialog({ mode: "link", url: current && !pageIdFromLink(current, window.location.origin) ? current : undefined });
  }, [api]);

  // ---- 書き出し ----
  const runExport = useCallback(async (format: WhiteboardExportFormat) => {
    if (!api || busy) return;
    setNotice(null);
    setBusy(t("Exporting…"));
    try {
      const file = await exportWhiteboard(api, format, props.title);
      if (!(await deliverExport(file, embedded))) setNotice({ text: msg("Update the app to save exported files.") });
    } catch (error) {
      setNotice({ text: error instanceof Error && error.message ? error.message : msg("Could not export the whiteboard.") });
    } finally { setBusy(null); }
  }, [api, busy, embedded, props.title, t]);

  // ---- PDF の取り込み：ページごとに画像にして、枠に入れて縦に並べる ----
  const insertPdf = useCallback((result: PdfImportResult) => {
    if (!api || !result.pages.length) return;
    const existing = api.getSceneElements();
    const gap = 80;
    const first = result.pages[0];
    let x: number; let y: number;
    if (existing.length) {
      const [, y1, x2] = getCommonBounds(existing);
      x = x2 + 160;
      y = y1;
    } else {
      const center = sceneCenter();
      x = center.x - first.width / 2;
      y = center.y - first.height / 2;
    }
    const files: BinaryFileData[] = [];
    const skeleton: Parameters<typeof convertToExcalidrawElements>[0] = [];
    for (const page of result.pages) {
      const fileId = randomId() as FileId;
      const imageId = randomId();
      files.push({ id: fileId, mimeType: page.mimeType as BinaryFileData["mimeType"], dataURL: page.url as BinaryFileData["dataURL"], created: Date.now() });
      uploadedUrls.current.set(fileId, { url: page.url, mimeType: page.mimeType });
      skeleton!.push({ type: "image", id: imageId, x, y, width: page.width, height: page.height, fileId, status: "saved", locked: true });
      skeleton!.push({ type: "frame", children: [imageId], name: `${result.name} · ${page.page}` });
      y += page.height + gap;
    }
    api.addFiles(files);
    const created = convertToExcalidrawElements(skeleton);
    api.updateScene({ elements: [...api.getSceneElementsIncludingDeleted(), ...created], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
    const frame = created.find((element) => element.type === "frame");
    if (frame) api.setViewport({ target: frame, fit: "scale-down", animation: true });
  }, [api, sceneCenter]);

  const importPdf = useCallback(async (file: File) => {
    if (!api || busy) return;
    setNotice(null);
    setBusy(t("Importing PDF…"));
    try {
      const result = await importPdfPages(file, { onProgress: (done, total) => setBusy(t("Importing page {done} of {total}…", { done: Math.min(done + 1, total), total })) });
      insertPdf(result);
      if (result.total > MAX_PDF_IMPORT_PAGES) setNotice({ text: msg("Only the first {max} pages were imported."), vars: { max: MAX_PDF_IMPORT_PAGES } });
    } catch (error) {
      if (!(error instanceof StorageLimitError)) setNotice({ text: error instanceof Error && error.message ? error.message : msg("Could not read this PDF.") });
    } finally { setBusy(null); }
  }, [api, busy, insertPdf, t]);

  const toggleMinimap = useCallback(() => {
    setMinimapOpen((open) => {
      try { localStorage.setItem(MINIMAP_KEY, open ? "0" : "1"); } catch { /* 覚えられなくても切り替えはできる。 */ }
      return !open;
    });
  }, []);

  return (
    <div ref={containerRef} className={`whiteboard${embedded ? " is-embedded" : ""}${editable ? "" : " is-readonly"}${compact ? " is-compact" : narrow ? " is-narrow" : ""}`} data-theme={theme}>
      <Excalidraw
        onExcalidrawAPI={setApi}
        initialData={initial}
        ui={false}
        theme={theme}
        langCode={excalidrawLang(locale)}
        viewModeEnabled={!editable}
        onChange={handleChange}
        onLinkOpen={onLinkOpen}
        imageOptions={{ maxFileSizeBytes: MAX_NOTE_FILE_BYTES, maxWidthOrHeight: 2560 }}
        autoFocus={!embedded}
      />
      {ui && api && <WhiteboardChrome ui={ui} drawMode={drawMode} editable={editable} embedded={embedded} compact={compact} theme={theme} actions={actionsRef.current}
        title={props.title} icon={props.icon} onTitleChange={props.onTitleChange} onIconChange={props.onIconChange}
        onSelectTool={selectTool} onLink={openLinkDialog} onInsertPageCard={() => setLinkDialog({ mode: "card" })}
        onExport={(format) => void runExport(format)} onImportPdf={() => pdfInputRef.current?.click()}
        onFitToContent={fitToContent} onCanvasBackground={(color) => api.updateScene({ appState: { viewBackgroundColor: color }, captureUpdate: CaptureUpdateAction.IMMEDIATELY })}
        onPenMode={(penMode) => api.updateScene({ appState: { penMode }, captureUpdate: CaptureUpdateAction.NEVER })}
        minimapOpen={minimapOpen} onToggleMinimap={toggleMinimap} contentHidden={contentHidden} busy={busy} pages={props.pages} aiSlot={props.aiSlot}
        minimap={<WhiteboardMinimap api={api} version={sceneVersion} theme={theme} />} />}
      <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void importPdf(file);
        }} />
      {linkDialog && <WhiteboardLinkDialog mode={linkDialog.mode} pages={props.pages} currentPageId={pageId} initialUrl={linkDialog.url}
        onPickPage={(page) => {
          setLinkDialog(null);
          if (linkDialog.mode === "card") insertPageCard(page);
          else setLinkOnSelection(pageLinkUrl(page.id));
        }}
        onPickUrl={linkDialog.mode === "link" ? (url) => { setLinkDialog(null); setLinkOnSelection(url); } : undefined}
        onRemove={linkDialog.mode === "link" ? () => { setLinkDialog(null); setLinkOnSelection(null); } : undefined}
        onClose={() => setLinkDialog(null)} />}
      {notice && <div className="whiteboard-notice" role="alert"><span>{notice.vars ? t(notice.text, notice.vars) : localizeSystemText(notice.text, t)}</span><button type="button" className="notion-button" onClick={() => setNotice(null)}>{t("Close")}</button></div>}
    </div>
  );
}

// 自前の画面に出す状態。選んでいる要素の種類・共通の見た目と、次に描く図形の見た目。
function deriveUiState(selected: readonly NonDeletedExcalidrawElement[], appState: AppState): WhiteboardUiState {
  const common = <T,>(read: (element: NonDeletedExcalidrawElement) => T | undefined, fallback: T): T | null => {
    if (!selected.length) return fallback;
    const values = new Set(selected.map(read).filter((value) => value !== undefined));
    return values.size === 1 ? [...values][0] as T : values.size === 0 ? fallback : null;
  };
  const roundness = (element: NonDeletedExcalidrawElement) => element.roundness ? "round" : "sharp";
  return {
    tool: appState.activeTool.type,
    toolLocked: appState.activeTool.locked,
    selectedCount: selected.length,
    selectedTypes: [...new Set(selected.map((element) => element.type))].sort(),
    groupSelected: Object.keys(appState.selectedGroupIds ?? {}).some((id) => appState.selectedGroupIds[id]),
    allLocked: selected.length > 0 && selected.every((element) => element.locked),
    editingText: Boolean(appState.editingTextElement),
    zoom: appState.zoom.value,
    grid: appState.gridModeEnabled,
    snap: appState.objectsSnapModeEnabled,
    penMode: appState.penMode,
    penDetected: appState.penDetected,
    viewBackgroundColor: appState.viewBackgroundColor,
    style: {
      strokeColor: common((element) => element.strokeColor, appState.currentItemStrokeColor),
      backgroundColor: common((element) => element.backgroundColor, appState.currentItemBackgroundColor),
      opacity: common((element) => element.opacity, appState.currentItemOpacity),
      roughness: common((element) => element.roughness, appState.currentItemRoughness),
      strokeStyle: common((element) => element.strokeStyle, appState.currentItemStrokeStyle),
      fillStyle: common((element) => element.fillStyle, appState.currentItemFillStyle),
      roundness: common(roundness, appState.currentItemRoundness),
      strokeWidthKey: selected.length ? null : appState.currentItemStrokeWidthKey,
      strokeWidth: common((element) => element.strokeWidth, null as number | null),
      fontFamily: common((element) => "fontFamily" in element ? element.fontFamily as number : undefined, appState.currentItemFontFamily),
      fontSize: common((element) => "fontSize" in element ? element.fontSize as number : undefined, appState.currentItemFontSize),
      textAlign: common((element) => "textAlign" in element ? element.textAlign as string : undefined, appState.currentItemTextAlign),
      arrowType: common((element) => element.type === "arrow" ? ((element as { elbowed?: boolean }).elbowed ? "elbow" : element.roundness ? "round" : "sharp") : undefined, appState.currentItemArrowType),
      startArrowhead: common((element) => "startArrowhead" in element ? element.startArrowhead as string | null : undefined, appState.currentItemStartArrowhead),
      endArrowhead: common((element) => "endArrowhead" in element ? element.endArrowhead as string | null : undefined, appState.currentItemEndArrowhead),
      variability: common((element) => element.type === "freedraw" ? (element as { strokeOptions?: { variability?: string } }).strokeOptions?.variability : undefined, appState.currentItemStrokeVariability),
    },
  };
}

export { isDrawingTool };
