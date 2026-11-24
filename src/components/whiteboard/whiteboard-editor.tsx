"use client";

import { CaptureUpdateAction, convertToExcalidrawElements, Excalidraw, FONT_FAMILY, getCommonBounds, getSceneVersion, newElementWith } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, AppState, BinaryFiles, BinaryFileData } from "@excalidraw/excalidraw/types";
import type { ExcalidrawElement, FileId, NonDeletedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactNode, type Ref } from "react";
import "@excalidraw/excalidraw/index.css";
import "./whiteboard.css";
import { useI18n } from "@/components/i18n-provider";
import { localizeSystemText, msg, type TranslateVars } from "@/lib/i18n/translate";
import { useTheme } from "@/lib/theme";
import { postToNative } from "@/lib/native-bridge";
import { MAX_NOTE_FILE_BYTES } from "@/lib/note-file-keys";
import { StorageLimitError } from "@/lib/usage-plans";
import { useMediaQuery } from "@/lib/use-media-query";
import { connectWhiteboardActions, type WhiteboardActions } from "@/lib/whiteboard/excalidraw-bridge";
import { exportWhiteboard, exportWhiteboardSelectionPng, type WhiteboardExportFormat } from "@/lib/whiteboard/export";
import { expandWhiteboardSelection } from "@/lib/whiteboard/selection-capture";
import type { PageSelection } from "@/lib/page-ai/types";
import { getNativeExportEpoch, saveExportFile } from "@/lib/export-file";
import { pageCardLabel, pageIdFromLink, pageLinkUrl } from "@/lib/whiteboard/links";
import { importPdfPages, MAX_PDF_IMPORT_PAGES, type PdfImportResult } from "@/lib/whiteboard/pdf-import";
import { consumeWhiteboardReveal, WHITEBOARD_REVEAL_EVENT, type WhiteboardRevealDetail } from "@/lib/whiteboard/reveal";
import { fitStoredWhiteboard, isStoredFileUrl, sceneToStored, storedToScene, type StoredWhiteboard, type WhiteboardElement } from "@/lib/whiteboard/scene";
import { MAX_CANVAS_BYTES } from "@/lib/canvas-document";
import { uploadWhiteboardImage } from "@/lib/whiteboard/upload";
import { registerCanvasFlusher } from "@/lib/canvas-flush";
import { WhiteboardChrome, toolType, type WhiteboardTool, type WhiteboardUiState } from "@/components/whiteboard/whiteboard-ui";
import { WhiteboardLinkDialog } from "@/components/whiteboard/whiteboard-link-dialog";
import { excalidrawLang, useKeepDocumentLanguage } from "@/components/whiteboard/excalidraw-locale";
import { WhiteboardMinimap } from "@/components/whiteboard/whiteboard-minimap";
import type { MentionPage } from "@/components/note-mention";

// ホワイトボードのエディター（Excalidraw をもとに、画面は NoteFable 自身のツールバーとパネル。docs/architecture/whiteboard.md）。
// 動的に読み込む（SSR しない）。/app のノート画面・分割表示・/note-embed（アプリの WebView）で使う。
// 本体の保存は呼び出し側（NotesWorkspace → NoteSaveQueue）が行う。ここは内容が変わったら onChange で保存する形（StoredWhiteboard）を渡す。

// 図形用のフォントは自分のサイトから配る（scripts/copy-whiteboard-assets.mjs が public/whiteboard/fonts へ写す）。CDN からは読まない。
if (typeof window !== "undefined") (window as unknown as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = "/whiteboard/";

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
  // 保存キューの世代（CanvasEditorProps.generation）。
  generation?: number;
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
  // 選んだ要素について AI に聞く（AI パネルを開いて選区コンテキストと画像キャプチャを渡す）。
  onAskAi?: (selection: PageSelection) => void;
  // 右下（AI ボタン、#153）用に空けておく場所の中身。
  aiSlot?: ReactNode;
  handleRef?: Ref<WhiteboardEditorHandle>;
};

type UploadState = { status: "uploading" } | { status: "done"; url: string; mimeType: string } | { status: "failed" };
// アプリが編集画面を閉じる前の flush で、アップロード中の画像を待つ時間（アプリの flush の待ち時間 15 秒より短く）。
const UPLOAD_FLUSH_WAIT_MS = 10_000;
// 同じページの白板が開き直された（分割表示と全画面の切り替え・開き直し）後に、閉じた方のエディターで画像のアップロードが終わったときは、
// 閉じた方の古い scene を渡さず（開いている方の変更を上書きしてしまう）、開いている方のエディターへ画像を渡す。
type AdoptUpload = (images: readonly ExcalidrawElement[], file: { id: string; url: string; mimeType: string }) => boolean;
const liveEditors = new Map<string, Set<{ adopt: AdoptUpload }>>();
type SceneRefs = { elements: readonly ExcalidrawElement[]; appState: AppState; files: BinaryFiles };

