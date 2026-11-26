"use client";

import "@/components/slides/slides.css";
import {
  ChevronDown, Copy, Download, Eye, EyeOff, FileImage, FileText, Flag, Image as ImageIcon, ImagePlus, LayoutGrid, LayoutTemplate, LoaderCircle, MessageSquareText, Minus, Monitor, MoveRight, Palette, PenTool,
  Play, Plus, Presentation, Redo2, Scissors, Shapes, SquareDashed, StickyNote, Table, Trash2, Type, Undo2, Upload, Clipboard,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { AppIcon } from "@/components/app-icon";
import type { CanvasEditorProps } from "@/components/canvas-editors";
import { GuestLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { useT } from "@/components/i18n-provider";
import { ChatImagesDialog, GenerateImageDialog, ReportImageDialog } from "@/components/slides/slide-dialogs";
import { ELEMENT_LABELS, LayoutPreview, SlideInspector, TextFormatBar } from "@/components/slides/slide-inspector";
import { SlideFilmstrip, SlideGrid, type SelectMode } from "@/components/slides/slide-lists";
import { MenuButton, MenuItem, PointMenu } from "@/components/slides/slide-menus";
import { SlidePlayer, type PlayerControl } from "@/components/slides/slide-player";
import { SlideRenderRoot } from "@/components/slides/slide-render";
import { SlideStage, type StageHandle } from "@/components/slides/slide-stage";
import type { TextCommands } from "@/components/slides/text-editor";
import { useAccount } from "@/lib/account-store";
import type { CanvasData } from "@/lib/canvas-document";
import { getNativeExportEpoch } from "@/lib/export-file";
import { localizeSystemText } from "@/lib/i18n/translate";
import { nativeCanPresent, nativeCanShowUsageLimit, postToNative } from "@/lib/native-bridge";
import { takeCanvasReveal } from "@/lib/search-reveal";
import { useBackToClose } from "@/lib/use-back-to-close";
import { hasWhiteboardFrameProvider, renderWhiteboardFramePicker, subscribeWhiteboardFrameProvider } from "@/lib/slides/whiteboard-embed";
import { applyGeneratedSlideImage, clearPendingSlideImages, pendingSlideImageTasks } from "@/lib/slides/ai-build";
import { createImageElement, createLineElement, createShapeElement, createTableElement, createTextElement, createWhiteboardElement } from "@/lib/slides/factory";
import { expandGroups } from "@/lib/slides/geometry";
import { uploadSlideImage, SLIDE_IMAGE_TYPES, type SlideImage } from "@/lib/slides/images";
import { applyLayout, createSlide, LAYOUTS } from "@/lib/slides/layouts";
import { normalizeDeck, SHAPE_KINDS, slideRows, SLIDE_HEIGHT, SLIDE_WIDTH, type Deck, type ImageElement, type LayoutId, type ShapeKind, type Slide, type SlideElement } from "@/lib/slides/model";
import {
  addElements, cloneElements, clipboardPayload, CLIPBOARD_MIME, deleteElements, deleteSlides, duplicateSlides, groupElements, insertSlides, joinRowAt, moveSlides,
  moveSlidesToRow, parseClipboard, renameRow, reorderElements, setHidden, setTransition, startRowAt, ungroupElements, updateElements, updateSlide,
} from "@/lib/slides/ops";
import { richDocFromText, richDocText } from "@/lib/slides/rich-text";
import { SHAPE_LABELS, shapePath } from "@/lib/slides/shapes";
import { resolveTheme, SLIDE_THEMES } from "@/lib/slides/themes";
import type { ExportFormat } from "@/lib/slides/export-files";
import { useSlideCapture } from "@/components/slides/slide-capture";
import { useMediaQuery } from "@/lib/use-media-query";
import { announceStorageLimit } from "@/lib/storage-limit-client";
import { StorageLimitError } from "@/lib/usage-plans";
import { SLIDES_EVENTS, slidesContextText, slidesSelectionIds, type SlidesSelectionDetail } from "@/lib/slides/ai-context";
import { captureSlideSelectionPng } from "@/lib/slides/selection-capture";
import {
  dismissSlideImageJob, getSlideImageJob, registerSlideImageEditor, resumeSlideImageJob, stopSlideImageJob, subscribeSlideImageJobs,
  type SlideImageJob,
} from "@/lib/slides-image-jobs";

// スライドのエディター（Figma Slides 式）。総覧（行 = 章）と単ページ編集、版式・主題、自由配置、放映、書き出し。
// 保存は NotesWorkspace の保存キューが受け持つ（変わった本体を onChange で渡す）。取り消し・やり直しはこの中で持つ。

type History = { deck: Deck; past: Deck[]; future: Deck[]; merge: string | null; mergedAt: number };
const HISTORY_LIMIT = 100;
// 同じ操作（文字の入力・ノート・矢印キーでの移動など）が続く間は、取り消しを 1 回分にまとめる。
const MERGE_MS = 1500;

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return !!element && (element.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(element.tagName) || Boolean(element.closest("dialog")));
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

// aiSlot: AI の面板（#150）を置く場所。単ページ編集の面の右下（スマホでは縮小図の帯の上）に重ねて出す。
export default function SlidesEditor({ pageId, title, data, version, editable, embedded, onChange, onTitleChange, onAskAi, onSelectionChange, aiSlot, generateImageSignal = 0, onConsumeGenerateImage }: CanvasEditorProps & { aiSlot?: ReactNode }) {
  const t = useT();
  const phone = useMediaQuery("(max-width: 640px)");
  // 作ったばかりで中身の無いスライドは、最初の 1 枚（標題）を入れて始める（作成の続き。開いただけで書き換えるのはこの時だけ）。
  const [initial] = useState(() => {
    const deck = normalizeDeck(data);
    return !deck.slides.length && editable && version === 0 ? { deck: { ...deck, slides: [createSlide("title")] }, seeded: true } : { deck, seeded: false };
  });
  const [history, setHistory] = useState<History>({ deck: initial.deck, past: [], future: [], merge: null, mergedAt: 0 });
  const deck = history.deck;
  const sent = useRef<Deck | null>(initial.seeded ? null : initial.deck);
  useEffect(() => {
    if (sent.current === deck) return;
    sent.current = deck;
    onChange(deck as unknown as CanvasData);
  }, [deck, onChange]);

  // 新しい本体か、最新の本体から新しい本体を作る関数（アップロードの完了など、待ったあとの変更は関数で渡す）。
  // 読み取り専用（ロック中・作成や削除の途中）のあいだは、どこから来た変更も受け付けない（保存もされない）。
  const editableRef = useRef(editable);
  useLayoutEffect(() => { editableRef.current = editable; }, [editable]);
  const commit = useCallback((change: Deck | ((deck: Deck) => Deck), merge?: string) => {
    if (!editableRef.current) return;
    setHistory((current) => {
      const next = typeof change === "function" ? change(current.deck) : change;
      if (next === current.deck) return current;
      const now = Date.now();
      const merging = !!merge && current.merge === merge && now - current.mergedAt < MERGE_MS;
      return { deck: next, past: merging ? current.past : [...current.past, current.deck].slice(-HISTORY_LIMIT), future: [], merge: merge ?? null, mergedAt: now };
    });
  }, []);
  // 文字の編集中は閉じてから戻す（開いている文字の編集は外からの変更を取り込まない）。
  const undo = useCallback(() => { setEditing(null); setHistory((current) => (current.past.length ? { deck: current.past[current.past.length - 1], past: current.past.slice(0, -1), future: [current.deck, ...current.future], merge: null, mergedAt: 0 } : current)); }, []);
  const redo = useCallback(() => { setEditing(null); setHistory((current) => (current.future.length ? { deck: current.future[0], past: [...current.past, current.deck], future: current.future.slice(1), merge: null, mergedAt: 0 } : current)); }, []);

  // 待ったあと（アップロード・生成の完了）に、いま見えている本体を読むため。
  const deckRef = useRef(deck);
  useLayoutEffect(() => { deckRef.current = deck; }, [deck]);

  // AI スライド生成の逐页配図（slides-image-jobs.ts）と同期する：開いている間はエディターの commit 経由で差し込み、409 競合や再マウントを防ぐ。
  const { account } = useAccount();
  const imageJob = useSyncExternalStore(subscribeSlideImageJobs, () => getSlideImageJob(pageId), () => null);
  const pendingImages = useMemo(() => pendingSlideImageTasks(deck), [deck]);
  const [closedImageLimit, setClosedImageLimit] = useState<SlideImageJob | null>(null);
  const lastAnnouncedStorage = useRef<SlideImageJob | null>(null);
  const lastAnnouncedUsage = useRef<SlideImageJob | null>(null);
  useEffect(() => {
    if (!editable) return;
    return registerSlideImageEditor(pageId, {
      getDeck: () => deckRef.current,
      applyImage: (input) => {
        const preview = applyGeneratedSlideImage(deckRef.current, input);
        if (!preview.applied) return false;
        deckRef.current = preview.deck;
        commit((latest) => applyGeneratedSlideImage(latest, input).deck);
        return true;
      },
    });
  }, [pageId, editable, commit]);
  useEffect(() => {
    if (!imageJob?.usageLimit || !embedded || lastAnnouncedUsage.current === imageJob) return;
    lastAnnouncedUsage.current = imageJob;
    if (nativeCanShowUsageLimit()) {
      postToNative({ type: "usageLimit", tier: imageJob.usageLimit.tier, kind: "image", pageId });
    }
  }, [embedded, imageJob, pageId]);
  useEffect(() => {
    if (!imageJob?.storageLimit || lastAnnouncedStorage.current === imageJob) return;
    lastAnnouncedStorage.current = imageJob;
    announceStorageLimit(new StorageLimitError(
      imageJob.storageLimit.message,
      imageJob.storageLimit.tier,
      imageJob.storageLimit.used,
      imageJob.storageLimit.limit,
    ));
  }, [imageJob]);
  const showImageGuestPrompt = !embedded && imageJob !== closedImageLimit && imageJob?.usageLimit?.tier === "guest" && Boolean(account?.configured && !account.user);
  const showImageUpgradePrompt = !embedded && imageJob !== closedImageLimit && imageJob?.usageLimit?.tier === "member" && Boolean(account?.billing && account.user);
  const theme = useMemo(() => resolveTheme(deck.theme), [deck.theme]);
  const [view, setView] = useState<"slide" | "grid">("slide");
  const [currentId, setCurrentId] = useState<string | null>(() => initial.deck.slides[0]?.id ?? null);
  const [selectedSlides, setSelectedSlides] = useState<Set<string>>(() => new Set(initial.deck.slides[0] ? [initial.deck.slides[0].id] : []));
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ id: string; selectAll: boolean } | null>(null);
  const [formatTick, setFormatTick] = useState(0);
  const [presenting, setPresenting] = useState<{ startId: string | null } | null>(null);
  const [dialog, setDialog] = useState<{ kind: "chat" | "generate"; target: string | null } | { kind: "report"; target: string } | null>(null);
  // 初期値を 0 にすることで、動的読み込み中に AI パネルから送られた最初の要求もマウント直後に受け取れる。
  const [dismissedGenerateSignal, setDismissedGenerateSignal] = useState(0);
  const activeDialog = dialog ?? (editable && generateImageSignal > dismissedGenerateSignal ? { kind: "generate" as const, target: null } : null);
  const closeDialog = useCallback(() => {
    setDialog(null);
    setDismissedGenerateSignal(generateImageSignal);
    onConsumeGenerateImage?.();
  }, [generateImageSignal, onConsumeGenerateImage]);
  const [menu, setMenu] = useState<{ x: number; y: number; kind: "element" | "slide"; slideId?: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  // 書き出し中か（runExport だけが立て・下ろす。state の再描画を待たずに選区の撮影を止めるため ref でも持つ）。
  const exportingRef = useRef(false);
  const captureBusyRef = useRef(false);
  const captureJobRef = useRef<Promise<Blob | null> | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const commandsRef = useRef<TextCommands | null>(null);
  const stageRef = useRef<StageHandle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imageTarget = useRef<string | null>(null);
  const clipboard = useRef<string | null>(null);
  const copiedText = useRef<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const playerControl = useRef<PlayerControl | null>(null);
  const capture = useSlideCapture(theme);

  // 今の枚が消えた（取り消し・別の操作）ら、近くの枚へ。
  const currentIndex = Math.max(0, deck.slides.findIndex((slide) => slide.id === currentId));
  const current: Slide | null = deck.slides[currentIndex] ?? null;
  // 選んでいる要素のうち、今の枚に無いものは外す。
  const liveSelection = useMemo(() => new Set([...selection].filter((id) => current?.elements.some((element) => element.id === id))), [selection, current]);
  const editingId = editable && editing && current?.elements.some((element) => element.id === editing.id) ? editing.id : null;

  const commitSlide = useCallback((next: Slide, merge?: string) => {
    if (!current) return;
    commit(updateSlide(deck, current.id, () => next), merge);
  }, [commit, current, deck]);

  const openSlide = useCallback((id: string) => {
    setCurrentId(id);
    setSelectedSlides(new Set([id]));
    setSelection(new Set());
    setEditing(null);
  }, []);

  // 検索で一致した枚を開く（search-reveal.ts が知らせる）。
  // エディターは遅れて読み込まれるので、開く前に届いた依頼も（少しの間）受け取る（takeCanvasReveal）。
  useEffect(() => {
    const apply = () => {
      const id = takeCanvasReveal((candidate) => deck.slides.some((slide) => slide.id === candidate));
      if (id) { openSlide(id); setView("slide"); }
    };
    apply();
    window.addEventListener(SLIDES_EVENTS.reveal, apply);
    return () => window.removeEventListener(SLIDES_EVENTS.reveal, apply);
  }, [deck.slides, openSlide]);

  // 選んでいる枚・要素を、AI（#150）が文脈として読めるよう知らせる。
  useEffect(() => {
    const detail: SlidesSelectionDetail = { pageId, slideIds: view === "grid" ? [...selectedSlides] : current ? [current.id] : [], elementIds: [...liveSelection] };
    window.dispatchEvent(new CustomEvent<SlidesSelectionDetail>(SLIDES_EVENTS.selection, { detail }));
  }, [pageId, view, selectedSlides, current, liveSelection]);

  const makeSlideCapture = useCallback((targetSlideId: string | null, elementIds: readonly string[], fallbackSlide: Slide | null, fallbackTheme: ReturnType<typeof resolveTheme>) => {
    if (!targetSlideId) return undefined;
    const fallbackSnapshot = fallbackSlide ? { ...fallbackSlide, elements: fallbackSlide.elements.map((el) => ({ ...el })) } : null;
    const wantedIds = [...elementIds];
    return async () => {
      if (exportingRef.current || captureBusyRef.current) return null;
      captureBusyRef.current = true;
      const job = (async () => {
        const latestDeck = deckRef.current;
        const liveSlide = latestDeck.slides.find((slide) => slide.id === targetSlideId) ?? fallbackSnapshot;
        if (!liveSlide) return null;
        const liveTheme = resolveTheme(latestDeck.theme) ?? fallbackTheme;
        const targetElementIds = wantedIds.filter((id) => liveSlide.elements.some((el) => el.id === id));
        if (wantedIds.length > 0 && !targetElementIds.length) return null;
        return await captureSlideSelectionPng(capture, { ...liveSlide, elements: liveSlide.elements.map((el) => ({ ...el })) }, liveTheme, targetElementIds);
      })();
      // 書き出しはこの撮影が終わるのを待ってから始める（runExport）。
      captureJobRef.current = job;
      try {
        return await job;
      } finally {
        captureBusyRef.current = false;
        if (captureJobRef.current === job) captureJobRef.current = null;
      }
    };
  }, [capture]);

  // 要素を選んだ状態・総覧で複数枚を選んだ状態をリアルタイムに AI パネルへ同期する（パネルが開いている時や、右下の AI ボタンを押した時にも自動で添付する）。
  useEffect(() => {
    if (!onSelectionChange) return;
    return () => { onSelectionChange(null); };
  }, [onSelectionChange]);
  useEffect(() => {
    if (!onSelectionChange) return;
    const isElementSelection = view === "slide" && current && liveSelection.size > 0;
    const isMultiSlideSelection = view === "grid" && selectedSlides.size > 1;
    if (!isElementSelection && !isMultiSlideSelection) {
      onSelectionChange(null);
      return;
    }
    const slideIds = isElementSelection
      ? [current.id]
      : deck.slides.filter((slide) => selectedSlides.has(slide.id)).map((slide) => slide.id);
    if (!slideIds.length) { onSelectionChange(null); return; }
    const elementIds = isElementSelection ? [...liveSelection] : [];
    const sel = { slideIds, elementIds };
    const text = slidesContextText(deck, sel, { t });
    const ids = slidesSelectionIds(deck, sel);
    const targetSlideId = (current && slideIds.includes(current.id) ? current.id : slideIds[0]) ?? null;
    const fallbackSlide = targetSlideId ? deck.slides.find((slide) => slide.id === targetSlideId) ?? null : null;
    const captureImage = makeSlideCapture(targetSlideId, elementIds, fallbackSlide, theme);
    onSelectionChange({ text, ids, captureImage });
  }, [onSelectionChange, view, deck, selectedSlides, current, liveSelection, theme, makeSlideCapture, t]);

  // 選んだスライドや要素について AI に聞く（ロック中のスライドからも利用可能）。
  const askAi = useCallback((override?: { slideIds?: string[]; elementIds?: string[] }) => {
    if (!onAskAi) return;
    const rawSlideIds = override?.slideIds
      ?? (view === "grid"
        ? deck.slides.filter((slide) => selectedSlides.has(slide.id)).map((slide) => slide.id)
        : current ? [current.id] : []);
    const slideIds = rawSlideIds.length ? rawSlideIds : current ? [current.id] : [];
    if (!slideIds.length) return;
    const elementIds = override?.elementIds !== undefined
      ? override.elementIds
      : view === "slide" ? [...liveSelection] : [];
    const sel = { slideIds, elementIds };
    const text = slidesContextText(deck, sel, { t });
    const ids = slidesSelectionIds(deck, sel);
    // 複数枚選択時はアクティブな枚（なければ先頭）を対象にし、送信時点の最新スライド（保存後）を描画する。
    const targetSlideId = (current && slideIds.includes(current.id) ? current.id : slideIds[0]) ?? null;
    const fallbackSlide = targetSlideId ? deck.slides.find((slide) => slide.id === targetSlideId) ?? null : null;
    const captureImage = makeSlideCapture(targetSlideId, elementIds, fallbackSlide, theme);
    // スマホでは設定シートが開いたままだと AI 引き出しと重なるため閉じる。
    if (phone) { setInspectorOpen(false); setSelection(new Set()); }
    onAskAi({ text, ids, captureImage });
  }, [onAskAi, view, deck, selectedSlides, current, liveSelection, theme, makeSlideCapture, phone, t]);

  // ---- 枚の操作 ----
  const addSlide = useCallback((layout: LayoutId = "bullets", index?: number) => {
    const slide = createSlide(layout);
    const at = index ?? (current ? currentIndex + 1 : deck.slides.length);
    commit(insertSlides(deck, at, [slide]));
    openSlide(slide.id);
  }, [commit, current, currentIndex, deck, openSlide]);
  const slideTargets = () => (selectedSlides.size ? selectedSlides : current ? new Set([current.id]) : new Set<string>());
  const duplicateSelectedSlides = () => {
    const { deck: next, created } = duplicateSlides(deck, slideTargets());
    commit(next);
    if (created[0]) openSlide(created[0]);
  };
  const deleteSelectedSlides = () => {
    const targets = slideTargets();
    if (!targets.size) return;
    const remaining = deck.slides.filter((slide) => !targets.has(slide.id));
    const nextCurrent = remaining[Math.min(currentIndex, remaining.length - 1)];
    commit(deleteSlides(deck, targets));
    if (nextCurrent) openSlide(nextCurrent.id); else setCurrentId(null);
  };
  const toggleHidden = () => {
    const targets = slideTargets();
    const hide = deck.slides.some((slide) => targets.has(slide.id) && !slide.hidden);
    commit(setHidden(deck, targets, hide));
  };
  const selectSlide = (id: string, mode: SelectMode) => {
    if (mode === "single") { openSlide(id); return; }
    setSelectedSlides((currentSet) => {
      if (mode === "toggle") {
        const next = new Set(currentSet);
        if (next.has(id) && next.size > 1) next.delete(id); else next.add(id);
        return next;
      }
      const from = currentIndex;
      const to = deck.slides.findIndex((slide) => slide.id === id);
      return new Set(deck.slides.slice(Math.min(from, to), Math.max(from, to) + 1).map((slide) => slide.id));
    });
    if (mode === "toggle") setCurrentId(id);
  };

  // ---- 要素の操作 ----
  const insertElements = useCallback((elements: SlideElement[], edit = false) => {
    if (!current || !elements.length) return;
    commitSlide(addElements(current, elements));
    setSelection(expandGroups([...current.elements, ...elements], elements.map((element) => element.id)));
    if (edit && elements.length === 1) setEditing({ id: elements[0].id, selectAll: false });
    else setEditing(null);
    if (view !== "slide") setView("slide");
  }, [commitSlide, current, view]);
  const deleteSelection = () => {
    if (!current || !liveSelection.size) return;
    commitSlide(deleteElements(current, liveSelection));
    setSelection(new Set());
    setEditing(null);
  };
  const duplicateSelection = () => {
    if (!current || !liveSelection.size) return;
    const copies = cloneElements(current.elements.filter((element) => liveSelection.has(element.id)), 24);
    commitSlide(addElements(current, copies));
    setSelection(new Set(copies.map((element) => element.id)));
  };

  // 画像を置く：置き場所（空の画像・差し替え）があればそこへ、無ければ新しい画像として。
  // 画像は待ったあと（アップロード・生成の完了）に置くので、その時点の最新の本体に対して変更する（途中の編集や、続けて置いた画像を消さない）。
  // slideId は置く枚（既定は今の枚）。
  const placeImage = useCallback((image: SlideImage, target: string | null, at?: { x: number; y: number }, slideId: string | null = current?.id ?? null) => {
    const alt = image.name.replace(/\.[a-z0-9]+$/i, "");
    const generated = image.prompt ? { generated: { prompt: image.prompt.slice(0, 4000) } } : {};
    const fresh: ImageElement = { ...createImageElement(image.url, image.width, image.height, alt, at), ...generated };
    if (!slideId) {
      const createdSlide = addElements(createSlide("blank"), [fresh]);
      commit((latest) => ({ ...latest, slides: [...latest.slides, createdSlide] }));
      setCurrentId(createdSlide.id);
      setSelectedSlides(new Set([createdSlide.id]));
      setSelection(new Set([fresh.id]));
      setView("slide");
      return;
    }
    // 差し替える画像（target）か、空の画像の置き場所。無ければ新しい画像として足す。
    const into = (slide: Slide) => {
      const existing = target ? slide.elements.find((element) => element.id === target && element.type === "image") : undefined;
      return existing ?? (!target && !at ? slide.elements.find((element) => element.type === "image" && element.role && !element.src) : undefined);
    };
    commit((latest) => updateSlide(latest, slideId, (slide) => {
      const existing = into(slide);
      if (existing?.type !== "image") return addElements(slide, [fresh]);
      const { generated: _old, pendingImagePrompt: _pending, ...rest } = existing;
      void _old;
      void _pending;
      return updateElements(slide, new Set([existing.id]), () => ({ ...rest, src: image.url, alt, ...generated }));
    }));
    const shown = deckRef.current.slides.find((slide) => slide.id === slideId);
    const placed = shown ? into(shown) : undefined;
    setSelection(new Set([placed?.type === "image" ? placed.id : fresh.id]));
    setEditing(null);
    setView("slide");
  }, [commit, current]);

  const uploadFiles = useCallback(async (files: File[], target: string | null, at?: { x: number; y: number }) => {
    const images = files.filter((file) => SLIDE_IMAGE_TYPES.includes(file.type)).slice(0, 10);
    if (!images.length) { setNotice(t("Choose a PNG, JPEG, WebP or GIF image.")); return; }
    setNotice("");
    const slideId = current?.id ?? null;
    for (const [index, file] of images.entries()) {
      try {
        const image = await uploadSlideImage(file);
        placeImage(image, index === 0 ? target : null, at ? { x: at.x + index * 24, y: at.y + index * 24 } : undefined, slideId);
      } catch (caught) {
        if (!(caught instanceof StorageLimitError)) setNotice(caught instanceof Error ? caught.message : t("Upload failed. Try again."));
        return;
      }
    }
  }, [current, placeImage, t]);

  const requestImage = (target: string | null) => {
    imageTarget.current = target;
    fileInput.current?.click();
  };

  // ---- クリップボード ----
  // 写すもの（選んだ要素、または縮小図の一覧で選んだ枚）を作る。cut なら消す。写すものが無ければ null。
  const takeClipboard = (cut: boolean, slidesAllowed: boolean): { payload: string; text: string } | null => {
    if (!current || (cut && !editable)) return null;
    let payload: string | null = null;
    let text = "";
    if (liveSelection.size) {
        const elements = current.elements.filter((element) => liveSelection.has(element.id));
        payload = clipboardPayload({ elements });
        text = elements.map((element) => (element.type === "text" || element.type === "shape" ? richDocText(element.doc) : element.type === "table" ? element.rows.map((row) => row.cells.map((cell) => cell.text).join("\t")).join("\n") : "")).filter(Boolean).join("\n\n");
        if (cut) deleteSelection();
      } else if (selectedSlides.size && slidesAllowed) {
        // 枚をまるごと写すのは、縮小図の一覧（帯・総覧）を操作しているときだけ（スライドの面で何も選ばずに切り取っても枚は消さない）。
        const slides = deck.slides.filter((slide) => selectedSlides.has(slide.id));
        payload = clipboardPayload({ slides });
        text = slides.map((slide) => slide.elements.map((element) => (element.type === "text" ? richDocText(element.doc) : "")).filter(Boolean).join("\n")).join("\n\n");
        if (cut) deleteSelectedSlides();
      }
    if (!payload) return null;
    clipboard.current = payload;
    copiedText.current = text || " ";
    return { payload, text: text || " " };
  };
  // 右クリックのメニューから：execCommand("cut") はボタンの上では効かないので、ここで写して文字だけシステムのクリップボードへ。
  const copyFromMenu = (cut: boolean) => {
    const taken = takeClipboard(cut, menu?.kind === "slide");
    if (taken) void navigator.clipboard?.writeText(taken.text).catch(() => {});
  };
  useEffect(() => {
    const inside = () => !!root.current && root.current.contains(document.activeElement) && !isTypingTarget(document.activeElement) && !presenting;
    const onCopy = (event: ClipboardEvent, cut: boolean) => {
      if (!inside()) return;
      const taken = takeClipboard(cut, !!document.activeElement?.closest(".slides-filmstrip, .slides-grid"));
      if (!taken) return;
      event.preventDefault();
      event.clipboardData?.setData(CLIPBOARD_MIME, taken.payload);
      event.clipboardData?.setData("text/plain", taken.text);
    };
    const onPaste = (event: ClipboardEvent) => {
      if (!inside() || !editable) return;
      const data = event.clipboardData;
      const files = Array.from(data?.files ?? []).filter((file) => SLIDE_IMAGE_TYPES.includes(file.type));
      // メニューから写したときは、システムのクリップボードに文字しか無い。その文字のままなら、写した要素・枚を貼る。
      const plain = data?.getData("text/plain") ?? "";
      const custom = data?.getData(CLIPBOARD_MIME) || (clipboard.current && copiedText.current === plain ? clipboard.current : null);
      const parsed = custom ? parseClipboard(custom) : null;
      if (parsed) {
        event.preventDefault();
        if (parsed.elements.length && current) insertElements(parsed.elements);
        else if (parsed.slides.length) {
          commit(insertSlides(deck, current ? currentIndex + 1 : deck.slides.length, parsed.slides));
          openSlide(parsed.slides[0].id);
        }
        return;
      }
      if (files.length) { event.preventDefault(); void uploadFiles(files, null); return; }
      const text = data?.getData("text/plain")?.trim();
      if (text && current) { event.preventDefault(); insertElements([{ ...createTextElement(""), doc: richDocFromText(text.slice(0, 20_000)) }]); }
    };
    const copy = (event: ClipboardEvent) => onCopy(event, false);
    const cut = (event: ClipboardEvent) => onCopy(event, true);
    document.addEventListener("copy", copy);
    document.addEventListener("cut", cut);
    document.addEventListener("paste", onPaste);
    return () => { document.removeEventListener("copy", copy); document.removeEventListener("cut", cut); document.removeEventListener("paste", onPaste); };
  });

  // ---- 書き出し・放映 ----
  const runExport = async (format: ExportFormat) => {
    if (exporting || exportingRef.current) return;
    // PDF・PNG は隠した枚を入れない。見せる枚が無ければ空のファイルを作らない。
    if (!deck.slides.length || (format !== "pptx" && !deck.slides.some((slide) => !slide.hidden))) { setNotice(t("This deck has no slides to show.")); return; }
    // 書き出しを始めた時点のページの番号。読み込みを待つ間にアプリが別のページへ切り替えたら、前のページのファイルを渡さない。
    const exportEpoch = getNativeExportEpoch();
    // 新しい選区の撮影を始めさせない（次の描画を待たずにすぐ立て、finally で下ろす）。
    exportingRef.current = true;
    setExporting(format);
    setNotice("");
    try {
      // AI パネルへ送る選区の画像を撮っている途中なら、終わるのを待ってから書き出す（黙って何もしないことがないように）。
      const pendingCapture = captureJobRef.current;
      if (pendingCapture) await pendingCapture.catch(() => null);
      const { exportDeckFiles } = await import("@/lib/slides/export-files");
      const result = await exportDeckFiles(deck, title, format, capture, exportEpoch);
      if (result === "cancelled" || exportEpoch !== getNativeExportEpoch()) return;
      // アプリの中では、ファイルを受け取れない古いアプリだと保存できない（WebView はダウンロードを扱えない）。
      if (result === "unsupported") setNotice(t("Update the app to save exported files."));
      else if (result === "tooLarge") setNotice(t("This file is too large to save in the app."));
      else if (result === "failed") setNotice(t("Could not save the file."));
    }
    catch (caught) {
      if (exportEpoch !== getNativeExportEpoch()) return;
      setNotice(caught instanceof Error && caught.message ? caught.message : t("Could not export the slides."));
    }
    finally { exportingRef.current = false; setExporting(null); }
  };
  const present = (from: "start" | "current") => {
    setEditing(null);
    const startId = from === "start" ? deck.slides.find((slide) => !slide.hidden)?.id ?? null : current?.id ?? null;
    setPresenting({ startId });
  };
  useEffect(() => {
    if (!embedded || !presenting) return;
    if (nativeCanPresent()) postToNative({ type: "presentation", state: "start", index: Math.max(0, deck.slides.findIndex((slide) => slide.id === presenting.startId)), count: deck.slides.length });
    return () => { if (nativeCanPresent()) postToNative({ type: "presentation", state: "end", index: 0, count: deck.slides.length }); };
    // 始めと終わりだけ知らせる（枚ごとの番号は onChange で）。
  }, [embedded, presenting]); // eslint-disable-line react-hooks/exhaustive-deps
  // アプリ（…メニュー・戻るボタン）から放映と書き出しを操作する（native-bridge.ts の slides）。
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ action: string; format?: ExportFormat; index?: number }>).detail;
      if (!detail) return;
      if (detail.action === "present") present(typeof detail.index === "number" ? "current" : "start");
      else if (detail.action === "end") playerControl.current?.end();
      else if (detail.action === "next") playerControl.current?.next();
      else if (detail.action === "previous") playerControl.current?.previous();
      else if (detail.action === "goto" && typeof detail.index === "number") playerControl.current?.goTo(detail.index + 1);
      else if (detail.action === "export" && detail.format) void runExport(detail.format);
    };
    window.addEventListener(SLIDES_EVENTS.command, onCommand);
    return () => window.removeEventListener(SLIDES_EVENTS.command, onCommand);
  });

  // ---- キーボード ----
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (presenting) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (event.key === "F5") { event.preventDefault(); present(event.shiftKey ? "current" : "start"); return; }
    if (isTypingTarget(event.target)) return;
    // 文字を編集している間（書式バーのボタンにフォーカスがあるときも）は、要素の操作（削除・移動など）をしない。
    if (editingId) return;
    if (editable && mod && key === "z") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
    if (editable && mod && key === "y") { event.preventDefault(); redo(); return; }
    if (!editable) {
      if (!mod && (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown") && deck.slides[currentIndex + 1]) openSlide(deck.slides[currentIndex + 1].id);
      if (!mod && (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") && deck.slides[currentIndex - 1]) openSlide(deck.slides[currentIndex - 1].id);
      return;
    }
    if (mod && key === "m") { event.preventDefault(); addSlide(); return; }
    if (liveSelection.size && current) {
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); deleteSelection(); return; }
      if (event.key === "Escape") { setSelection(new Set()); return; }
      if (mod && key === "d") { event.preventDefault(); duplicateSelection(); return; }
      if (mod && key === "g") { event.preventDefault(); commitSlide(event.shiftKey ? ungroupElements(current, liveSelection) : groupElements(current, liveSelection).slide); return; }
      // Shift を押すと key は「}」「{」になるので、キーの位置（code）で見る。
      if (mod && (event.code === "BracketRight" || event.code === "BracketLeft")) {
        event.preventDefault();
        commitSlide(reorderElements(current, liveSelection, event.code === "BracketRight" ? (event.shiftKey ? "front" : "forward") : (event.shiftKey ? "back" : "backward")));
        return;
      }
      if (event.key === "Enter") {
        const only = [...liveSelection][0];
        const element = current.elements.find((entry) => entry.id === only);
        if (liveSelection.size === 1 && element && (element.type === "text" || element.type === "shape" || element.type === "table")) { event.preventDefault(); setEditing({ id: element.id, selectAll: true }); }
        return;
      }
      if (event.key.startsWith("Arrow")) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        commitSlide(updateElements(current, liveSelection, (element) => ({ ...element, x: element.x + dx, y: element.y + dy })), "nudge");
        return;
      }
    }
    if (mod && key === "a" && current && view === "slide") { event.preventDefault(); setSelection(new Set(current.elements.map((element) => element.id))); return; }
    if (!liveSelection.size) {
      if ((event.key === "Delete" || event.key === "Backspace") && (event.target as HTMLElement).closest(".slides-filmstrip, .slides-grid")) { event.preventDefault(); deleteSelectedSlides(); return; }
      if (mod && key === "d") { event.preventDefault(); duplicateSelectedSlides(); return; }
      if (event.key === "PageDown" || ((event.key === "ArrowDown" || event.key === "ArrowRight") && view === "slide")) { if (deck.slides[currentIndex + 1]) { event.preventDefault(); openSlide(deck.slides[currentIndex + 1].id); } return; }
      if (event.key === "PageUp" || ((event.key === "ArrowUp" || event.key === "ArrowLeft") && view === "slide")) { if (deck.slides[currentIndex - 1]) { event.preventDefault(); openSlide(deck.slides[currentIndex - 1].id); } return; }
      if (!mod && view === "slide" && current) {
        if (key === "t") { event.preventDefault(); insertElements([createTextElement()], true); return; }
        if (key === "r") { event.preventDefault(); insertElements([createShapeElement("rect")]); return; }
        if (key === "o") { event.preventDefault(); insertElements([createShapeElement("ellipse")]); return; }
        if (key === "l") { event.preventDefault(); insertElements([createLineElement()]); return; }
      }
    }
  }

  // 枚の右クリックのメニュー：章の操作は押した枚に、上下の移動は選んだ枚まとめて（一番上・一番下の位置から）。
  const menuSlide = menu?.kind === "slide" ? deck.slides.find((slide) => slide.id === menu.slideId) ?? current : null;
  const menuIndex = menuSlide ? deck.slides.indexOf(menuSlide) : -1;
  const targetIndexes = menu?.kind === "slide" ? deck.slides.flatMap((slide, index) => (slideTargets().has(slide.id) ? [index] : [])) : [];
  const targetRange = { first: targetIndexes.length ? Math.min(...targetIndexes) : 0, last: targetIndexes.length ? Math.max(...targetIndexes) : deck.slides.length - 1 };
  const selectedElement = liveSelection.size === 1 && current ? current.elements.find((element) => liveSelection.has(element.id)) ?? null : null;
  const layoutMenu = (close: () => void) => <div className="slides-layout-grid is-menu">
    {LAYOUTS.map((layout) => <button key={layout.id} type="button" role="menuitem" className={`slides-layout-option${current?.layout === layout.id ? " is-active" : ""}`}
      onClick={() => { close(); if (!current) addSlide(layout.id); else setLayout(layout.id); }}>
      <LayoutPreview layout={layout.id} /><span>{t(layout.name)}</span>
    </button>)}
  </div>;
  function setLayout(layout: LayoutId) {
    const targets = view === "grid" ? slideTargets() : current ? new Set([current.id]) : new Set<string>();
    commit({ ...deck, slides: deck.slides.map((slide) => (targets.has(slide.id) ? applyLayout(slide, layout) : slide)) });
    setSelection(new Set());
    setEditing(null);
  }

  const toolbar = <div className="slides-toolbar" role="toolbar" aria-label={t("Slide tools")}>
    {!embedded || !phone ? <input className="slides-title" value={title === "Untitled" ? "" : title} placeholder={t("Untitled")} disabled={!editable} maxLength={200} aria-label={t("Title")}
      onChange={(event) => onTitleChange(event.target.value || "Untitled")} /> : null}
    <div className="slides-toolbar-group" role="group" aria-label={t("View")}>
      <button type="button" className={`slides-tool${view === "slide" ? " is-active" : ""}`} aria-pressed={view === "slide"} onClick={() => setView("slide")} aria-label={t("Slide view")} title={t("Slide view")}><Presentation size={18} /></button>
      <button type="button" className={`slides-tool${view === "grid" ? " is-active" : ""}`} aria-pressed={view === "grid"} onClick={() => { setEditing(null); setView("grid"); }} aria-label={t("Grid view")} title={t("Grid view")}><LayoutGrid size={18} /></button>
    </div>
    {editable && <div className="slides-toolbar-group" role="group" aria-label={t("Insert")}>
      <MenuButton label={t("New slide")} icon={<Plus size={18} />} text={!phone && <ChevronDown size={14} aria-hidden="true" />}>
        {(close) => <div className="slides-layout-grid is-menu">
          {LAYOUTS.map((layout) => <button key={layout.id} type="button" role="menuitem" className="slides-layout-option" onClick={() => { close(); addSlide(layout.id); }}>
            <LayoutPreview layout={layout.id} /><span>{t(layout.name)}</span>
          </button>)}
        </div>}
      </MenuButton>
      <button type="button" className="slides-tool" onClick={() => insertElements([createTextElement()], true)} disabled={!current} aria-label={t("Text box")} title={`${t("Text box")} (T)`}><Type size={18} /></button>
      <MenuButton label={t("Image")} icon={<ImageIcon size={18} />} disabled={!current}>
        {(close) => <>
          <MenuItem icon={<Upload size={16} />} label={t("Upload image")} onClick={() => { close(); requestImage(null); }} />
          <MenuItem icon={<MessageSquareText size={16} />} label={t("From chats")} onClick={() => { close(); setDialog({ kind: "chat", target: null }); }} />
          <MenuItem icon={<ImagePlus size={16} />} label={t("Generate with AI")} onClick={() => { close(); setDialog({ kind: "generate", target: null }); }} />
        </>}
      </MenuButton>
      <MenuButton label={t("Shape")} icon={<Shapes size={18} />} disabled={!current} menuClassName="slides-shape-menu">
        {(close) => <div className="slides-shape-grid">
          {SHAPE_KINDS.map((shape) => <button key={shape} type="button" role="menuitem" className="slides-shape-option" aria-label={t(SHAPE_LABELS[shape])} title={t(SHAPE_LABELS[shape])}
            onClick={() => { close(); insertElements([createShapeElement(shape as ShapeKind)]); }}>
            <svg viewBox="-2 -2 40 40" aria-hidden="true"><path d={shapePath(shape, 36, shape === "callout" ? 30 : 36)} /></svg>
          </button>)}
          <button type="button" role="menuitem" className="slides-shape-option" aria-label={t("Line")} title={`${t("Line")} (L)`} onClick={() => { close(); insertElements([createLineElement()]); }}><Minus size={22} /></button>
          <button type="button" role="menuitem" className="slides-shape-option" aria-label={t("Arrow")} title={t("Arrow")} onClick={() => { close(); insertElements([createLineElement(true)]); }}><MoveRight size={22} className="rtl-mirror" /></button>
        </div>}
      </MenuButton>
      <MenuButton label={t("Table")} icon={<Table size={18} />} disabled={!current}>
        {(close) => <TableSizePicker onPick={(rows, cols) => { close(); insertElements([createTableElement(rows, cols)]); }} />}
      </MenuButton>
      <WhiteboardFrameButton disabled={!current} onInsert={(element) => insertElements([element])} />
    </div>}
    {editable && <div className="slides-toolbar-group" role="group" aria-label={t("Design")}>
      <MenuButton label={t("Layout")} icon={<LayoutTemplate size={18} />} disabled={!current && view !== "grid"}>{layoutMenu}</MenuButton>
      <MenuButton label={t("Theme")} icon={<Palette size={18} />} menuClassName="slides-theme-menu">
        {(close) => <div className="slides-theme-list">
          <div className="slides-theme-modes" role="group" aria-label={t("Appearance")}>
            <button type="button" role="menuitemradio" aria-checked={deck.theme.mode === "light"} onClick={() => commit({ ...deck, theme: { ...deck.theme, mode: "light" } })}>{t("Light")}</button>
            <button type="button" role="menuitemradio" aria-checked={deck.theme.mode === "dark"} onClick={() => commit({ ...deck, theme: { ...deck.theme, mode: "dark" } })}>{t("Dark")}</button>
          </div>
          {SLIDE_THEMES.map((option) => {
            const palette = deck.theme.mode === "dark" ? option.dark : option.light;
            return <button key={option.id} type="button" role="menuitemradio" aria-checked={deck.theme.id === option.id} className="slides-theme-option"
              onClick={() => { commit({ ...deck, theme: { ...deck.theme, id: option.id } }); close(); }}>
              <span className="slides-theme-swatch" style={{ background: palette.background, color: palette.heading, borderColor: palette.line }}>
                <b style={{ fontFamily: resolveTheme({ id: option.id, mode: deck.theme.mode }).fonts.heading.css }}>Aa</b>
                <i style={{ background: palette.accent }} /><i style={{ background: palette.accent2 }} /><i style={{ background: palette.accent3 }} />
              </span>
              <span>{t(option.name)}</span>
            </button>;
          })}
        </div>}
      </MenuButton>
    </div>}
    {editable && <div className="slides-toolbar-group" role="group" aria-label={t("History")}>
      <button type="button" className="slides-tool" onClick={undo} disabled={!history.past.length} aria-label={t("Undo")} title={`${t("Undo")} (${MOD}Z)`}><Undo2 size={18} className="rtl-mirror" /></button>
      <button type="button" className="slides-tool" onClick={redo} disabled={!history.future.length} aria-label={t("Redo")} title={`${t("Redo")} (${MOD}Shift+Z)`}><Redo2 size={18} className="rtl-mirror" /></button>
    </div>}
    <span className="slides-toolbar-spacer" />
    {onAskAi && deck.slides.length > 0 && (
      <button type="button" className={`slides-tool slides-ask-ai${liveSelection.size > 0 || (view === "grid" && selectedSlides.size > 0) ? " is-highlighted" : ""}`}
        onClick={() => askAi()} aria-label={t("Ask NoteFable")} title={t("Ask NoteFable")}>
        <AppIcon size={16} />
        {!phone && <span>{t("Ask NoteFable")}</span>}
      </button>
    )}
    <MenuButton label={t("Export")} icon={<Download size={18} />} disabled={!deck.slides.length || !!exporting} text={exporting ? <span className="slides-tool-busy" aria-hidden="true" /> : null}>
      {(close) => <>
        <MenuItem icon={<FileText size={16} />} label={t("Export PDF")} onClick={() => { close(); void runExport("pdf"); }} />
        <MenuItem icon={<StickyNote size={16} />} label={t("Export PDF with speaker notes")} onClick={() => { close(); void runExport("pdf-notes"); }} />
        <MenuItem icon={<FileImage size={16} />} label={t("Export PNG images")} onClick={() => { close(); void runExport("png"); }} />
        <MenuItem icon={<Presentation size={16} />} label={t("Export PowerPoint (PPTX)")} onClick={() => { close(); void runExport("pptx"); }} />
        <p className="slides-menu-note">{t("Slide transitions aren’t included in PPTX export.")}</p>
      </>}
    </MenuButton>
    <div className="slides-present">
      <button type="button" className="slides-present-button" disabled={!deck.slides.length} onClick={() => present("current")} title={`${t("Present")} (Shift+F5)`}><Play size={16} aria-hidden="true" />{!phone && t("Present")}</button>
      <MenuButton label={t("More presentation options")} className="slides-present-more" icon={<ChevronDown size={14} />} disabled={!deck.slides.length}>
        {(close) => <>
          <MenuItem icon={<Play size={16} />} label={t("Present from the beginning")} shortcut="F5" onClick={() => { close(); present("start"); }} />
          <MenuItem icon={<Monitor size={16} />} label={t("Present from this slide")} shortcut="Shift+F5" onClick={() => { close(); present("current"); }} />
        </>}
      </MenuButton>
    </div>
  </div>;

  // スマホの設定の下敷き（選んだ要素・枚の設定）は、ブラウザの「戻る」で閉じる。
  const sheetOpen = phone && view === "slide" && (liveSelection.size > 0 || inspectorOpen);
  useBackToClose(sheetOpen, () => { setInspectorOpen(false); setSelection(new Set()); });
  const textCommands = editingId ? commandsRef.current : null;
  const inspector = current && view === "slide" ? <SlideInspector slide={current} slideCount={deck.slides.length} selection={liveSelection} theme={theme} editable={editable}
    onChange={(next, merge) => commitSlide(next, merge)} onReplaceImage={(id) => requestImage(id)} onGenerateImage={(id) => setDialog({ kind: "generate", target: id })} onReportImage={(id) => setDialog({ kind: "report", target: id })}
    onDelete={deleteSelection} onLayout={setLayout} onToggleHidden={() => commit(setHidden(deck, new Set([current.id]), !current.hidden))}
    onTransition={(transition) => commit(setTransition(deck, new Set([current.id]), transition))}
    onApplyTransitionAll={(transition) => commit(setTransition(deck, new Set(deck.slides.map((entry) => entry.id)), transition))}
    onAskAi={onAskAi ? () => askAi() : undefined} /> : null;

  return <SlideRenderRoot theme={theme} mode="view">
    <div ref={root} className={`slides-editor${phone ? " is-phone" : ""}${embedded ? " is-embedded" : ""}`} onKeyDown={onKeyDown} data-theme-mode={theme.mode}>
      {toolbar}
      {textCommands && <TextFormatBar commands={textCommands} tick={formatTick} theme={theme} />}
      {notice && <div className="slides-notice" role="alert">{localizeSystemText(notice, t)}<button type="button" className="notion-button" onClick={() => setNotice("")}>{t("Close")}</button></div>}
      {imageJob?.status === "working" ? (
        <div className="slides-image-banner" role="status" aria-live="polite">
          <LoaderCircle size={15} className="shrink-0 animate-spin" aria-hidden="true" />
          <div className="slides-image-banner-text">
            <span>{t("Generating slide images… ({done}/{total})", { done: imageJob.completed, total: imageJob.total })}</span>
            {imageJob.currentSlideTitle && <span className="slides-image-banner-sub">{t("Current slide: {title}", { title: imageJob.currentSlideTitle })}</span>}
          </div>
          <div className="slides-image-banner-actions">
            <button type="button" className="notion-button" onClick={() => stopSlideImageJob(pageId)}>{t("Stop")}</button>
          </div>
        </div>
      ) : editable && pendingImages.length > 0 ? (
        <div className="slides-image-banner" role="status" aria-live="polite">
          <ImageIcon size={15} className="shrink-0" aria-hidden="true" />
          <div className="slides-image-banner-text">
            <span>
              {imageJob && (imageJob.status === "stopped" || imageJob.status === "error") && imageJob.completed > 0
                ? t("Generated {done} of {total} slide images. {remaining} remaining.", {
                    done: imageJob.completed,
                    total: imageJob.completed + pendingImages.length,
                    remaining: pendingImages.length,
                  })
                : t("{count} slide images left to generate (up to {count} image credits).", { count: pendingImages.length })}
            </span>
            {imageJob?.error && <span className="slides-image-banner-error" role="alert">{localizeSystemText(imageJob.error, t)}</span>}
          </div>
          <div className="slides-image-banner-actions">
            <button type="button" className="notion-button notion-button-primary" onClick={() => void resumeSlideImageJob(pageId)}>{t("Resume")}</button>
            <button type="button" className="notion-button" onClick={() => { commit((latest) => clearPendingSlideImages(latest)); dismissSlideImageJob(pageId); }}>{t("Dismiss")}</button>
          </div>
        </div>
      ) : imageJob?.status === "done" && imageJob.total > 0 ? (
        <div className="slides-image-banner" role="status" aria-live="polite">
          <ImageIcon size={15} className="shrink-0" aria-hidden="true" />
          <div className="slides-image-banner-text">
            <span>{t("Generated {total} slide images.", { total: imageJob.completed })}</span>
          </div>
          <div className="slides-image-banner-actions">
            <button type="button" className="notion-button" onClick={() => dismissSlideImageJob(pageId)}>{t("Close")}</button>
          </div>
        </div>
      ) : null}
      {(showImageGuestPrompt || showImageUpgradePrompt) && (
        <div className="slides-image-limit">
          {showImageGuestPrompt && <GuestLimitPrompt kind="image" onClose={() => setClosedImageLimit(imageJob)} />}
          {showImageUpgradePrompt && <UpgradePrompt kind="image" onClose={() => setClosedImageLimit(imageJob)} />}
        </div>
      )}
      {!deck.slides.length ? <div className="slides-empty">
        <Presentation size={40} strokeWidth={1.3} aria-hidden="true" />
        <h2>{t("This slide deck is empty")}</h2>
        {editable ? <>
          <p>{t("Pick a layout for the first slide.")}</p>
          <div className="slides-layout-grid">{LAYOUTS.map((layout) => <button key={layout.id} type="button" className="slides-layout-option" onClick={() => addSlide(layout.id, 0)}>
            <LayoutPreview layout={layout.id} /><span>{t(layout.name)}</span>
          </button>)}</div>
        </> : null}
      </div> : view === "grid" ? <SlideGrid deck={deck} currentId={current?.id ?? null} selected={selectedSlides} editable={editable} thumbWidth={phone ? 150 : 232}
        onOpen={(id) => { openSlide(id); setView("slide"); }} onSelect={selectSlide}
        onMoveToRow={(ids, row, position) => commit(moveSlidesToRow(deck, ids, row, position))}
        onRenameRow={(slideId, name) => commit(renameRow(deck, slideId, name), `row:${slideId}`)}
        onAddSlide={(rowIndex) => { const row = slideRows(deck.slides)[rowIndex]; addSlide("bullets", row ? row.start + row.slides.length : deck.slides.length); }}
        onContextMenu={(x, y, slideId) => setMenu({ x, y, kind: "slide", slideId })} />
      : <div className="slides-body">
        {!phone && <SlideFilmstrip deck={deck} currentId={current?.id ?? null} selected={selectedSlides} editable={editable} horizontal={false} onSelect={selectSlide}
          onMove={(ids, index) => commit(moveSlides(deck, ids, index))} onContextMenu={(x, y, slideId) => setMenu({ x, y, kind: "slide", slideId })} onAdd={() => addSlide()} />}
        <div className="slides-center">
          <div className="slides-stage-area">
          {current && <SlideRenderRoot theme={theme} mode={editable ? "edit" : "view"}>
            <SlideStage slide={current} editable={editable} selection={liveSelection} editingId={editingId} editSelectAll={editing?.selectAll ?? false}
              onSelect={(ids) => { setSelection(ids); if (!ids.has(editingId ?? "")) setEditing(null); }}
              onCommit={(next, merge) => commitSlide(next, merge)}
              onStartEdit={(id, selectAll = false) => { setSelection(new Set([id])); setEditing({ id, selectAll }); }}
              onStopEdit={() => { setEditing(null); stageRef.current?.focus(); }}
              onTextChange={(id, doc, height) => commitSlide(updateElements(current, new Set([id]), (element) => (element.type === "text" || element.type === "shape"
                ? { ...element, doc, ...(height && element.type === "text" && element.autoHeight ? { h: height } : {}) } : element)), `text:${id}`)}
              onTableChange={(next) => commitSlide(updateElements(current, new Set([next.id]), () => next), `table:${next.id}`)}
              onRequestImage={(id) => requestImage(id)}
              onContextMenu={(x, y, id) => { if (id) setMenu({ x, y, kind: "element" }); else setMenu(null); }}
              onDropFiles={(files, point) => void uploadFiles(files, null, point)}
              commandsRef={commandsRef} onTextSelection={() => setFormatTick((value) => value + 1)} stageRef={stageRef} padding={phone ? 12 : 32} />
          </SlideRenderRoot>}
          {aiSlot && <div className="slides-ai-slot">{aiSlot}</div>}
          </div>
          {current && <div className={`slides-notes${notesOpen ? "" : " is-closed"}`}>
            <button type="button" className="slides-notes-toggle" aria-expanded={notesOpen} onClick={() => setNotesOpen((open) => !open)}>
              <StickyNote size={15} aria-hidden="true" />{t("Speaker notes")}<ChevronDown size={14} aria-hidden="true" />
            </button>
            {notesOpen && <textarea className="slides-notes-input" value={current.notes ?? ""} readOnly={!editable} maxLength={20_000} placeholder={t("Add speaker notes")}
              aria-label={t("Speaker notes")} onChange={(event) => commitSlide({ ...current, notes: event.target.value || undefined }, `notes:${current.id}`)} />}
          </div>}
          {phone && <SlideFilmstrip deck={deck} currentId={current?.id ?? null} selected={selectedSlides} editable={editable} horizontal onSelect={selectSlide}
            onMove={(ids, index) => commit(moveSlides(deck, ids, index))} onContextMenu={(x, y, slideId) => setMenu({ x, y, kind: "slide", slideId })} onAdd={() => addSlide()} />}
        </div>
        {!phone && inspector}
        {phone && (liveSelection.size > 0 || inspectorOpen) && <div className="slides-sheet">
          <button type="button" className="slides-sheet-close" onClick={() => { setInspectorOpen(false); setSelection(new Set()); }}>{t("Done")}</button>
          {inspector}
        </div>}
        {phone && !liveSelection.size && !inspectorOpen && current && editable && <button type="button" className="slides-sheet-open" onClick={() => setInspectorOpen(true)}><LayoutTemplate size={16} aria-hidden="true" />{t("Slide settings")}</button>}
      </div>}
      <input ref={fileInput} type="file" accept={SLIDE_IMAGE_TYPES.join(",")} multiple className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; if (files.length) void uploadFiles(files, imageTarget.current); }} />
      {menu?.kind === "element" && current && <PointMenu x={menu.x} y={menu.y} label={selectedElement ? t(ELEMENT_LABELS[selectedElement.type]) : t("Selection")} onClose={() => setMenu(null)}>
        {onAskAi && <MenuItem icon={<AppIcon size={16} />} label={t("Ask NoteFable")} onClick={() => { setMenu(null); askAi(); }} />}
        <MenuItem icon={<Scissors size={16} />} label={t("Cut")} shortcut={`${MOD}X`} disabled={!editable} onClick={() => { copyFromMenu(true); setMenu(null); }} />
        <MenuItem icon={<Copy size={16} />} label={t("Copy")} shortcut={`${MOD}C`} onClick={() => { copyFromMenu(false); setMenu(null); }} />
        <MenuItem icon={<Clipboard size={16} />} label={t("Paste")} shortcut={`${MOD}V`} disabled={!editable || !clipboard.current} onClick={() => { setMenu(null); const parsed = clipboard.current ? parseClipboard(clipboard.current) : null; if (parsed?.elements.length) insertElements(parsed.elements); }} />
        <MenuItem icon={<Copy size={16} />} label={t("Duplicate")} shortcut={`${MOD}D`} disabled={!editable} onClick={() => { setMenu(null); duplicateSelection(); }} />
        <MenuItem icon={<SquareDashed size={16} />} label={t("Bring to front")} disabled={!editable} onClick={() => { setMenu(null); commitSlide(reorderElements(current, liveSelection, "front")); }} />
        <MenuItem icon={<SquareDashed size={16} />} label={t("Send to back")} disabled={!editable} onClick={() => { setMenu(null); commitSlide(reorderElements(current, liveSelection, "back")); }} />
        {selectedElement?.type === "image" && selectedElement.generated && <MenuItem icon={<Flag size={16} />} label={t("Report image")} onClick={() => { setMenu(null); setDialog({ kind: "report", target: selectedElement.id }); }} />}
        <MenuItem icon={<Trash2 size={16} />} label={t("Delete")} danger disabled={!editable} onClick={() => { setMenu(null); deleteSelection(); }} />
      </PointMenu>}
      {menu?.kind === "slide" && <PointMenu x={menu.x} y={menu.y} label={t("Slide")} onClose={() => setMenu(null)}>
        {onAskAi && <MenuItem icon={<AppIcon size={16} />} label={t("Ask NoteFable")} onClick={() => { const targets = [...slideTargets()]; setMenu(null); askAi({ slideIds: targets, elementIds: [] }); }} />}
        <MenuItem icon={<Plus size={16} />} label={t("New slide")} shortcut={`${MOD}M`} disabled={!editable} onClick={() => { setMenu(null); addSlide(); }} />
        <MenuItem icon={<Copy size={16} />} label={t("Duplicate")} disabled={!editable} onClick={() => { setMenu(null); duplicateSelectedSlides(); }} />
        <MenuItem icon={deck.slides.some((slide) => slideTargets().has(slide.id) && !slide.hidden) ? <EyeOff size={16} /> : <Eye size={16} />}
          label={deck.slides.some((slide) => slideTargets().has(slide.id) && !slide.hidden) ? t("Hide slide") : t("Show slide")} disabled={!editable} onClick={() => { setMenu(null); toggleHidden(); }} />
        {menuSlide && menuSlide.section === undefined && menuIndex > 0 && <MenuItem icon={<PenTool size={16} />} label={t("Start a new section here")} disabled={!editable} onClick={() => { setMenu(null); commit(startRowAt(deck, menuSlide.id)); }} />}
        {menuSlide && menuSlide.section !== undefined && menuIndex > 0 && <MenuItem icon={<PenTool size={16} />} label={t("Merge with the previous section")} disabled={!editable} onClick={() => { setMenu(null); commit(joinRowAt(deck, menuSlide.id)); }} />}
        {targetRange.first > 0 && <MenuItem icon={<ChevronDown size={16} className="rotate-180" />} label={t("Move up")} disabled={!editable} onClick={() => { setMenu(null); commit(moveSlides(deck, slideTargets(), targetRange.first - 1)); }} />}
        {targetRange.last < deck.slides.length - 1 && <MenuItem icon={<ChevronDown size={16} />} label={t("Move down")} disabled={!editable} onClick={() => { setMenu(null); commit(moveSlides(deck, slideTargets(), targetRange.last + 2)); }} />}
        <MenuItem icon={<Trash2 size={16} />} label={t("Delete")} danger disabled={!editable} onClick={() => { setMenu(null); deleteSelectedSlides(); }} />
      </PointMenu>}
      {activeDialog?.kind === "chat" && <ChatImagesDialog onClose={closeDialog} onPicked={(image) => placeImage(image, activeDialog.target)} />}
      {activeDialog?.kind === "generate" && <GenerateImageDialog pageId={pageId} embedded={embedded} mode={activeDialog.target ? "replace" : "insert"} onClose={closeDialog} onGenerated={(image) => placeImage(image, activeDialog.target)} />}
      {activeDialog?.kind === "report" && <ReportImageDialog pageId={pageId} elementId={activeDialog.target} onClose={closeDialog} />}
      {presenting && <SlidePlayer deck={deck} startId={presenting.startId} onExit={() => setPresenting(null)} allowPresenter={!embedded && !phone} fullscreen={!embedded}
        controlRef={playerControl}
        onChange={(_slide, index, count) => { if (embedded && nativeCanPresent()) postToNative({ type: "presentation", state: "slide", index, count }); }} />}
      {capture.node}
    </div>
  </SlideRenderRoot>;
}

