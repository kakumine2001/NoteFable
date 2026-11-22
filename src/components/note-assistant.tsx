"use client";

import { ArrowUp, FileText, LoaderCircle, Paperclip, SquarePen, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "@/components/app-icon";
import { ANSWER_RESIZED_EVENT } from "@/components/assistant-markdown";
import { AttachPageDialog } from "@/components/attach-page-dialog";
import { AttachMenu } from "@/components/attach-sheet";
import { ChatMessage } from "@/components/chat-message";
import { ModelSelect } from "@/components/model-controls";
import { useModels } from "@/components/models-provider";
import { cleanupClientUploads, uploadChatFiles } from "@/lib/client-chat-upload";
import { createUploadFile, getClipboardImageFiles, getUploadRequestError, getUploadSelectionError, getUploadValidationError, revokeUploadPreviews } from "@/lib/client-files";
import { composeQuotedMessage, splitQuotedMessage } from "@/lib/chat-quote";
import { GuestLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { keepRejectedDraft, savePendingDraft, takePendingDraft, useKeepDraftOnLeave } from "@/lib/pending-draft";
import "@/components/note-assistant.css";
import { applyActivityEvent, type ActivityEvent } from "@/lib/chat-activity";
import { readChatEventStream } from "@/lib/chat-stream";
import { deriveTurnCharacterState } from "@/lib/characters";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useDocumentHidden } from "@/lib/use-document-hidden";
import { useSwipeDismiss } from "@/lib/use-swipe-dismiss";
import { useMediaQuery } from "@/lib/use-media-query";
import { MAX_MESSAGE_NOTES, type AttachedPage, type Message, type UploadFile } from "@/types/chat";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { failureText } from "@/lib/failure-text";
import { clampFabPosition, FAB_DRAG_THRESHOLD, loadFabPosition, panelPlacement, saveFabPosition, type FabPosition } from "@/lib/fab-position";
import { UsageLimitError, usageLimitErrorFrom } from "@/lib/usage-plans";

// よく使う頼み事。押すとそのまま送る。
const QUICK_ACTIONS = [
  { label: msg("Improve writing"), prompt: "Improve the writing of this note: make it clearer and smoother, keep the meaning, the structure and the language." },
  { label: msg("Fix spelling & grammar"), prompt: "Fix spelling and grammar mistakes in this note. Do not change the wording otherwise." },
  { label: msg("Summarize"), prompt: "Add a short summary of this note at the very top, in the note's own language." },
  { label: msg("Make it shorter"), prompt: "Make this note shorter without losing the key points." },
  { label: msg("Continue writing"), prompt: "Continue writing this note from where it ends, in the same style and language." },
] as const;

// ノート内の選択テキストに対する定型操作。選択中の抜粋だけに絞って依頼する。
const SELECTION_ACTIONS = [
  { label: msg("Improve writing"), prompt: "Improve the writing of the quoted excerpt: make it clearer and smoother while keeping the meaning and language." },
  { label: msg("Fix spelling & grammar"), prompt: "Fix spelling and grammar mistakes in the quoted excerpt. Do not change the wording otherwise." },
  { label: msg("Make it shorter"), prompt: "Make the quoted excerpt shorter without losing the key points." },
  { label: msg("Explain"), prompt: "Explain the quoted excerpt clearly in the same language. Do not edit the note unless asked." },
  { label: msg("Translate"), prompt: "Translate the quoted excerpt naturally into English (or into the note's main language if it is already English). Do not edit the note unless asked." },
] as const;

// 定型ボタンで送った発言は、AI へ渡す英語の依頼文で保存される。会話を読み戻したときは、送信時と同じ短い名前で出す。
const ACTION_LABEL_BY_PROMPT = new Map<string, string>([...QUICK_ACTIONS, ...SELECTION_ACTIONS].map((action) => [action.prompt, action.label]));
function storedUserText(content: string, t: (text: string) => string) {
  const { quote, body } = splitQuotedMessage(content);
  const label = ACTION_LABEL_BY_PROMPT.get(body.trim());
  return label ? composeQuotedMessage(quote, t(label)) : content;
}

// 固定配置（position: fixed）の基準になる画面の大きさ。window.innerWidth と違い、スクロールバーの幅を含まない。rem は 1rem の px（ボタンとパネルの大きさは CSS で rem 指定なので、ブラウザーの文字サイズ設定に合わせる）。
const viewportSize = () => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 });