// ペン・蛍光ペン・図形のそれぞれで覚えておく見た目。
type DrawMode = "pen" | "highlighter";
type ToolStyle = { strokeColor: string; opacity: number; strokeWidthKey: string; variability: string };
const PEN_DEFAULT: ToolStyle = { strokeColor: "#1e1e1e", opacity: 100, strokeWidthKey: "medium", variability: "variable" };
// 蛍光ペンは半透明の太い線（下の文字や画像が透けて見える）。
// 太さは Excalidraw の手書き線の extraBold（画面の選択肢より太い。蛍光ペンだけが使う）。
const HIGHLIGHTER_DEFAULT: ToolStyle = { strokeColor: "#ffd43b", opacity: 40, strokeWidthKey: "extraBold", variability: "constant" };
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

// 見えている範囲に内容が 1 つも無いか（「内容に戻る」を出す）。
function contentHiddenIn(target: ExcalidrawImperativeAPI) {
  const elements = target.getSceneElements();
  const appState = target.getAppState();
  // 大きさがまだ 0（見えていない枠・後から広がる App の WebView）のときは判断しない。大きさが決まったら見直す。
  if (!elements.length || !appState.width || !appState.height) return false;
  const [x1, y1, x2, y2] = getCommonBounds(elements);
  const view = visibleRect(appState);
  return x2 < view.x || x1 > view.x + view.width || y2 < view.y || y1 > view.y + view.height;
}

// 開いたときの表示位置。検索の結果から開いたときはその要素へ動かし（見つからなければ依頼を残す）、それ以外で fit なら内容がすべて見えるように縮める（100% より大きくしない）。
function placeOnOpen(target: ExcalidrawImperativeAPI, pageId: string, fit: boolean) {
  const revealed = Boolean(consumeWhiteboardReveal(pageId, Date.now(), (elementId) => revealIn(target, elementId, false)));
  const elements = target.getSceneElements();
  if (!revealed && fit && elements.length) target.setViewport({ target: elements, fit: "scale-down" });
}

// その要素まで動かして選ぶ。見つからなければ false。
function revealIn(target: ExcalidrawImperativeAPI, elementId: string, animation = true) {
  const element = target.getSceneElements().find((entry) => entry.id === elementId);
  if (!element) return false;
  target.setViewport({ target: element, fit: "scale-down", animation });
  target.selection.select(element.id);
  return true;
}