// 表の大きさ（行 × 列）をマス目で選ぶ。
function TableSizePicker({ onPick }: { onPick: (rows: number, cols: number) => void }) {
  const t = useT();
  const [hover, setHover] = useState({ rows: 3, cols: 3 });
  return <div className="slides-table-picker">
    <div className="slides-table-picker-grid" onPointerLeave={() => setHover({ rows: 3, cols: 3 })}>
      {Array.from({ length: 8 }, (_, row) => Array.from({ length: 8 }, (_, col) => <button key={`${row}-${col}`} type="button" role="menuitem"
        className={row < hover.rows && col < hover.cols ? "is-on" : ""} aria-label={t("{rows} × {columns} table", { rows: row + 1, columns: col + 1 })}
        onPointerEnter={() => setHover({ rows: row + 1, cols: col + 1 })} onFocus={() => setHover({ rows: row + 1, cols: col + 1 })} onClick={() => onPick(row + 1, col + 1)} />))}
    </div>
    <div className="slides-table-picker-label">{t("{rows} × {columns} table", { rows: hover.rows, columns: hover.cols })}</div>
  </div>;
}

// ホワイトボードの枠を静止画として置く（#152 のホワイトボードが提供する。無いあいだはボタンを出さない）。
function WhiteboardFrameButton({ disabled, onInsert }: { disabled: boolean; onInsert: (element: SlideElement) => void }) {
  const t = useT();
  // ホワイトボードがあとから登録しても出るよう、登録の変化を聞く。
  const available = useSyncExternalStore(subscribeWhiteboardFrameProvider, hasWhiteboardFrameProvider, () => false);
  const [picker, setPicker] = useState<ReactNode>(null);
  if (!available) return null;
  return <>
    <button type="button" className="slides-tool" disabled={disabled} aria-label={t("Whiteboard frame")} title={t("Whiteboard frame")}
      onClick={() => setPicker(renderWhiteboardFramePicker({
        onPick: (frame) => { setPicker(null); onInsert(createWhiteboardElement(frame)); },
        onClose: () => setPicker(null),
      }))}>
      <PenTool size={18} />
    </button>
    {picker}
  </>;
}

export const SLIDE_SIZE = { width: SLIDE_WIDTH, height: SLIDE_HEIGHT };