export function hasAssistantMessageOutput(message: Message | undefined): boolean {
  return Boolean(
    message && (
      message.content.length > 0 ||
      message.proposals?.length ||
      message.activity?.some((step) => step.kind === "proposal" || step.kind === "create_proposal")
    ),
  );
}

// 今回の送信（activeTurnAssistantId）だけから出力有無を判定し、保存・アップロード待ち中に前回の回答で responding に誤遷移させない。
export function deriveNoteAssistantCharacterStates(input: {
  messages: readonly Message[];
  activeTurnAssistantId: string | null;
  busy: boolean;
  streaming: boolean;
  outcome: "completed" | "error" | null;
  isTyping: boolean;
  hidden: boolean;
}) {
  const currentTurnAssistant = input.activeTurnAssistantId
    ? input.messages.find((message) => message.id === input.activeTurnAssistantId)
    : undefined;
  const hasTurnOutput = hasAssistantMessageOutput(currentTurnAssistant);
  return {
    hasTurnOutput,
    noteCharacterState: deriveTurnCharacterState({
      isBusy: input.busy,
      hasOutput: hasTurnOutput,
      outcome: input.outcome,
      isTyping: input.isTyping,
      hidden: input.hidden,
    }),
    replyCharacterState: deriveTurnCharacterState({
      isBusy: input.streaming,
      hasOutput: hasTurnOutput,
      outcome: input.outcome,
      hidden: input.hidden,
    }),
  };
}

// /api/chat に送り、届いた本文の差分と途中経過を順に渡す。セッション ID はレスポンスヘッダーから受け取る。
async function streamChat(
  body: FormData,
  onSession: (id: string) => void,
  onChunk: (chunk: string, activity: ActivityEvent[], elapsedMs: number) => void,
): Promise<{ streamFailed: boolean }> {
  const startedAt = Date.now();
  const response = await fetch("/api/chat", { method: "POST", body });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw usageLimitErrorFrom(response.status, data) ?? new Error(typeof data.error === "string" ? data.error : msg("Failed to send the request."));
  }
  const id = response.headers.get("X-Session-Id");
  if (id) onSession(id);

  return readChatEventStream(response.body, (chunk, activity, receivedAt) => {
    onChunk(chunk, activity, receivedAt - startedAt);
  });
}