function randomId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export default function WhiteboardEditor(props: WhiteboardEditorProps) {
  const { pageId, data, generation, editable, embedded, onChange, onOpenPage, handleRef } = props;
  // 開いた時の保存キューの世代。同じページ・同じ世代のエディターどうしだけで、閉じた方の画像を受け渡す
  // （最新の版を読む・版の復元で中身を置き換えた後のエディターへ、置き換える前の画像を入れない）。
  const liveKey = useMemo(() => `${pageId}:${generation ?? 0}`, [pageId, generation]);
  const { t, locale, dir } = useI18n();
  const { resolved: theme } = useTheme();
  const [api, setApi] = useState<ExcalidrawImperativeAPI | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Excalidraw の組み込みの操作（excalidraw-bridge.ts）。editor が用意できてからつなぐ。
  const [actions, setActions] = useState<WhiteboardActions | null>(null);
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
  // 開いた時からこの白板が持っている note-files のファイル（サーバーが持ち主を確かめ済み）。貼り付けで来た note-files の URL は、
  // 自分のファイルか（読めるか）を確かめるまで保存に入れない（ほかのアカウントのファイルが入ると、保存がすべて断られる）。
  const knownFiles = useRef(new Set(Object.keys(initial.files ?? {})));
  const verifying = useRef(new Set<string>());
  const lastSignature = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  // Excalidraw が最後に知らせた scene（onChange の引数をそのまま持つだけ。閉じた後にも保存の形を作れるように）。
  const latestScene = useRef<SceneRefs | null>(null);
  // onChange へまだ渡していない変更があるか（描き終わり待ち・400 ms の間・画像のアップロードが終わった直後）。
  const dirty = useRef(false);
  // まだ渡していない変更が、編集できる間に入ったものか（描いた・画像のアップロードが終わった）。ページの操作（作成・複製・ゴミ箱）の間は
  // editable が一時的に false になるが、その前に入った変更は捨てずに渡す。読み取り専用（ロック）になってから届いた変更は渡さない。
  const ownEdit = useRef(false);
  // 開いてから自分で何か変えたか。変えるまでは、同じページの前のエディター（閉じた方）が後から渡した新しい内容に入れ替える
  // （開いた時の内容は、閉じた方が最後の変更を渡す前に読んだものなので）。
  const touched = useRef(false);
  const appliedData = useRef(data);
  const latestData = useRef(data);
  useEffect(() => { latestData.current = data; }, [data]);
  // アップロード中の画像（アプリの flush で終わるのを待つ）。
  const uploadTasks = useRef(new Set<Promise<void>>());
  // 閉じたか。Excalidraw は閉じると中身を空にするが、受け取った API の isDestroyed は false のまま：閉じた後は API を使わない
  // （使うと空の内容を保存してしまう）。
  const mounted = useRef(true);
  // Excalidraw が最初の内容を読み終えたか（onInitialize）。それまでの onChange は読み込みそのもので、保存しない。
  const initialized = useRef(false);
  // 枠の大きさが 0 のまま開いたので、大きさが決まるまで待っている表示位置（検索ターゲットはサイズ確定まで消費しない）。
  const deferredPlacement = useRef<{ fit: boolean } | null>(null);
  // 最後に見た Excalidraw の大きさ（appState.width × height）。変わったら表示位置と「内容に戻る」を見直す。
  const lastSize = useRef("");
  // 取り込み中の PDF（閉じたらやめる）。
  const pdfAbort = useRef<AbortController | null>(null);

  const signatureOf = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    const persisted = [appState.viewBackgroundColor, appState.gridModeEnabled, appState.gridSize, appState.gridStep, appState.objectsSnapModeEnabled];
    return `${getSceneVersion(elements)}|${elements.length}|${uploadedUrls.current.size}|${JSON.stringify(persisted)}`;
  }, []);

  const updateContentHidden = useCallback(() => {
    if (!api || !mounted.current) return;
    setContentHidden(contentHiddenIn(api));
  }, [api]);

  // scene から保存の形を作って渡す。
  const emit = useCallback(({ elements, files, appState }: SceneRefs) => {
    const { data: stored } = sceneToStored({
      elements: elements as unknown as WhiteboardElement[],
      files: files as unknown as Parameters<typeof sceneToStored>[0]["files"],
      appState,
      uploaded: uploadedUrls.current,
      blocked: verifying.current,
    });
    // 上限（2 MB）に近いときだけ、手書きの線の点を間引いて収める（ふだんは点をそのまま残す）。
    const { data: fitted } = fitStoredWhiteboard(stored, Math.floor(MAX_CANVAS_BYTES.whiteboard * 0.95));
    dirty.current = false;
    onChangeRef.current(fitted);
  }, []);

  const serializeNow = useCallback(() => {
    if (!api || !mounted.current) return;
    emit({ elements: api.getSceneElementsIncludingDeleted(), files: api.getFiles(), appState: api.getAppState() });
  }, [api, emit]);

  // まだ渡していない変更を、待たずにすぐ渡す（閉じる時・画面が隠れる時・アプリの flush の前）。最後に知らせを受けた scene を使うので、
  // Excalidraw が閉じた後でも動く。描いている途中の線も、その時点の形で入れる。
  const flushPending = useCallback(() => {
    const scene = latestScene.current;
    if (!dirty.current || !scene) return;
    clearTimeout(saveTimer.current);
    dirty.current = false;
    if (!ownEdit.current) return;
    ownEdit.current = false;
    lastSignature.current = signatureOf(scene.elements, scene.appState);
    emit(scene);
  }, [emit, signatureOf]);

  const scheduleSave = useCallback(() => {
    const tick = () => {
      if (!api || !mounted.current) return;
      const appState = api.getAppState();
      // 描いている途中・動かしている途中は待つ（終わってから 1 回だけ保存の形を作る）。
      if (appState.newElement || appState.selectedElementsAreBeingDragged || appState.isResizing || appState.isRotating) { saveTimer.current = setTimeout(tick, 400); return; }
      const signature = signatureOf(api.getSceneElementsIncludingDeleted(), appState);
      if (signature === lastSignature.current) { dirty.current = false; return; }
      lastSignature.current = signature;
      setSceneVersion(signature);
      updateContentHidden();
      if (ownEdit.current) { ownEdit.current = false; serializeNow(); }
      else dirty.current = false;
    };
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(tick, 400);
  }, [api, serializeNow, signatureOf, updateContentHidden]);

  // 閉じる時（ページの切り替えなど）と画面が隠れる時は、待たずに渡す。保存キューの flush（use-note-pages の visibilitychange）より
  // 先に渡すため、window の捕捉段階で受ける。
  const flushRef = useRef(flushPending);
  useEffect(() => { flushRef.current = flushPending; }, [flushPending]);
  useEffect(() => {
    mounted.current = true;
    const onVisibility = () => { if (document.visibilityState === "hidden") flushRef.current(); };
    const onPageHide = () => flushRef.current();
    window.addEventListener("visibilitychange", onVisibility, true);
    window.addEventListener("pagehide", onPageHide, true);
    return () => {
      mounted.current = false;
      pdfAbort.current?.abort();
      window.removeEventListener("visibilitychange", onVisibility, true);
      window.removeEventListener("pagehide", onPageHide, true);
      flushRef.current();
      clearTimeout(saveTimer.current);
    };
  }, []);
  const adoptRef = useRef<AdoptUpload>(() => false);
  useEffect(() => {
    adoptRef.current = (images, file) => {
      // 最初の内容を読み終える前は受け取らない（読み込みが scene を置き換えて消える）。閉じた方が保存キューへ渡し、読み終えた時に拾う。
      if (!api || !mounted.current || !initialized.current) return false;
      const current = api.getSceneElementsIncludingDeleted();
      const present = new Set(current.map((element) => element.id));
      const added = images.filter((element) => !present.has(element.id));
      uploadedUrls.current.set(file.id, { url: file.url, mimeType: file.mimeType });
      uploads.current.set(file.id, { status: "done", url: file.url, mimeType: file.mimeType });
      api.addFiles([{ id: file.id as BinaryFileData["id"], dataURL: file.url as BinaryFileData["dataURL"], mimeType: file.mimeType as BinaryFileData["mimeType"], created: Date.now() }]);
      if (added.length) api.updateScene({ elements: [...current, ...added], captureUpdate: CaptureUpdateAction.IMMEDIATELY });
      lastSignature.current = null;
      dirty.current = true;
      ownEdit.current = true;
      touched.current = true;
      scheduleSave();
      return true;
    };
  });
  useEffect(() => {
    const entry = { adopt: ((images, file) => adoptRef.current(images, file)) as AdoptUpload };
    let set = liveEditors.get(liveKey);
    if (!set) { set = new Set(); liveEditors.set(liveKey, set); }
    set.add(entry);
    return () => {
      set.delete(entry);
      if (!set.size) liveEditors.delete(liveKey);
    };
  }, [liveKey]);

  // アプリが編集画面を閉じる前の flush（/note-embed）：変更を渡し、アップロード中の画像は少し待ってから入れ直す。
  // 待っても終わらない画像があれば false（保存し切れていない。アプリは編集画面を閉じずに知らせる）。
  // 第 2 引数の同期フラッシュは、裏の再検証が loadLatest() を呼ぶ前に 400ms 待ちの線やアップロード中画像を拾うために使う。
  useEffect(() => registerCanvasFlusher(
    async () => {
      flushRef.current();
      if (!uploadTasks.current.size) return true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        Promise.allSettled([...uploadTasks.current]),
        new Promise<void>((resolve) => { timer = setTimeout(resolve, UPLOAD_FLUSH_WAIT_MS); }),
      ]);
      clearTimeout(timer);
      flushRef.current();
      return uploadTasks.current.size === 0;
    },
    () => {
      flushRef.current();
      return uploadTasks.current.size > 0;
    },
    pageId,
  ), [pageId]);

  // ---- 画像のアップロード（Excalidraw は貼り付け・ドロップ・画像ツールの画像を data: で持つ。保存には note-files の URL を使う） ----
  const removeImagesOf = useCallback((fileId: string) => {
    if (!api || !mounted.current) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const images = new Set(elements.filter((element) => element.type === "image" && (element as { fileId?: string }).fileId === fileId).map((element) => element.id));
    if (!images.size) return;
    api.updateScene({
      elements: elements.filter((element) => !images.has(element.id) && !(element.type === "text" && images.has((element as { containerId?: string | null }).containerId ?? ""))),
      captureUpdate: CaptureUpdateAction.NEVER,
    });
  }, [api]);

  // 画像が保存に入れられるようになった（アップロード・貼り付けの確認が終わった）：保存し直す（signature の uploaded の数が変わる）。
  // 閉じた後に終わったときは、同じページ・同じ世代で開き直したエディターがあれば、そちらへ画像を渡す（閉じた方の古い scene は
  // 渡さない：開いている方の変更を上書きする）。無ければ最後の scene ですぐ渡す。画像がもう使われていなければ何もしない。
  const handUpload = useCallback((fileId: string, file: { url: string; mimeType: string }) => {
    lastSignature.current = null;
    dirty.current = true;
    ownEdit.current = true;
    touched.current = true;
    if (mounted.current) { scheduleSave(); return; }
    const images = (latestScene.current?.elements ?? []).filter((element) => !element.isDeleted && element.type === "image" && (element as { fileId?: string | null }).fileId === fileId);
    if (!images.length) return;
    const live = [...(liveEditors.get(liveKey) ?? [])].at(-1);
    if (live && live.adopt(images, { id: fileId, ...file })) return;
    flushRef.current();
  }, [liveKey, scheduleSave]);

  const startUploads = useCallback((elements: readonly ExcalidrawElement[], files: BinaryFiles) => {
    const used = new Set(elements.filter((element) => !element.isDeleted && element.type === "image").map((element) => (element as { fileId?: string | null }).fileId).filter(Boolean));
    for (const [fileId, file] of Object.entries(files)) {
      // 自分の note-files の URL（保存済み・PDF の取り込み）でなければアップロードする。data: のほか、ほかの URL の画像
      // （公開リンクのビューからコピーしたものなど）も、読めればここへ写す（読めなければ取り除く）。
      if (!used.has(fileId) || uploads.current.has(fileId) || uploadedUrls.current.has(fileId)) continue;
      if (isStoredFileUrl(file.dataURL)) {
        if (knownFiles.current.has(fileId)) continue;
        // 貼り付けで来た note-files の URL：読めれば自分のファイル（そのまま使う）、読めなければほかのアカウントのもの（取り除く）。
        // 確かめている間も、読めなかった後も保存に入れない（verifying に残す。画面から消えるのは少し後なので）。
        const url = file.dataURL;
        uploads.current.set(fileId, { status: "uploading" });
        verifying.current.add(fileId);
        const check: Promise<void> = fetch(url, { cache: "no-store", credentials: "same-origin" }).then((response) => {
          void response.body?.cancel();
          if (!response.ok) throw new Error("unreadable");
          verifying.current.delete(fileId);
          knownFiles.current.add(fileId);
          uploads.current.set(fileId, { status: "done", url, mimeType: file.mimeType });
          handUpload(fileId, { url, mimeType: file.mimeType });
        }).catch(() => {
          uploads.current.delete(fileId);
          if (!mounted.current) return;
          setNotice({ text: msg("This image can't be copied here.") });
          removeImagesOf(fileId);
        }).finally(() => { uploadTasks.current.delete(check); });
        uploadTasks.current.add(check);
        continue;
      }
      uploads.current.set(fileId, { status: "uploading" });
      const task: Promise<void> = uploadWhiteboardImage(file.dataURL, file.mimeType, fileId).then((result) => {
        uploads.current.set(fileId, { status: "done", ...result });
        uploadedUrls.current.set(fileId, result);
        handUpload(fileId, result);
      }).catch((error: unknown) => {
        if (!mounted.current) { uploads.current.delete(fileId); return; }
        // 容量の上限は NotesWorkspace の案内（storage-limit-client）が出す。ここは画像を取り除くだけ。
        if (!(error instanceof StorageLimitError)) setNotice({ text: error instanceof Error && error.message ? error.message : msg("Upload failed. Try again.") });
        removeImagesOf(fileId);
        // 同じ画像（同じ fileId）をもう一度貼ったときに、改めてアップロードできるよう記録を消す。
        uploads.current.delete(fileId);
      }).finally(() => { uploadTasks.current.delete(task); });
      uploadTasks.current.add(task);
    }
  }, [handUpload, removeImagesOf]);

  // ---- 画面の状態（自前のツールバー・パネルに出すもの）。変わった時だけ描き直す。 ----
  const uiKey = useRef("");
  const readUi = useCallback((elements: readonly ExcalidrawElement[], appState: AppState) => {
    const selected = elements.filter((element) => !element.isDeleted && appState.selectedElementIds[element.id]) as NonDeletedExcalidrawElement[];
    const next = deriveUiState(selected, appState, elements);
    const key = JSON.stringify(next);
    if (key !== uiKey.current) { uiKey.current = key; setUi(next); }
  }, []);

  const handleChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
    latestScene.current = { elements, appState, files };
    readUi(elements, appState);
    // Excalidraw 自身のエラー（大きすぎる画像など）。既定の画面を出していないので、こちらで知らせて消す。
    if (appState.errorMessage) {
      const message = appState.errorMessage;
      if (typeof message === "string" && message.trim()) setNotice({ text: message });
      queueMicrotask(() => { if (api && mounted.current) api.updateScene({ appState: { errorMessage: null }, captureUpdate: CaptureUpdateAction.NEVER }); });
    }
    // 最初の内容を読み込んでいる間の通知は保存しない（開いただけで版を進めない）。
    if (!initialized.current) return;
    // 枠の大きさが変わった（見えていなかった枠が見えた・App の WebView が後から広がった・分割の幅を変えた）。
    // 大きさが 0 の間に開いたときの表示位置をここで合わせ、「内容に戻る」を見直す。Excalidraw が大きさを直した後に来るこの通知で行う。
    const size = `${appState.width}x${appState.height}`;
    if (size !== lastSize.current) {
      lastSize.current = size;
      queueMicrotask(() => {
        if (!api || !mounted.current) return;
        const deferred = deferredPlacement.current;
        const { width, height } = api.getAppState();
        if (deferred && width && height) {
          deferredPlacement.current = null;
          placeOnOpen(api, pageId, deferred.fit);
        }
        updateContentHidden();
      });
    }
    if (editable) startUploads(elements, files);
    if (signatureOf(elements, appState) !== lastSignature.current) {
      dirty.current = true;
      if (editable) { ownEdit.current = true; touched.current = true; }
      scheduleSave();
    }
  }, [api, editable, pageId, readUi, scheduleSave, signatureOf, startUploads, updateContentHidden]);

  // 開発中だけ、ブラウザーのコンソールから確かめられるよう editor の API を置く（本番のビルドには入らない）。
  useEffect(() => {
    if (process.env.NODE_ENV === "production" || !api) return;
    (window as unknown as { __notefableWhiteboard?: unknown }).__notefableWhiteboard = api;
  }, [api]);

  // Excalidraw の組み込みの操作をつなぐ（最初の内容の扱いは onInitialize）。
  useEffect(() => {
    if (!api) return;
    setActions(connectWhiteboardActions(api as never, containerRef.current?.querySelector(".excalidraw") as HTMLElement | null));
  }, [api]);

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
  const reveal = useCallback((elementId: string) => Boolean(api && mounted.current && initialized.current && revealIn(api, elementId)), [api]);
  useEffect(() => {
    if (!api) return;
    // 開いた直後の依頼は、最初の内容を読み終えた時（onInitialize）に受け取る。ここは開いている間に来たもの。
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<WhiteboardRevealDetail>).detail;
      if (detail?.pageId === pageId && initialized.current) consumeWhiteboardReveal(pageId, Date.now(), (elementId) => reveal(elementId));
    };
    window.addEventListener(WHITEBOARD_REVEAL_EVENT, onReveal);
    return () => window.removeEventListener(WHITEBOARD_REVEAL_EVENT, onReveal);
  }, [api, pageId, reveal]);

  const buildSelection = useCallback((): PageSelection | null => {
    if (!api) return null;
    const appState = api.getAppState();
    const elements = api.getSceneElements();
    const selectedIds = new Set(Object.keys(appState.selectedElementIds ?? {}).filter((id) => appState.selectedElementIds[id]));
    const expanded = expandWhiteboardSelection(elements, selectedIds);
    if (!expanded.elements.length) return null;
    // クリック時点で選区の要素・参照ファイル・背景色をスナップショットしておき、送信時にモデルが画像対応なら PNG を作る。
    const allFiles = api.getFiles();
    const files: BinaryFiles = {};
    for (const element of expanded.elements) {
      if (element.type === "image" && typeof element.fileId === "string" && allFiles[element.fileId]) {
        files[element.fileId] = allFiles[element.fileId];
      }
    }
    const snapshot = {
      elements: expanded.elements.map((element) => ({ ...element })) as NonDeletedExcalidrawElement[],
      files,
      viewBackgroundColor: appState.viewBackgroundColor,
    };
    return {
      ids: expanded.ids,
      text: expanded.text,
      captureImage: () => exportWhiteboardSelectionPng(snapshot),
    };
  }, [api]);

  const onAskAiProp = props.onAskAi;
  const askAiSelection = useCallback(() => {
    if (!onAskAiProp) return;
    const picked = buildSelection();
    if (picked) onAskAiProp(picked);
  }, [onAskAiProp, buildSelection]);

  useImperativeHandle(handleRef, () => ({
    reveal,
    selectionContext: () => {
      const picked = buildSelection();
      return picked ? { ids: picked.ids ?? [], text: picked.text } : { ids: [], text: "" };
    },
  }), [reveal, buildSelection]);

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
  // Excalidraw は最初の内容を読み終えた時に道具を選択へ戻すので、読み終えた後（onInitialize）に手のひらにする。
  const touchOnly = useMediaQuery("(pointer: coarse) and (hover: none)");
  const startWithHand = editable && (touchOnly || embedded);
  const startWithHandRef = useRef(startWithHand);
  useEffect(() => { startWithHandRef.current = startWithHand; }, [startWithHand]);
  const fitOnOpen = initial.scrollToContent;
  // 自分でまだ何も変えていない間に、親から来る内容（data）が開いた時のものから変わったら（同じページの前のエディターが閉じる時に
  // 最後の変更を渡した）、その内容に入れ替える。入れ替えは保存しない（もう保存キューにある内容なので）。
  // 入れ替えたときは、これから反映される appState（Excalidraw は appState を後から反映する）で計った signature を返す。
  const applyNewerData = useCallback((target: ExcalidrawImperativeAPI): string | null => {
    if (touched.current || latestData.current === appliedData.current) return null;
    appliedData.current = latestData.current;
    const scene = storedToScene(latestData.current);
    for (const id of Object.keys(scene.files)) knownFiles.current.add(id);
    target.addFiles(Object.values(scene.files) as unknown as BinaryFileData[]);
    target.updateScene({ elements: scene.elements as unknown as ExcalidrawElement[], appState: scene.appState as Partial<AppState> as never, captureUpdate: CaptureUpdateAction.NEVER });
    const signature = signatureOf(target.getSceneElementsIncludingDeleted(), { ...target.getAppState(), ...scene.appState } as AppState);
    lastSignature.current = signature;
    if (initialized.current) {
      setSceneVersion(signature);
      const { width, height } = target.getAppState();
      if (width && height) consumeWhiteboardReveal(pageId, Date.now(), (elementId) => revealIn(target, elementId, false));
    }
    return signature;
  }, [pageId, signatureOf]);
  useEffect(() => {
    if (api && initialized.current && mounted.current) applyNewerData(api);
  }, [api, data, applyNewerData]);

  const onInitialize = useCallback((ready: ExcalidrawImperativeAPI) => {
    const applied = applyNewerData(ready);
    // 読み終えた最初の内容を「保存済み」として覚える（開いただけでは保存しない。読み込みの途中の onChange も保存しない）。
    const all = ready.getSceneElementsIncludingDeleted();
    const signature = applied ?? signatureOf(all, ready.getAppState());
    lastSignature.current = signature;
    dirty.current = false;
    initialized.current = true;
    setSceneVersion(signature);
    readUi(all, ready.getAppState());
    if (startWithHandRef.current) ready.setActiveTool({ type: "hand" });
    // 検索の結果から開いたときは、その要素まで動かす。それ以外で、この端末で初めて開くときは内容がすべて見えるように縮める
    // （100% より大きくはしない）。前回の表示位置があればそれを使う。
    const { width, height } = ready.getAppState();
    // 枠の大きさがまだ 0（見えていない枠・後から広がる App の WebView）のときに合わせると、10% まで縮んで左上に寄る。
    // 大きさが決まってから合わせる（handleChange が Excalidraw の大きさの変化を見て行う）。検索ターゲットもサイズ確定後に確認する。
    if (width && height) placeOnOpen(ready, pageId, fitOnOpen);
    else deferredPlacement.current = { fit: fitOnOpen };
    queueMicrotask(() => { if (mounted.current) setContentHidden(contentHiddenIn(ready)); });
  }, [applyNewerData, fitOnOpen, pageId, readUi, signatureOf]);

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
  // 640〜719px で右下に AI ボタンがあると、まん中の道具のツールバーがボタンに重なる。ツールバーをボタンの手前まで寄せる。
  const tight = !compact && width < 720 && !!props.aiSlot;

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

  // ---- ロックの解除：押したロック中の要素（グループならその全部）を解除して選ぶ ----
  const unlockTarget = useCallback((target: string) => {
    if (!api) return;
    const elements = api.getSceneElementsIncludingDeleted();
    const ids = elements.filter((element) => !element.isDeleted && (element.id === target || element.groupIds.includes(target))).map((element) => element.id);
    if (!ids.length) return;
    const unlocking = new Set(ids);
    api.updateScene({
      elements: elements.map((element) => unlocking.has(element.id) ? newElementWith(element, { locked: false }) : element),
      appState: { activeLockedId: null, selectedElementIds: Object.fromEntries(ids.map((id) => [id, true])) } as unknown as Pick<AppState, "selectedElementIds">,
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    });
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

  // パネルの「リンクを開く」：アプリ内のページはその場で、外部のリンクは新しいタブで。
  const openLink = useCallback((link: string) => {
    const id = pageIdFromLink(link, window.location.origin);
    if (id) { if (!onOpenPage?.(id)) window.open(pageLinkUrl(id), "_blank", "noopener,noreferrer"); return; }
    if (/^(https?:|mailto:)/i.test(link)) window.open(link, "_blank", "noopener,noreferrer");
  }, [onOpenPage]);

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
    const exportEpoch = getNativeExportEpoch();
    setNotice(null);
    setBusy(t("Exporting…"));
    try {
      const file = await exportWhiteboard(api, format, props.title);
      if (exportEpoch !== getNativeExportEpoch()) return;
      const result = await saveExportFile(file.blob, file.fileName, exportEpoch);
      if (result === "cancelled") return;
      if (result === "unsupported") setNotice({ text: msg("Update the app to save exported files.") });
      else if (result === "tooLarge") setNotice({ text: msg("This file is too large to save in the app.") });
      else if (result === "failed") setNotice({ text: msg("Could not export the whiteboard.") });
    } catch (error) {
      if (exportEpoch !== getNativeExportEpoch()) return;
      setNotice({ text: error instanceof Error && error.message ? error.message : msg("Could not export the whiteboard.") });
    } finally { setBusy(null); }
  }, [api, busy, props.title, t]);

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
    // 閉じたら（ページの切り替えなど）やめる：残りのページを描かず、閉じたエディターにも入れない。
    const controller = new AbortController();
    pdfAbort.current = controller;
    try {
      const result = await importPdfPages(file, { signal: controller.signal, onProgress: (done, total) => setBusy(t("Importing page {done} of {total}…", { done: Math.min(done + 1, total), total })) });
      if (controller.signal.aborted || !mounted.current) return;
      insertPdf(result);
      // 途中のページで失敗した（容量の上限・通信など）ときは、そこまでのページだけが入っている。容量の上限は NotesWorkspace の案内も出る。
      if (result.failed !== undefined || result.total > MAX_PDF_IMPORT_PAGES) setNotice({ text: msg("Only the first {max} pages were imported."), vars: { max: result.pages.length } });
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (!(error instanceof StorageLimitError)) setNotice({ text: error instanceof Error && error.message ? error.message : msg("Could not read this PDF.") });
    } finally {
      if (pdfAbort.current === controller) pdfAbort.current = null;
      if (mounted.current) setBusy(null);
    }
  }, [api, busy, insertPdf, t]);

  const toggleMinimap = useCallback(() => {
    setMinimapOpen((open) => {
      try { localStorage.setItem(MINIMAP_KEY, open ? "0" : "1"); } catch { /* 覚えられなくても切り替えはできる。 */ }
      return !open;
    });
  }, []);

  return (
    // ツールバー・パネル・ズームのボタンを押してもフォーカスを画布から移さない。Excalidraw はキー（Delete・Ctrl+Z・矢印など）と貼り付けを
    // 自分の入れ物にフォーカスがある時だけ受けるので、ボタンがフォーカスを取ると、画布を押し直すまで効かなくなる。入力欄は除く。
    <div ref={containerRef} className={`whiteboard${embedded ? " is-embedded" : ""}${editable ? "" : " is-readonly"}${compact ? " is-compact" : narrow ? " is-narrow" : ""}${tight ? " is-tight" : ""}`} data-theme={theme}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement;
        if (!target.closest("button") || target.closest(".excalidraw, dialog, [role='menu'], [role='dialog'], input, textarea, select, [contenteditable='true']")) return;
        // 画布にフォーカスがあるときだけ、そのまま画布に残す（題名の入力欄などにあるときは、いつもどおりボタンへ移す）。
        const canvas = containerRef.current?.querySelector(".excalidraw");
        if (canvas && document.activeElement && canvas.contains(document.activeElement)) event.preventDefault();
      }}>
      <Excalidraw
        onExcalidrawAPI={setApi}
        onInitialize={onInitialize}
        initialData={initial}
        ui={false}
        theme={theme}
        langCode={excalidrawLang(locale)}
        viewModeEnabled={!editable}
        // 外部のページの埋め込みは作らない（URL を貼ってもリンクになる）。公開リンクで外部のページを開かせないため。
        validateEmbeddable={false}
        onChange={handleChange}
        onLinkOpen={onLinkOpen}
        imageOptions={{ maxFileSizeBytes: MAX_NOTE_FILE_BYTES, maxWidthOrHeight: 2560 }}
        autoFocus={!embedded}
      />
      {ui && api && <WhiteboardChrome ui={ui} drawMode={drawMode} editable={editable} embedded={embedded} compact={compact} theme={theme} actions={actions}
        title={props.title} icon={props.icon} onTitleChange={props.onTitleChange} onIconChange={props.onIconChange}
        onSelectTool={selectTool} onLink={openLinkDialog} onOpenLink={openLink} onUnlock={unlockTarget} onInsertPageCard={() => setLinkDialog({ mode: "card" })}
        onExport={(format) => void runExport(format)} onImportPdf={() => pdfInputRef.current?.click()}
        onFitToContent={fitToContent} onCanvasBackground={(color) => api.updateScene({ appState: { viewBackgroundColor: color }, captureUpdate: CaptureUpdateAction.IMMEDIATELY })}
        onPenMode={(penMode) => api.updateScene({ appState: { penMode }, captureUpdate: CaptureUpdateAction.NEVER })}
        onAskAi={onAskAiProp ? askAiSelection : undefined}
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
function deriveUiState(selected: readonly NonDeletedExcalidrawElement[], appState: AppState, elements: readonly ExcalidrawElement[]): WhiteboardUiState {
  const common = <T,>(read: (element: NonDeletedExcalidrawElement) => T | undefined, fallback: T): T | null => {
    if (!selected.length) return fallback;
    const values = new Set(selected.map(read).filter((value) => value !== undefined));
    return values.size === 1 ? [...values][0] as T : values.size === 0 ? fallback : null;
  };
  const roundness = (element: NonDeletedExcalidrawElement) => element.roundness ? "round" : "sharp";
  // 図形・付箋の文字は、図形に付いた別の文字要素が持つ（文字の見た目はそちらから読む）。
  const byId = new Map(elements.map((element) => [element.id, element]));
  const textOf = (element: NonDeletedExcalidrawElement): Record<string, unknown> | undefined => {
    if ("fontFamily" in element) return element as unknown as Record<string, unknown>;
    const bound = element.boundElements?.find((entry) => entry.type === "text");
    const text = bound ? byId.get(bound.id) : undefined;
    return text && !text.isDeleted ? text as unknown as Record<string, unknown> : undefined;
  };
  // 付箋の道具を選んでいる間は、付箋の色が次に置くものの色。
  const sticky = !selected.length && appState.activeTool.type === "stickynote";
  const stickyState = appState as AppState & { currentItemStickynoteStrokeColor?: string; currentItemStickynoteBackgroundColor?: string };
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
    // 1 つだけ選んでいる要素のリンク（選んでいる間は Excalidraw がリンクの印を描かないので、パネルから開く）。
    link: selected.length === 1 ? selected[0].link ?? null : null,
    // 押したロック中の要素（またはグループ）。Excalidraw の解除のポップアップは既定の画面にしか無いので、自前のボタンを出す。
    lockedTarget: appState.activeLockedId ?? null,
    style: {
      strokeColor: common((element) => element.strokeColor, (sticky && stickyState.currentItemStickynoteStrokeColor) || appState.currentItemStrokeColor),
      backgroundColor: common((element) => element.backgroundColor, (sticky && stickyState.currentItemStickynoteBackgroundColor) || appState.currentItemBackgroundColor),
      opacity: common((element) => element.opacity, appState.currentItemOpacity),
      roughness: common((element) => element.roughness, appState.currentItemRoughness),
      strokeStyle: common((element) => element.strokeStyle, appState.currentItemStrokeStyle),
      fillStyle: common((element) => element.fillStyle, appState.currentItemFillStyle),
      roundness: common(roundness, appState.currentItemRoundness),
      strokeWidthKey: selected.length ? null : appState.currentItemStrokeWidthKey,
      strokeWidth: common((element) => element.strokeWidth, null as number | null),
      fontFamily: common((element) => textOf(element)?.fontFamily as number | undefined, appState.currentItemFontFamily),
      fontSize: common((element) => textOf(element)?.fontSize as number | undefined, appState.currentItemFontSize),
      textAlign: common((element) => textOf(element)?.textAlign as string | undefined, appState.currentItemTextAlign),
      arrowType: common((element) => element.type === "arrow" ? ((element as { elbowed?: boolean }).elbowed ? "elbow" : element.roundness ? "round" : "sharp") : undefined, appState.currentItemArrowType),
      startArrowhead: common((element) => "startArrowhead" in element ? element.startArrowhead as string | null : undefined, appState.currentItemStartArrowhead),
      endArrowhead: common((element) => "endArrowhead" in element ? element.endArrowhead as string | null : undefined, appState.currentItemEndArrowhead),
      variability: common((element) => element.type === "freedraw" ? (element as { strokeOptions?: { variability?: string } }).strokeOptions?.variability : undefined, appState.currentItemStrokeVariability),
    },
  };
}