// ノートを開いたまま使う AI アシスタント。丸いボタン（初めは右下。好きな場所へドラッグでき、位置はこのブラウザに覚える）で開き、頼んだ内容は「編集案」として出る。
// ノートは、編集案の Apply を押すまで変わらない（チャットと同じ仕組み）。
// 入力欄はチャットと同じ機能を持つ：「＋」メニュー（ファイル・写真、ノートの添付）とモデル選択。画像の作成だけは置かない（ノートの編集には使わない）。
export function NoteAssistant({ noteId, noteTitle, model, reasoning, onModelChange, onReasoningChange, flush, embedded = false, selection = null, onClearSelection, openSignal = 0, hidden = false }: {
  noteId: string;
  noteTitle: string;
  model: string;
  reasoning: string;
  // モデルと推論強度を変える（チャットの選択と共通）。渡されないとき（Android アプリの /note-embed）は選択欄を出さない。
  onModelChange?: (model: string) => void;
  onReasoningChange?: (reasoning: string) => void;
  // 頼む前に、入力中の内容を保存する（AI が最新の版を読めるように）。保存できなければ false。
  flush: () => Promise<boolean>;
  // Android アプリの /note-embed。アプリ内ではウェブの決済（Stripe）に誘導しない（Google Play のルール）。
  embedded?: boolean;
  // エディターの書式ツールバー「Ask AI」から渡された選択テキスト。
  selection?: string | null;
  onClearSelection?: () => void;
  // 増えるたびにパネルを開いて入力欄へフォーカスする。
  openSignal?: number;
  // 分割表示（チャットと並べて表示）時は右下の丸いボタンを隠す。
  hidden?: boolean;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [historyAttempt, setHistoryAttempt] = useState(0);
  const historyAbortRef = useRef<AbortController | null>(null);
  // 取得を始めた試行番号。同じ試行で二度取得しない（「もう一度試す」で番号が進む）。
  const historyAttemptRef = useRef(-1);
  const lastOpenSignalRef = useRef(openSignal);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 保存待ちから返答の終わりまで true。チャットのボタンを無効にするのに使う。
  const [busy, setBusy] = useState(false);
  // 今回の送信に対応するアシスタント回答の ID（保存・アップロード待ちの間に前回の回答を出力済みと誤認しないため）。
  const [activeTurnAssistantId, setActiveTurnAssistantId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  const [outcome, setOutcome] = useState<"completed" | "error" | null>(null);
  const outcomeTimer = useRef(0);
  const docHidden = useDocumentHidden();
  const flashOutcome = (kind: "completed" | "error" | null) => {
    window.clearTimeout(outcomeTimer.current);
    setOutcome(kind);
    if (kind) {
      outcomeTimer.current = window.setTimeout(() => setOutcome(null), kind === "completed" ? 650 : 950);
    }
  };
  useEffect(() => () => window.clearTimeout(outcomeTimer.current), []);
  const [guestLimit, setGuestLimit] = useState(false);
  const [upgradeLimit, setUpgradeLimit] = useState(false);
  // 次の発言に添付するファイルとノート。送信が受け付けられたら空にする。
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [attachedPages, setAttachedPages] = useState<AttachedPage[]>([]);
  const [pageDialogOpen, setPageDialogOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ key: string; vars?: Record<string, string | number> } | null>(null);
  const { getModelOption } = useModels();
  const modelOption = getModelOption(model);
  const uploadOptions = { supportsImages: modelOption.supportsImageInput, claudeImages: modelOption.provider === "anthropic" };
  // モデルを変えたあとに、添付済みのファイルが使えなくなったときの知らせ。
  const uploadError = getUploadValidationError(files.map(({ file }) => file), uploadOptions, t);
  // 作ったプレビュー用の URL（発言の中のサムネイルもこの URL を使う）。外したファイルの分はその場で、残りはノートを離れるときに解放する。
  // File そのものは持たない（外したファイルの中身をメモリに残さない）。
  const previewUrlsRef = useRef(new Set<string>());
  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => { for (const url of urls) URL.revokeObjectURL(url); };
  }, []);
  // 一度でも未ログインの上限に達したら、以後ページを離れるとき（サイドバーからのログインも含む）入力欄の本文を預ける。
  const guestLimitHitRef = useRef(false);
  const inputValueRef = useRef("");
  inputValueRef.current = input;
  // 選んだ範囲はこの画面の状態で、再読み込みやノートの切り替えで消える。預けるときは引用として本文に入れ、
  // 戻したあと「これを書き直して」がノート全体に向かないようにする。
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const draftToKeep = (text: string) => (text.trim() ? composeQuotedMessage(selectionRef.current, text) : "");
  const composerMountedRef = useKeepDraftOnLeave(`note:${noteId}`, () => (guestLimitHitRef.current ? draftToKeep(inputValueRef.current) : null));
  const [seconds, setSeconds] = useState(0);
  const sessionId = useRef("");
  // 保存の完了待ちも含めて、送信中は次の送信を受け付けない（連打で会話が 2 つできないように）。
  const sending = useRef(false);
  // 一番下まで読んでいる間だけ、新しい文字に合わせて下へ追従する（上へ戻って読めるように）。
  const stick = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const phone = useMediaQuery("(max-width: 639px)");
  const close = () => setOpen(false);

  // 丸いボタンの位置。null は動かしていない（CSS の既定位置＝右下）。
  const [fabPosition, setFabPosition] = useState<FabPosition | null>(() => (typeof window === "undefined" ? null : loadFabPosition()));
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? { width: 0, height: 0, rem: 16 } : viewportSize()));
  const [dragging, setDragging] = useState(false);
  // last は、このドラッグで最後に置いた位置（まだ動かしていなければ null）。
  const drag = useRef<{ pointerId: number; startX: number; startY: number; right: number; bottom: number; last: FabPosition | null } | null>(null);
  // ドラッグを終えた直後のクリックでは開閉しない。
  const skipClick = useRef(false);
  // CSS の .note-ai-fab と同じ大きさ（3.25rem、スマホは 3.5rem）。
  const fabSize = (phone ? 3.5 : 3.25) * viewport.rem;
  // 画面が小さくなっても、ボタンは必ず画面の中に置く。
  const fab = fabPosition && clampFabPosition(fabPosition, fabSize, viewport.width, viewport.height);

  useEffect(() => {
    const onResize = () => setViewport(viewportSize());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function onFabPointerDown(event: PointerEvent<HTMLButtonElement>) {
    skipClick.current = false;
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const { width, height } = viewportSize();
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, right: width - rect.right, bottom: height - rect.bottom, last: null };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  // 押した位置からの動きを、そのままボタンの位置にする。小さな動きは「押した」とみなして動かさない。
  function onFabPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const dx = event.clientX - state.startX;
    const dy = event.clientY - state.startY;
    if (!state.last && Math.hypot(dx, dy) < FAB_DRAG_THRESHOLD) return;
    const { width, height } = viewportSize();
    state.last = clampFabPosition({ right: state.right - dx, bottom: state.bottom - dy }, event.currentTarget.offsetWidth, width, height);
    setDragging(true);
    setFabPosition(state.last);
  }

  // 指を離したとき、またはブラウザーが操作を取り消したとき。取り消しのイベントは座標を持たないことがあるので、最後に置いた位置を覚える。
  function onFabPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    setDragging(false);
    if (!state.last) return;
    saveFabPosition(state.last);
    // 直後に届くクリックだけを無視する（タッチではクリックが届かないので、次の操作まで残さない）。
    skipClick.current = true;
    window.setTimeout(() => { skipClick.current = false; });
  }

  // PC では、動かしたボタンのそばにパネルを開く。動かしていなければ CSS の既定位置（右下）のまま。
  const panelStyle = fab && !phone ? panelPlacement(fab, fabSize, Math.min(26 * viewport.rem, viewport.width - 2.5 * viewport.rem), viewport.width, viewport.height) : undefined;

  // スマホではシートとして開き、端末の「戻る」で閉じられるようにする。
  useBackToClose(open && phone, close);
  // スマホでは、持ち手を下へ引いて閉じられる。
  const { attach, bind } = useSwipeDismiss<HTMLDivElement>({ axis: "y", direction: 1, onDismiss: close });

  useEffect(() => {
    if (openSignal !== lastOpenSignalRef.current) {
      lastOpenSignalRef.current = openSignal;
      if (openSignal > 0 && !hidden) {
        setOpen(true);
        if (!phone) queueMicrotask(() => inputRef.current?.focus());
      }
    }
  }, [openSignal, hidden, phone]);

  useEffect(() => {
    if (open && !phone) inputRef.current?.focus();
  }, [open, phone, selection]);

  // 初めてパネルを開いたときに、このノートの直近のアシスタント会話をサーバーから復元する。
  // 依存に historyState を入れない：読み込み中へ変えた直後に後始末が走り、自分の取得を中断してしまう。
  useEffect(() => {
    if (!open || hidden || historyAttemptRef.current === historyAttempt) return;
    historyAttemptRef.current = historyAttempt;
    const controller = new AbortController();
    historyAbortRef.current = controller;
    setHistoryState("loading");
    void fetch(`/api/pages/${encodeURIComponent(noteId)}/assistant`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Failed to load");
        return response.json() as Promise<{ sessionId?: string | null; messages?: Message[] }>;
      })
      .then((data) => {
        if (controller.signal.aborted || sending.current) return;
        sessionId.current = typeof data.sessionId === "string" ? data.sessionId : "";
        setMessages(Array.isArray(data.messages) ? data.messages.map((message) => (message.role === "USER" ? { ...message, content: storedUserText(message.content, t) } : message)) : []);
        setHistoryState("loaded");
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setHistoryState("error");
      });
  }, [open, hidden, noteId, historyAttempt, t]);

  // パネルごと外れるときだけ取得を中断する（ノートを切り替えると key が変わって作り直される）。
  // 番号も戻しておく：開発時の StrictMode は後始末のあとに効果をもう一度走らせるので、そこで取り直せるようにする。
  useEffect(() => () => {
    historyAbortRef.current?.abort();
    historyAttemptRef.current = -1;
  }, []);

  function startNewChat() {
    if (busy) return;
    historyAbortRef.current?.abort();
    sessionId.current = "";
    setMessages([]);
    setHistoryState("loaded");
    setError("");
    setGuestLimit(false);
    setUpgradeLimit(false);
    flashOutcome(null);
    onClearSelection?.();
    if (!phone) inputRef.current?.focus();
  }

  // 新しい発言や回答が増えたら下へ送る。ただし、読み返すために上へ戻っている間は動かさない。
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  // 回答の高さが後から変わったとき（数式の表示が読み込まれて描き直されたとき）も、最下部を見ているなら付いていく。
  useEffect(() => {
    const onResized = () => {
      const list = listRef.current;
      if (list && stick.current) list.scrollTop = list.scrollHeight;
    };
    window.addEventListener(ANSWER_RESIZED_EVENT, onResized);
    return () => window.removeEventListener(ANSWER_RESIZED_EVENT, onResized);
  }, []);

  function onListScroll(event: UIEvent<HTMLDivElement>) {
    const list = event.currentTarget;
    stick.current = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
  }

  // 待っている間の秒数表示。
  useEffect(() => {
    // 上限の案内からログインして戻ってきたら、このノートで送れなかった本文を入力欄へ戻す。
    const pending = takePendingDraft(`note:${noteId}`);
    if (!pending) return;
    // 戻した本文は、送るか消すまで次に離れるときも預け続ける。
    guestLimitHitRef.current = true;
    // 預けた本文に引用として入っている範囲が画面にも残っていたら（パネルを閉じて開き直したとき）、二重に送らないよう画面の方を外す。
    const kept = selectionRef.current?.trim();
    if (kept && pending.startsWith(composeQuotedMessage(kept, ""))) onClearSelection?.();
    queueMicrotask(() => setInput((current) => current || pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ノートが変わったときに 1 回だけ取り出す。
  }, [noteId]);

  useEffect(() => {
    if (!streaming) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [streaming]);

  function addFiles(incoming: File[]) {
    if (busy || !incoming.length) return;
    const current = files.map(({ file }) => file);
    const problem = getUploadSelectionError(current, incoming, uploadOptions, t);
    setError(problem);
    if (problem) return;
    // 検証を通ってからプレビュー用の URL を作る。
    const added = incoming.map(createUploadFile);
    for (const { previewUrl } of added) if (previewUrl) previewUrlsRef.current.add(previewUrl);
    setFiles((list) => [...list, ...added]);
  }

  function removeFile(id: string) {
    if (busy) return;
    setError("");
    const removed = files.filter((item) => item.id === id);
    for (const { previewUrl } of removed) if (previewUrl) previewUrlsRef.current.delete(previewUrl);
    revokeUploadPreviews(removed);
    setFiles((list) => list.filter((item) => item.id !== id));
  }

  // display は画面に出す発言（ボタンの短い名前など）。AI へは text をそのまま送る。添付は入力欄から送ったときだけ付ける。
  async function send(text: string, display?: string) {
    const content = text.trim();
    if (!content || sending.current || historyState === "loading") return;
    const activeSelection = selection?.trim() || "";
    const payloadText = activeSelection ? composeQuotedMessage(activeSelection, content) : content;
    const displayText = activeSelection ? composeQuotedMessage(activeSelection, display ?? content) : (display ?? content);
    const sentFiles = display === undefined ? files : [];
    const sentPages = display === undefined ? attachedPages : [];
    const rawFiles = sentFiles.map(({ file }) => file);
    const problem = getUploadValidationError(rawFiles, uploadOptions, t) || getUploadRequestError(rawFiles, payloadText, t)
      || (sentPages.length > MAX_MESSAGE_NOTES ? t("You can attach up to 5 pages to a message.") : "");
    if (problem) { setError(problem); flashOutcome("error"); return; }
    const assistantId = crypto.randomUUID();
    sending.current = true;
    setActiveTurnAssistantId(assistantId);
    setBusy(true);
    setError("");
    flashOutcome(null);
    if (!(await flush())) {
      setError(msg("Resolve the note's unsaved changes first, then ask again."));
      setActiveTurnAssistantId(null);
      flashOutcome("error");
      sending.current = false;
      setBusy(false);
      return;
    }

    let tickets: string[] = [];
    try {
      if (rawFiles.length) setUploadProgress({ key: msg("Preparing attachments…") });
      tickets = await uploadChatFiles(rawFiles, (name, index, total, percentage) => {
        setUploadProgress({ key: msg("Uploading {index}/{total} · {name} · {percentage}%"), vars: { index, total, name, percentage } });
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : msg("Attachment upload failed. Please try again."));
      setActiveTurnAssistantId(null);
      flashOutcome("error");
      sending.current = false;
      setBusy(false);
      return;
    } finally {
      setUploadProgress(null);
    }
    stick.current = true;

    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(), role: "USER", content: displayText,
        attachments: sentFiles.map(({ id, file, previewUrl }) => ({ id, filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size, previewUrl })),
        ...(sentPages.length ? { pages: sentPages } : {}),
      },
      { id: assistantId, role: "ASSISTANT", content: "" },
    ]);
    // 定型ボタン（display あり）で送ったときは、入力欄に書きかけの本文を残す。
    if (display === undefined) setInput("");
    setSeconds(0);
    setStreaming(true);
    const body = new FormData();
    body.append("message", payloadText);
    body.append("model", model);
    body.append("reasoning", reasoning);
    body.append("webSearch", "off");
    body.append("noteId", noteId);
    if (activeSelection) body.append("noteSelection", "1");
    if (sessionId.current) body.append("sessionId", sessionId.current);
    if (tickets.length) body.append("uploads", JSON.stringify(tickets));
    if (sentPages.length) body.append("pages", JSON.stringify(sentPages.map((page) => page.id)));

    // サーバーが発言を受け付けたか。受け付ける前に断られたら、添付は入力欄に残し、上げたファイルは片付ける。
    let accepted = false;
    try {
      const { streamFailed } = await streamChat(
        body,
        (id) => {
          sessionId.current = id;
          accepted = true;
          if (activeSelection) onClearSelection?.();
          if (display === undefined) {
            setFiles((list) => list.filter((item) => !sentFiles.includes(item)));
            setAttachedPages((list) => list.filter((page) => !sentPages.includes(page)));
          }
        },
        (chunk, activity, elapsedMs) => setMessages((current) => current.map((message) => message.id !== assistantId ? message : {
          ...message,
          content: message.content + chunk,
          activity: activity.length ? activity.reduce(applyActivityEvent, message.activity ?? []) : message.activity,
          thinkingMs: message.thinkingMs ?? (chunk ? elapsedMs : undefined),
        })),
      );
      flashOutcome(streamFailed ? "error" : "completed");
    } catch (caught) {
      flashOutcome("error");
      const detail = caught instanceof Error ? caught.message : msg("Unknown error.");
      const limited = caught instanceof UsageLimitError;
      if (!accepted && tickets.length) void cleanupClientUploads(tickets);
      if (limited && caught.tier === "guest") { guestLimitHitRef.current = true; setGuestLimit(true); }
      if (limited && caught.tier === "member" && !embedded) { guestLimitHitRef.current = true; setUpgradeLimit(true); }
      // 上限で断られた本文は保存されていない。入力欄から送ったものなら戻す（待つ間に書き足した文は後ろに残す）。
      // 待つ間に別のノートへ移っていたら、入力欄の代わりにこのノートの分として預けておく。
      if (limited && display === undefined && !composerMountedRef.current) keepRejectedDraft(`note:${noteId}`, activeSelection ? payloadText : text);
      if (limited && display === undefined) setInput((current) => (current.trim() ? [text.trimEnd(), current].join("\n\n") : text));
      // すでに届いた本文は残し、上限・失敗の文だけを表示時に訳す。
      setMessages((current) => current.map((message) => message.id === assistantId
        ? { ...message, content: limited ? detail : message.content ? `${message.content}\n\n${failureText(detail)}` : failureText(detail),
          failed: true, usageLimit: limited ? caught.kind : undefined,
          activity: limited ? message.activity : applyActivityEvent(message.activity ?? [], { type: "failure", id: "request-failure", offset: message.content ? message.content.length + 2 : 0, detail }) }
        : message));
    } finally {
      setStreaming(false);
      sending.current = false;
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // IME の確定 Enter では送らない。
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
      event.preventDefault();
      void send(event.currentTarget.value);
    }
    if (event.key === "Escape" && !phone) close();
  }

  const { noteCharacterState, replyCharacterState } = deriveNoteAssistantCharacterStates({
    messages,
    activeTurnAssistantId,
    busy,
    streaming,
    outcome,
    isTyping: open && (inputFocused || Boolean(input.trim())),
    hidden: docHidden,
  });

  const panel = (
    <div ref={attach} className={`note-ai-panel ${phone ? "is-sheet" : ""}`} style={panelStyle} role="dialog" aria-modal={phone || undefined} aria-label={t("Ask AI about this note")}>
      {phone && <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>}
      <header className="note-ai-header">
        <AppIcon size={18} state={replyCharacterState} animated={replyCharacterState !== "idle" && replyCharacterState !== "hidden"} />
        <span className="note-ai-title" title={noteTitle}>{t("Ask AI about this note")}</span>
        {messages.length > 0 && (
          <button type="button" className="notion-icon-button grid" disabled={busy || historyState === "loading"} onClick={startNewChat}
            aria-label={t("New chat")} title={t("New chat")}><SquarePen size={15} /></button>
        )}
        <button type="button" className="notion-icon-button grid" onClick={close} aria-label={t("Close")}><X size={16} /></button>
      </header>

      <div ref={listRef} className="note-ai-list" onScroll={onListScroll}>
        {historyState === "loading" && messages.length === 0 ? (
          <div className="note-ai-loading" role="status">
            <LoaderCircle size={15} className="animate-spin" aria-hidden="true" />
            <span>{t("Loading…")}</span>
          </div>
        ) : (
          <>
            {historyState === "error" && messages.length === 0 && (
              <div className="note-ai-history-error" role="alert">
                <span>{t("Could not load previous conversation.")}</span>
                <button type="button" className="notion-button" onClick={() => { setHistoryState("idle"); setHistoryAttempt((n) => n + 1); }}>{t("Try again")}</button>
              </div>
            )}
            {messages.length === 0 ? (
              <div className="note-ai-empty">
                <p>{t("Tell the AI how to change this note. You review its proposal before anything changes.")}</p>
                {!selection && (
                  <div className="note-ai-chips">
                    {QUICK_ACTIONS.map((action) => (
                      <button key={action.label} type="button" className="note-ai-chip" disabled={busy} onClick={() => void send(action.prompt, t(action.label))}>{t(action.label)}</button>
                    ))}
                  </div>
                )}
              </div>
            ) : messages.map((message) => (
              <ChatMessage key={message.id} message={message} isStreaming={streaming && message.id === activeTurnAssistantId} thinkingSeconds={seconds}
                characterState={message.id === activeTurnAssistantId ? replyCharacterState : undefined} characterSize={24} />
            ))}
          </>
        )}
      </div>

      {upgradeLimit && <UpgradePrompt kind="chat" onClose={() => setUpgradeLimit(false)} onBeforeUpgrade={() => savePendingDraft(`note:${noteId}`, draftToKeep(input))} />}
      {guestLimit && <GuestLimitPrompt kind="chat" onClose={() => setGuestLimit(false)} onBeforeSignIn={() => savePendingDraft(`note:${noteId}`, draftToKeep(input))} />}
      {(uploadError || error) && <p className="note-ai-error" role="alert">{uploadError || t(error)}</p>}
      {/* チャットの入力欄と同じ理由で、ページ翻訳の対象から外す（書き換えられると React の更新が失敗する）。 */}
      <form className="note-ai-form" onSubmit={submit} translate="no">
        {selection && (
          <div className="note-ai-selection">
            <div className="chat-quote note-ai-quote" role="group" aria-label={t("Selected text")}>
              <span className="chat-quote-text">{selection}</span>
              <button type="button" className="chat-quote-remove" disabled={busy} onClick={() => onClearSelection?.()}
                aria-label={t("Remove selection")} title={t("Remove selection")}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="note-ai-chips note-ai-selection-chips">
              {SELECTION_ACTIONS.map((action) => (
                <button key={action.label} type="button" className="note-ai-chip is-compact" disabled={busy || historyState === "loading"}
                  onClick={() => void send(action.prompt, t(action.label))}>{t(action.label)}</button>
              ))}
            </div>
          </div>
        )}
        {(attachedPages.length > 0 || files.length > 0) && (
          // 添付したノートとファイル。押すと外れる（チャットの入力欄と同じ）。
          <ul className="note-ai-attachments" aria-label={t("Attached pages")}>
            {attachedPages.map((page) => (
              <li key={page.id}>
                <button type="button" className="note-ai-attachment" disabled={busy} aria-label={t("Remove {title}", { title: page.title || t("Untitled") })}
                  onClick={() => { setError(""); setAttachedPages((list) => list.filter((item) => item.id !== page.id)); }}>
                  {page.icon ? <span aria-hidden="true">{page.icon}</span> : <FileText size={13} aria-hidden="true" />}
                  <span className="truncate">{page.title || t("Untitled")}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
            {files.map(({ id, file, previewUrl }) => (
              <li key={id}>
                <button type="button" className="note-ai-attachment" disabled={busy} aria-label={t("Remove {title}", { title: file.name })} onClick={() => removeFile(id)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 選んだ画像のその場のプレビュー（blob: URL）。 */}
                  {previewUrl ? <img src={previewUrl} alt="" className="note-ai-attachment-thumb" /> : <Paperclip size={13} aria-hidden="true" />}
                  <span className="truncate">{file.name}</span>
                  <X size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="note-ai-composer">
          <textarea ref={inputRef} value={input} rows={1} readOnly={Boolean(uploadProgress)}
            onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
            onChange={(event) => { setInput(event.target.value); if (outcome === "error") flashOutcome(null); }} onKeyDown={onKeyDown}
            onPaste={(event) => {
              const pasted = getClipboardImageFiles(event.clipboardData.items);
              if (!pasted.length) return;
              // 画像がある時だけ既定の貼り付けを止め、添付に回す。
              event.preventDefault();
              addFiles(pasted);
            }}
            placeholder={t("Ask AI to edit this note…")} aria-label={t("Instruction for the AI")} className="note-ai-input" />
          <div className="note-ai-tools">
            <AttachMenu className="relative" backToClose={phone} disabled={busy} onFilesChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}
              onAttachPages={() => setPageDialogOpen(true)} />
            {onModelChange && onReasoningChange && <ModelSelect value={model} reasoning={reasoning} onModelChange={onModelChange} onReasoningChange={onReasoningChange} />}
            <button type="submit" className="note-ai-send" disabled={busy || historyState === "loading" || !input.trim() || Boolean(uploadError)} aria-label={t("Send")}><ArrowUp size={16} /></button>
          </div>
        </div>
        {uploadProgress && <div role="status" className="note-ai-progress">{t(uploadProgress.key, uploadProgress.vars)}</div>}
      </form>
      {pageDialogOpen && <AttachPageDialog initial={attachedPages} onClose={() => setPageDialogOpen(false)} onAttach={(pages) => { setError(""); setAttachedPages(pages); }} />}
    </div>
  );

  if (hidden) return null;

  return (
    <>
      <button type="button" className={`note-ai-fab ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
        style={fab ? { right: fab.right, bottom: fab.bottom } : undefined}
        onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerEnd} onPointerCancel={onFabPointerEnd}
        onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setOpen((current) => !current); }}
        aria-label={t("Ask AI about this note")} aria-expanded={open} title={t("Ask AI")}>
        <AppIcon size={34} state={noteCharacterState} animated />
      </button>
      {open && (phone
        ? createPortal(
          <div className="model-sheet-root note-ai-root">
            <button type="button" className="model-sheet-backdrop" aria-label={t("Close")} onClick={close} />
            {panel}
          </div>,
          document.body)
        : panel)}
    </>
  );
}
