"use client";

import { ArrowUp, History, Image as ImageIcon, Paperclip, Sparkles, SquarePen, X, Zap } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type PointerEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { AppIcon } from "@/components/app-icon";
import { ANSWER_RESIZED_EVENT } from "@/components/assistant-markdown";
import { AttachPageDialog } from "@/components/attach-page-dialog";
import { AttachMenu } from "@/components/attach-sheet";
import { ChatMessage } from "@/components/chat-message";
import { ModelSelect } from "@/components/model-controls";
import { useModels } from "@/components/models-provider";
import { composeQuotedMessage, normalizeQuote, splitQuotedMessage } from "@/lib/chat-quote";
import { cleanupClientUploads, uploadChatFilesWithSelection } from "@/lib/client-chat-upload";
import { createUploadFile, getClipboardImageFiles, getUploadRequestError, getUploadSelectionError, getUploadValidationError, revokeUploadPreviews } from "@/lib/client-files";
import { GuestLimitPrompt, StorageLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
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
import { useI18n } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { failureText } from "@/lib/failure-text";
import { relativeTime } from "@/lib/notes-home-text";
import { chatsTurns, notePanelTurns } from "@/lib/session-turns";
import { anchorAncestors, anchorFabPosition, clampFabPosition, FAB_DRAG_THRESHOLD, loadFabPosition, panelPlacement, saveFabPosition, type FabPosition } from "@/lib/fab-position";
import { StorageLimitError, UsageLimitError, storageLimitErrorFrom, usageLimitErrorFrom } from "@/lib/usage-plans";
import { nativeCanOpenPage, nativeCanShowStorageLimit, nativeCanShowUsageLimit, postToNative } from "@/lib/native-bridge";
import { NoteIcon } from "@/components/note-icon";
import { PageKindIcon } from "@/components/page-kind-icon";
import { ProposalHostContext, type ProposalHost } from "@/components/page-proposal";
import { PAGE_KIND_FEATURES, type PageKind } from "@/lib/page-kinds";
import { isSelectionId, MAX_SELECTION_IDS, type PageSelection } from "@/lib/page-ai/types";
import { loadAutoApply, saveAutoApply } from "@/lib/ai-auto-apply";

type QuickAction = { label: string; prompt: string };

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

// ホワイトボード・スライドの頼み事。AI が操作できるようになるまで（#153・#150）、答えるだけのもの。
const WHITEBOARD_ACTIONS = [
  { label: msg("Summarize"), prompt: "Summarize this whiteboard in a few bullet points, in its own language. Do not change it." },
  { label: msg("Find gaps"), prompt: "Point out what is missing or unclear on this whiteboard, in its own language. Do not change it." },
  { label: msg("Suggest next steps"), prompt: "Suggest concrete next steps based on this whiteboard, in its own language. Do not change it." },
] as const;
const SLIDES_ACTIONS = [
  { label: msg("Summarize"), prompt: "Summarize this slide deck in a few bullet points, in its own language. Do not change it." },
  { label: msg("Suggest improvements"), prompt: "Suggest how to improve this slide deck (structure, clarity and wording), in its own language. Do not change it." },
] as const;
// ホワイトボード・スライドで選んだ要素・スライドについての頼み事（PR 6/7 で編集ツールが入るまでは読み取り専用の助言）。
const WHITEBOARD_SELECTION_ACTIONS = [
  { label: msg("Summarize"), prompt: "Summarize the selected items in their own language. Do not change the page unless asked." },
  { label: msg("Explain"), prompt: "Explain the selected items clearly in their own language. Do not change the page unless asked." },
  { label: msg("Group & organize"), prompt: "Suggest how to group and organize the selected items, in their own language. Do not change the page unless asked." },
  { label: msg("Find gaps"), prompt: "Point out what is missing or unclear in the selected items, in their own language. Do not change the page unless asked." },
  { label: msg("Suggest next steps"), prompt: "Suggest concrete next steps based on the selected items, in their own language. Do not change the page unless asked." },
] as const;
const SLIDES_SELECTION_ACTIONS = [
  { label: msg("Summarize"), prompt: "Summarize the selected items in their own language. Do not change the page unless asked." },
  { label: msg("Explain"), prompt: "Explain the selected items clearly in their own language. Do not change the page unless asked." },
  { label: msg("Find gaps"), prompt: "Point out what is missing or unclear in the selected items, in their own language. Do not change the page unless asked." },
  { label: msg("Suggest next steps"), prompt: "Suggest concrete next steps based on the selected items, in their own language. Do not change the page unless asked." },
] as const;

const ACTION_LABEL_BY_PROMPT = new Map<string, string>(
  [...QUICK_ACTIONS, ...SELECTION_ACTIONS, ...WHITEBOARD_ACTIONS, ...SLIDES_ACTIONS, ...WHITEBOARD_SELECTION_ACTIONS, ...SLIDES_SELECTION_ACTIONS]
    .map((action) => [action.prompt, action.label]),
);

// 種類ごとの既定の頼み事（エディターが quickActions を渡せば、そちらを使う）。
const DEFAULT_ACTIONS: Record<PageKind, { quick: readonly QuickAction[]; selection: readonly QuickAction[] }> = {
  note: { quick: QUICK_ACTIONS, selection: SELECTION_ACTIONS },
  whiteboard: { quick: WHITEBOARD_ACTIONS, selection: WHITEBOARD_SELECTION_ACTIONS },
  slides: { quick: SLIDES_ACTIONS, selection: SLIDES_SELECTION_ACTIONS },
};

// 種類ごとの文言。
const KIND_TEXT: Record<PageKind, { title: string; placeholder: string; history: string; readOnly: string }> = {
  note: { title: msg("Ask AI about this note"), placeholder: msg("Ask AI to edit this note…"), history: msg("Chats in this note"), readOnly: "" },
  whiteboard: {
    title: msg("Ask AI about this whiteboard"), placeholder: msg("Ask AI about this whiteboard…"), history: msg("Chats on this page"),
    readOnly: msg("Ask the AI about this whiteboard. It can read the text on it but can't change it yet."),
  },
  slides: {
    title: msg("Ask AI about this slide deck"), placeholder: msg("Ask AI about this slide deck…"), history: msg("Chats on this page"),
    readOnly: msg("Ask the AI about this slide deck. It can read the text on it but can't change it yet."),
  },
};

// ノートの AI パネルで会話が増えた・進んだことを、Chats の一覧（/app のサイドバー）へ知らせるイベント。
export const NOTE_CHAT_SAVED_EVENT = "notefable:note-chat-saved";

// このノートで始めた会話（パネルの履歴に出す分）。
type NoteChat = { id: string; title: string; updatedAt: string };

// 保存された会話を読み直すとき、定型ボタンで送った長い指示文は、送ったときと同じ短い名前に戻して見せる。
// 選んだ範囲に対するボタンは「引用 + 指示文」で保存されるので、引用は残して指示文だけ戻す。
// extra はエディターが渡した頼み事のボタン（既定の表に無いもの）。
export function restoreNoteChatMessages(messages: Message[], t: (key: string) => string, extra: readonly QuickAction[] = []): Message[] {
  const labels = extra.length ? new Map([...ACTION_LABEL_BY_PROMPT, ...extra.map((action) => [action.prompt, action.label] as const)]) : ACTION_LABEL_BY_PROMPT;
  return messages.map((message) => {
    if (message.role !== "USER") return message;
    const { quote, body } = splitQuotedMessage(message.content);
    const label = labels.get(body.trim());
    return label ? { ...message, content: composeQuotedMessage(quote, t(label)) } : message;
  });
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
    throw usageLimitErrorFrom(response.status, data) ?? storageLimitErrorFrom(response.status, data) ?? new Error(typeof data.error === "string" ? data.error : msg("Failed to send the request."));
  }
  const id = response.headers.get("X-Session-Id");
  if (id) onSession(id);

  return readChatEventStream(response.body, (chunk, activity, receivedAt) => {
    onChunk(chunk, activity, receivedAt - startedAt);
  });
}

// ページ（ノート・ホワイトボード・スライド）を開いたまま使う AI アシスタント（AI 操控底座の AI パネル。docs/architecture/notes-flow.md）。
// 丸いボタン（初めは右下。好きな場所へドラッグでき、位置はこのブラウザに覚える）で開き、頼んだ内容は「編集案」として出る。
// ページは、編集案の Apply を押すまで変わらない（チャットと同じ仕組み）。「自動適用」を入れると、編集案はすぐ適用され、カードから元に戻せる。
// 入力欄はチャットと同じ機能を持つ：「＋」メニュー（ファイル・写真、ノートの添付）とモデル選択。画像の作成だけは置かない（ページの編集には使わない）。
// ホワイトボード・スライドのエディターは、選んだ要素・スライドを selection（文字と ID）で渡す。
export function PageAssistant({ pageId: noteId, pageKind = "note", pageTitle: noteTitle, model, reasoning, onModelChange, onReasoningChange, flush, embedded = false, selection = null, onClearSelection, openSignal = 0, hidden = false, quickActions, selectionActions, anchor = null }: {
  pageId: string;
  pageKind?: PageKind;
  pageTitle: string;
  model: string;
  reasoning: string;
  // モデルと推論強度を変える（チャットの選択と共通）。渡されないとき（Android アプリの /note-embed）は選択欄を出さない。
  onModelChange?: (model: string) => void;
  onReasoningChange?: (reasoning: string) => void;
  // 頼む前に、入力中の内容を保存する（AI が最新の版を読めるように）。保存できなければ false。
  flush: () => Promise<boolean>;
  // Android アプリの /note-embed。アプリ内ではウェブの決済（Stripe）に誘導しない（Google Play のルール）。
  embedded?: boolean;
  // エディターで選んだ範囲（ノートの書式ツールバー「Ask AI」の文字、ホワイトボード・スライドの要素・スライド）。
  selection?: PageSelection | null;
  onClearSelection?: (sent?: PageSelection | null) => void;
  // 増えるたびにパネルを開いて入力欄へフォーカスする。
  openSignal?: number;
  // 分割表示（チャットと並べて表示）時は右下の丸いボタンを隠す。
  hidden?: boolean;
  // エディターごとの頼み事のボタン（省略すると種類ごとの既定）。
  quickActions?: readonly QuickAction[];
  selectionActions?: readonly QuickAction[];
  // エディターが用意したボタンの置き場所（CanvasEditorProps.aiSlot の目印）。動かしていないボタンはここに重ねる。
  anchor?: HTMLElement | null;
}) {
  const { t, tag } = useI18n();
  // 提案カードに、このパネルのページを伝える（そのページへの「開く」は出さない）。
  // アプリ（/note-embed）の中のカードの「開く」は、アプリにページを開いてもらう。開けない古いアプリでは出さない（ブラウザに飛ばさない）。
  const proposalHost = useMemo<ProposalHost>(() => embedded
    ? (nativeCanOpenPage() ? { currentPageId: noteId, openPage: (id) => postToNative({ type: "openPage", id }) } : { currentPageId: noteId, noOpen: true })
    : { currentPageId: noteId }, [noteId, embedded]);
  const kindText = KIND_TEXT[pageKind];
  const actions = quickActions ?? DEFAULT_ACTIONS[pageKind].quick;
  const pickedActions = selectionActions ?? DEFAULT_ACTIONS[pageKind].selection;
  // AI がこの種類のページを変えられるか（読むだけの種類には「自動適用」を出さない）。
  const editable = PAGE_KIND_FEATURES[pageKind].aiEdit;
  // 「自動適用」はこのブラウザに種類ごとに覚える。既定は「提案 → 確認」。
  const [autoApply, setAutoApply] = useState(false);
  useEffect(() => { queueMicrotask(() => setAutoApply(loadAutoApply(pageKind))); }, [pageKind]);
  const autoApplyOn = editable && autoApply;
  // エディターが渡した文字も、ノートの「Ask AI」と同じく整えて長さを抑える（normalizeQuote）。
  const selectionText = selection?.text ? normalizeQuote(selection.text) : "";
  // サーバーが受け付ける形にそろえる（重複・空・長すぎる ID を外し、上限の数まで）。上限を超えた選択でも送れなくならない。
  const selectionIds = [...new Set((selection?.ids ?? []).filter(isSelectionId))].slice(0, MAX_SELECTION_IDS);
  const hasSelection = Boolean(selectionText || selectionIds.length);
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  // このノートで始めた会話の一覧（新しい順）と、いま開いている会話。会話はサーバーに保存され、Chats の一覧にも出る。
  const [chats, setChats] = useState<NoteChat[] | null>(null);
  const [chatId, setChatId] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyOpenedAt, setHistoryOpenedAt] = useState(0);
  const [loadingChat, setLoadingChat] = useState(false);
  // 送信の可否は ref で見る（読み込み開始の直後、描き直す前の送信も止める）。
  const loadingRef = useRef(false);
  const [chatsFailed, setChatsFailed] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  // 会話の読み込みの通し番号。読み込み中に別の会話や新しい会話へ移ったら、遅れて届いた結果は捨てる。
  const loadSeq = useRef(0);
  const restored = useRef(false);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 保存待ちから返答の終わりまで true。チャットのボタンを無効にするのに使う。
  const [busy, setBusy] = useState(false);
  // 今回の送信に対応するアシスタント回答の ID（保存・アップロード待ちの間に前回の回答を出力済みと誤認しないため）。
  const [activeTurnAssistantId, setActiveTurnAssistantId] = useState<string | null>(null);
  const [error, setError] = useState("");
  // 選区画像のキャプチャに失敗して文字だけ送ったときなど、送信を止めない穏やかな知らせ。
  const [notice, setNotice] = useState("");
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
  // 添付の容量が足りずに断られたとき。アプリに埋め込んだ画面では、案内を出せるアプリならアプリの画面に任せる。
  const [storageLimit, setStorageLimit] = useState<StorageLimitError | null>(null);
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
  // 上限の案内は一度に 1 つだけ出す（Android / iOS と同じく、新しく断られた理由に置き換える）。
  const showLimitPrompt = (next: { guest?: boolean; upgrade?: boolean; storage?: StorageLimitError }) => {
    setGuestLimit(next.guest ?? false);
    setUpgradeLimit(next.upgrade ?? false);
    setStorageLimit(next.storage ?? null);
  };
  // inline: 発言の吹き出しに理由が出ない断り（添付のアップロード）。アプリが案内を出すときも、パネルの中に理由を残す
  // （案内はパネルの外、エディターの上に出る）。送信が断られたときは吹き出しに理由が出るので、重ねて出さない。
  const showStorageLimit = (error: StorageLimitError, { inline = false } = {}) => {
    if (error.tier !== "pro") guestLimitHitRef.current = true;
    if (embedded && error.tier !== "pro" && inputValueRef.current.trim()) {
      savePendingDraft(`note:${noteId}`, draftToKeep(inputValueRef.current), { persistent: true });
    }
    if (embedded && composerMountedRef.current && nativeCanShowStorageLimit() && postToNative({ type: "storageLimit", tier: error.tier, used: error.used, limit: error.limit })) {
      showLimitPrompt({});
      if (inline) setError(error.message);
      return;
    }
    showLimitPrompt({ storage: error });
  };
  const showUsageLimit = (limitError: UsageLimitError) => {
    if (limitError.tier !== "pro") guestLimitHitRef.current = true;
    if (embedded) {
      if (composerMountedRef.current && nativeCanShowUsageLimit()) {
        postToNative({ type: "usageLimit", tier: limitError.tier, kind: limitError.kind, pageId: noteId });
      }
      // WebView 内ではウェブのログイン・Stripe 画面を開かず、新アプリはネイティブ案内、旧アプリは吹き出しの理由だけを出す。
      showLimitPrompt({});
      return;
    }
    if (limitError.tier === "guest") showLimitPrompt({ guest: true });
    else if (limitError.tier === "member") showLimitPrompt({ upgrade: true });
    else showLimitPrompt({});
  };
  const inputValueRef = useRef("");
  inputValueRef.current = input;
  // 選んだ範囲はこの画面の状態で、再読み込みやノートの切り替えで消える。預けるときは引用として本文に入れ、
  // 戻したあと「これを書き直して」がノート全体に向かないようにする。
  const selectionRef = useRef(selectionText);
  selectionRef.current = selectionText;
  const draftToKeep = (text: string) => (text.trim() ? composeQuotedMessage(selectionRef.current, text) : "");
  const composerMountedRef = useKeepDraftOnLeave(
    `note:${noteId}`,
    () => (guestLimitHitRef.current ? draftToKeep(inputValueRef.current) : null),
    { persistent: embedded },
  );
  // アプリの WebView はログイン成功時に破棄・再作成される（pagehide が走らないこともある）ため、
  // 上限到達後は下書きの変化をその都度 localStorage に反映しておく。
  useEffect(() => {
    if (!embedded || !guestLimitHitRef.current) return;
    savePendingDraft(`note:${noteId}`, input.trim() ? composeQuotedMessage(selectionRef.current, input) : "", { persistent: true });
  }, [embedded, noteId, input]);
  const lastOpenSignalRef = useRef(openSignal);
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

  // 丸いボタンの位置。null は動かしていない（エディターの置き場所があればそこ、なければ CSS の既定位置＝右下）。
  const [fabPosition, setFabPosition] = useState<FabPosition | null>(() => (typeof window === "undefined" ? null : loadFabPosition()));
  const [anchorPosition, setAnchorPosition] = useState<FabPosition | null>(null);
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? { width: 0, height: 0, rem: 16 } : viewportSize()));
  const [dragging, setDragging] = useState(false);
  // last は、このドラッグで最後に置いた位置（まだ動かしていなければ null）。
  const drag = useRef<{ pointerId: number; startX: number; startY: number; right: number; bottom: number; last: FabPosition | null } | null>(null);
  // ドラッグを終えた直後のクリックでは開閉しない。
  const skipClick = useRef(false);
  // CSS の .note-ai-fab と同じ大きさ（3.25rem、スマホは 3.5rem）。
  const fabSize = (phone ? 3.5 : 3.25) * viewport.rem;
  // 画面が小さくなっても、ボタンは必ず画面の中に置く。動かした位置が、エディターの置き場所より優先。
  const placed = fabPosition ?? anchorPosition;
  const fab = placed && clampFabPosition(placed, fabSize, viewport.width, viewport.height);
  // エディターの置き場所にいる間は、エディターの重なり順に合わせる（エディターのシート・メニューの下になる）。
  const anchored = !fabPosition && !!anchorPosition;

  // エディターの置き場所を測り直す。目印の親たち（置き場所を含む面）の大きさが変わったとき
  // （メモ欄の開閉、サイドバーの開閉、隠れていたワークスペースが表示されたときなど）と、画面の大きさが変わったとき。
  useEffect(() => {
    if (!anchor) { setAnchorPosition(null); return; }
    const measure = () => {
      const { width, height } = viewportSize();
      setAnchorPosition(anchorFabPosition(anchor.getBoundingClientRect(), width, height));
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    for (const element of anchorAncestors<Element>(anchor, document.body)) observer?.observe(element);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [anchor]);

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

  // 「Ask AI」で範囲が渡されたら、パネルを開いて入力欄へ。
  useEffect(() => {
    if (openSignal !== lastOpenSignalRef.current) {
      lastOpenSignalRef.current = openSignal;
      if (openSignal > 0 && !hidden) {
        setOpen(true);
        setHistoryOpen(false);
        if (!phone) queueMicrotask(() => inputRef.current?.focus());
      }
    }
  }, [openSignal, hidden, phone]);

  // パネルを新しく開いたときだけ入力欄へフォーカスする。すでに開いた状態でキャンバス上の選択が変わったときはフォーカスを奪わない（Delete キーなどの操作を妨げないため）。
  useEffect(() => {
    if (open && !phone) inputRef.current?.focus();
  }, [open, phone]);

  // 新しい発言や回答が増えたら下へ送る。ただし、読み返すために上へ戻っている間は動かさない。
  useEffect(() => {
    const list = listRef.current;
    if (list && stick.current) list.scrollTop = list.scrollHeight;
  }, [messages, open, historyOpen]);

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
    // 分割表示で隠れている間は取り出さない（見えない入力欄に入れると、預けた本文が失われる）。
    if (hidden) return;
    const pending = takePendingDraft(`note:${noteId}`);
    if (!pending) return;
    // 戻した本文は、送るか消すまで次に離れるときも預け続ける。
    guestLimitHitRef.current = true;
    // 預けた本文に引用として入っている範囲が画面にも残っていたら（パネルを閉じて開き直したとき）、二重に送らないよう画面の方を外す。
    const kept = selectionRef.current?.trim();
    if (kept && pending.startsWith(composeQuotedMessage(kept, ""))) onClearSelection?.();
    queueMicrotask(() => setInput((current) => current || pending));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ノートが変わったとき（と、隠れていたパネルが出たとき）に 1 回だけ取り出す。
  }, [noteId, hidden]);

  useEffect(() => {
    if (!streaming) return;
    const started = Date.now();
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 500);
    return () => window.clearInterval(timer);
  }, [streaming]);

  async function loadChats() {
    try {
      const response = await fetch(`/api/sessions?noteId=${encodeURIComponent(noteId)}`, { cache: "no-store" });
      const data = response.ok ? await response.json().catch(() => null) : null;
      if (!data || !Array.isArray(data.sessions)) { setChatsFailed(true); return null; }
      const list = (data.sessions as NoteChat[]).map(({ id, title, updatedAt }) => ({ id, title, updatedAt }));
      setChats(list);
      setChatsFailed(false);
      return list;
    } catch {
      setChatsFailed(true);
      return null;
    }
  }

  // 保存された会話の発言。消えた会話（404）は一時的な失敗（null）と区別する。
  async function fetchChat(id: string) {
    try {
      const response = await fetch(`/api/sessions/${id}/messages`, { cache: "no-store" });
      if (response.status === 404) return "missing" as const;
      const data = response.ok ? await response.json().catch(() => null) : null;
      return data && Array.isArray(data.messages) ? restoreNoteChatMessages(data.messages as Message[], t, [...actions, ...pickedActions]) : null;
    } catch {
      return null;
    }
  }

  function setLoading(value: boolean) {
    loadingRef.current = value;
    setLoadingChat(value);
  }

  // 会話を持たない新しい状態にする（これまでの会話は保存されたまま）。
  function resetChat() {
    loadSeq.current += 1;
    setLoading(false);
    sessionId.current = "";
    setChatId("");
    setActiveTurnAssistantId(null);
    setNotice("");
    setMessages([]);
  }

  // 保存された会話を開く。送信中は切り替えない（届いている回答の行き先が変わらないように）。
  async function openChat(id: string) {
    if (sending.current) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    setError("");
    setNotice("");
    const loaded = await fetchChat(id);
    if (seq !== loadSeq.current || sending.current) return;
    setLoading(false);
    if (!loaded || loaded === "missing") {
      setError(msg("Failed to load conversation."));
      if (loaded === "missing") void loadChats();
      return;
    }
    sessionId.current = id;
    setChatId(id);
    setActiveTurnAssistantId(null);
    stick.current = true;
    setMessages(loaded);
    setHistoryOpen(false);
  }

  // 新しい会話を始める。これまでの会話は保存されたまま、履歴から開き直せる。
  function newChat() {
    if (sending.current) return;
    resetChat();
    setError("");
    setHistoryOpen(false);
    onClearSelection?.();
    if (!phone) inputRef.current?.focus();
  }

  // 開いている会話を、サーバーの今の状態に合わせ直す。このパネルは Chats を見ている間も残るので、
  // その間に Chats で続けた・編集した・消した会話を、古いまま見せたり続けたりしないようにする。
  async function syncChat() {
    if (!restored.current || sending.current || loadingRef.current) return;
    void loadChats();
    const id = sessionId.current;
    if (!id) return;
    const seq = loadSeq.current;
    const loaded = await fetchChat(id);
    if (seq !== loadSeq.current || sending.current || sessionId.current !== id || !loaded) return;
    if (loaded === "missing") resetChat();
    else setMessages(loaded);
  }
  const syncChatRef = useRef(syncChat);
  useEffect(() => { syncChatRef.current = syncChat; });

  // 初めてパネルを開いたとき、このノートの直近の会話を続きから出す（前はページを開き直すたびに消えていた）。開き直したときは今の状態に合わせる。
  useEffect(() => {
    if (!open) return;
    if (restored.current) { void syncChatRef.current(); return; }
    restored.current = true;
    // 一覧が届いて直近の会話を開き終えるまでは送らせない（届く前に送ると、続きではなく別の新しい会話になる）。
    // その間に「新しいチャット」や履歴から選んだら（loadSeq が進む）、そちらを優先して自動では開かない。
    const seq = ++loadSeq.current;
    setLoading(true);
    void loadChats().then((list) => {
      if (seq !== loadSeq.current) return;
      if (list?.length && !sessionId.current && !sending.current) void openChat(list[0].id);
      else setLoading(false);
    });
    // 開いたときだけ読む。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Chats から戻ってきてノートがまた表示されたとき（丸いボタンが見えるようになったとき）も合わせ直す。
  useEffect(() => {
    const fabElement = fabRef.current;
    if (!fabElement || typeof IntersectionObserver === "undefined") return;
    let seen = false;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      if (visible && seen) void syncChatRef.current();
      if (visible) seen = true;
    });
    observer.observe(fabElement);
    return () => observer.disconnect();
  }, []);

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
    if (!content || sending.current || loadingRef.current) return;
    // 選んだ範囲があれば、引用として発言の先頭に付けて送る。要素・スライドの ID は別の欄で送る。
    const submittedSelection = selection;
    const activeSelection = selectionText;
    const activeIds = selectionIds;
    const activeCapture = selection?.captureImage;
    const payloadText = activeSelection ? composeQuotedMessage(activeSelection, content) : content;
    const displayText = activeSelection ? composeQuotedMessage(activeSelection, display ?? content) : (display ?? content);
    const sentFiles = display === undefined ? files : [];
    const sentPages = display === undefined ? attachedPages : [];
    const rawFiles = sentFiles.map(({ file }) => file);
    const problem = getUploadValidationError(rawFiles, uploadOptions, t) || getUploadRequestError(rawFiles, payloadText, t)
      || (sentPages.length > MAX_MESSAGE_NOTES ? t("You can attach up to 5 pages to a message.") : "");
    if (problem) { setError(problem); flashOutcome("error"); return; }
    // この会話が Chats で回答を待っている間は、ここからは送らない（2 つの発言が同じ枝で重なる）。
    if (sessionId.current && chatsTurns.has(sessionId.current)) { setError(msg("Wait for the current reply to finish.")); flashOutcome("error"); return; }
    const assistantId = crypto.randomUUID();
    const continued = sessionId.current;
    if (continued) notePanelTurns.add(continued);
    sending.current = true;
    // 履歴の一覧を開いたまま送ったら、会話の表示へ戻す（送った発言と回答が見えるように）。
    setHistoryOpen(false);
    setActiveTurnAssistantId(assistantId);
    setBusy(true);
    setError("");
    setNotice("");
    flashOutcome(null);
    if (!(await flush())) {
      setError(msg("Resolve the note's unsaved changes first, then ask again."));
      setActiveTurnAssistantId(null);
      flashOutcome("error");
      if (continued) notePanelTurns.delete(continued);
      sending.current = false;
      setBusy(false);
      return;
    }

    // 選区画像（D5）：画像対応モデルのときだけ PNG を作って標準のアップロード経路に乗せる。
    // 非画像モデルでは呼ばず、キャプチャやアップロードに失敗しても送信を止めず文字だけで続行する。
    // キャプチャ中も入力欄をロック（uploadProgress）し、送信待ちの間に入力した文字が消えないようにする。
    let selectionUpload: UploadFile | null = null;
    const releaseSelectionPreview = () => {
      if (!selectionUpload?.previewUrl) return;
      previewUrlsRef.current.delete(selectionUpload.previewUrl);
      URL.revokeObjectURL(selectionUpload.previewUrl);
    };
    const willCapture = Boolean(activeCapture && modelOption.supportsImageInput);
    let tickets: string[] = [];
    try {
      if (willCapture || rawFiles.length) setUploadProgress({ key: msg("Preparing attachments…") });
      if (willCapture && activeCapture) {
        try {
          const blob = await activeCapture();
          if (blob && blob.size > 0) {
            const imageFile = new File([blob], "selection.png", { type: "image/png" });
            const candidateFiles = [...rawFiles, imageFile];
            const selectionProblem = getUploadValidationError(candidateFiles, uploadOptions, t) || getUploadRequestError(candidateFiles, payloadText, t);
            if (!selectionProblem) {
              selectionUpload = createUploadFile(imageFile);
              if (selectionUpload.previewUrl) previewUrlsRef.current.add(selectionUpload.previewUrl);
            } else {
              setNotice(msg("Sent text only this time."));
            }
          } else {
            setNotice(msg("Sent text only this time."));
          }
        } catch {
          setNotice(msg("Sent text only this time."));
        }
      }
      if (rawFiles.length || selectionUpload) {
        const uploaded = await uploadChatFilesWithSelection(rawFiles, selectionUpload?.file ?? null, (name, index, total, percentage) => {
          setUploadProgress({ key: msg("Uploading {index}/{total} · {name} · {percentage}%"), vars: { index, total, name, percentage } });
        });
        tickets = uploaded.tickets;
        if (uploaded.selectionDropped && selectionUpload) {
          releaseSelectionPreview();
          selectionUpload = null;
          setNotice(msg("Sent text only this time."));
        }
      }
    } catch (caught) {
      releaseSelectionPreview();
      if (caught instanceof StorageLimitError) showStorageLimit(caught, { inline: true });
      else setError(caught instanceof Error ? caught.message : msg("Attachment upload failed. Please try again."));
      setActiveTurnAssistantId(null);
      flashOutcome("error");
      if (continued) notePanelTurns.delete(continued);
      sending.current = false;
      setBusy(false);
      return;
    } finally {
      setUploadProgress(null);
    }
    stick.current = true;

    const allSentFiles = selectionUpload ? [...sentFiles, selectionUpload] : sentFiles;
    const userMessageId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: userMessageId, role: "USER", content: displayText,
        attachments: allSentFiles.map(({ id, file, previewUrl }) => ({ id, filename: file.name, mimeType: file.type || "application/octet-stream", size: file.size, previewUrl })),
        ...(sentPages.length ? { pages: sentPages } : {}),
      },
      { id: assistantId, role: "ASSISTANT", content: "" },
    ]);
    // 定型ボタン（display あり）で送ったときは、入力欄に書きかけの本文を残す。送信待ちの間に書き足した文字があれば残す。
    if (display === undefined) {
      setInput((current) => (current === text ? "" : current.startsWith(text) ? current.slice(text.length).trimStart() : current));
    }
    setSeconds(0);
    setStreaming(true);
    const body = new FormData();
    body.append("message", payloadText);
    body.append("model", model);
    body.append("reasoning", reasoning);
    body.append("webSearch", "off");
    body.append("noteId", noteId);
    if (activeSelection || activeIds.length) body.append("noteSelection", "1");
    if (activeIds.length) body.append("selectionIds", JSON.stringify(activeIds));
    if (autoApplyOn) body.append("autoApply", "1");
    if (sessionId.current) body.append("sessionId", sessionId.current);
    if (tickets.length) body.append("uploads", JSON.stringify(tickets));
    if (sentPages.length) body.append("pages", JSON.stringify(sentPages.map((page) => page.id)));

    // サーバーが発言を受け付けたか。受け付ける前に断られたら、添付は入力欄に残し、上げたファイルは片付ける。
    let accepted = false;
    let savedId = "";
    try {
      const { streamFailed } = await streamChat(
        body,
        (id) => {
          sessionId.current = id;
          setChatId(id);
          savedId = id;
          notePanelTurns.add(id);
          accepted = true;
          guestLimitHitRef.current = false;
          savePendingDraft(`note:${noteId}`, "", { persistent: embedded });
          if (activeSelection || activeIds.length) onClearSelection?.(submittedSelection);
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
      const storageRefused = caught instanceof StorageLimitError;
      const limited = caught instanceof UsageLimitError || storageRefused;
      if (!accepted) {
        if (tickets.length) void cleanupClientUploads(tickets);
        releaseSelectionPreview();
      }
      if (storageRefused) showStorageLimit(caught);
      if (caught instanceof UsageLimitError) showUsageLimit(caught);
      // 上限で断られた本文は保存されていない。入力欄から送ったものなら戻す（待つ間に書き足した文は後ろに残す）。
      // 待つ間に別のノートへ移っていたら、入力欄の代わりにこのノートの分として預けておく。
      if (limited && display === undefined && !composerMountedRef.current) {
        keepRejectedDraft(`note:${noteId}`, activeSelection ? payloadText : text, { persistent: embedded });
      }
      if (limited && display === undefined) {
        const nextInput = inputValueRef.current.trim() ? [text.trimEnd(), inputValueRef.current].join("\n\n") : text;
        if (embedded && guestLimitHitRef.current) {
          savePendingDraft(`note:${noteId}`, activeSelection ? composeQuotedMessage(activeSelection, nextInput) : nextInput, { persistent: true });
        }
        setInput((current) => (current.trim() ? [text.trimEnd(), current].join("\n\n") : text));
      }
      // すでに届いた本文は残し、上限・失敗の文だけを表示時に訳す。
      // 断られた添付は入力欄に戻り、プレビューの URL は入力欄が持つ（外すと解放される）。送った発言からは外す。
      // 未受付で片付けた選区自動スクリーンショットも、解放済み blob URL が残らないよう発言から外す。
      const droppedSelectionId = !accepted ? selectionUpload?.id : undefined;
      setMessages((current) => current.map((message) => message.id === userMessageId && (limited || droppedSelectionId)
        ? {
          ...message,
          attachments: message.attachments
            ?.filter((attachment) => attachment.id !== droppedSelectionId)
            .map((attachment) => {
              if (!limited) return attachment;
              const { previewUrl: _previewUrl, ...rest } = attachment;
              void _previewUrl;
              return rest;
            }),
        }
        : message.id === assistantId
        ? { ...message, content: limited ? detail : message.content ? `${message.content}\n\n${failureText(detail)}` : failureText(detail),
          failed: true, usageLimit: caught instanceof UsageLimitError ? caught.kind : undefined, storageLimit: storageRefused || undefined,
          activity: limited ? message.activity : applyActivityEvent(message.activity ?? [], { type: "failure", id: "request-failure", offset: message.content ? message.content.length + 2 : 0, detail }) }
        : message));
    } finally {
      setStreaming(false);
      sending.current = false;
      setBusy(false);
      if (continued) notePanelTurns.delete(continued);
      if (savedId) notePanelTurns.delete(savedId);
      // 会話ができた・進んだので、パネルの履歴と Chats の一覧を合わせる（題名は回答のあとに付く）。
      if (accepted) {
        void loadChats();
        window.dispatchEvent(new CustomEvent(NOTE_CHAT_SAVED_EVENT, { detail: { id: savedId } }));
      }
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

  const chatTitle = chats?.find((chat) => chat.id === chatId)?.title;
  const relative = new Intl.RelativeTimeFormat(tag, { numeric: "auto" });

  const panel = (
    <div ref={attach} className={`note-ai-panel ${phone ? "is-sheet" : ""}`} style={panelStyle} role="dialog" aria-modal={phone || undefined} aria-label={t(kindText.title)}>
      {phone && <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>}
      <header className="note-ai-header">
        <AppIcon size={24} state={replyCharacterState} animated={replyCharacterState !== "idle" && replyCharacterState !== "hidden"} />
        <span className="note-ai-title" title={noteTitle}>{chatTitle || t(kindText.title)}</span>
        {/* 「自動適用」：入れると AI の編集案をすぐ適用する（ページの履歴に残り、カードから元に戻せる）。 */}
        {editable && <button type="button" className={`notion-icon-button grid note-ai-auto ${autoApplyOn ? "is-active" : ""}`} aria-pressed={autoApplyOn}
          aria-label={t("Auto-apply")} title={autoApplyOn ? t("Auto-apply is on: AI changes are applied right away. You can undo them.") : t("Auto-apply AI changes (you can undo them)")}
          onClick={() => { const next = !autoApplyOn; setAutoApply(next); saveAutoApply(pageKind, next); }}><Zap size={16} /></button>}
        <button type="button" className={`notion-icon-button grid ${historyOpen ? "is-active" : ""}`} aria-label={t(kindText.history)} title={t(kindText.history)} aria-pressed={historyOpen}
          onClick={() => { if (!historyOpen) { setHistoryOpenedAt(Date.now()); void loadChats(); } setHistoryOpen(!historyOpen); }}><History size={16} /></button>
        <button type="button" className="notion-icon-button grid" disabled={busy || (!chatId && messages.length === 0 && !historyOpen && !loadingChat)} aria-label={t("New chat")} title={t("New chat")} onClick={newChat}><SquarePen size={16} /></button>
        <button type="button" className="notion-icon-button grid" onClick={close} aria-label={t("Close")}><X size={16} /></button>
      </header>

      {historyOpen ? (
        <div className="note-ai-list note-ai-history">
          <p className="note-ai-history-heading">{t(kindText.history)}</p>
          {!chats ? <p className="note-ai-history-empty" role="status">{t(chatsFailed ? "Could not load the history." : "Loading…")}</p>
            : chats.length === 0 ? <p className="note-ai-history-empty">{t("No chats")}</p> : (
            <ul>
              {chats.map((chat) => (
                <li key={chat.id}>
                  <button type="button" className={`note-ai-history-item ${chat.id === chatId ? "is-current" : ""}`} disabled={busy} aria-current={chat.id === chatId || undefined}
                    onClick={() => (chat.id === chatId ? setHistoryOpen(false) : void openChat(chat.id))}>
                    <span className="note-ai-history-title">{chat.title}</span>
                    <span className="note-ai-history-time">{relativeTime(chat.updatedAt, Math.max(historyOpenedAt, Date.parse(chat.updatedAt) || 0), relative)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
      <div ref={listRef} className="note-ai-list" onScroll={onListScroll}>
        {loadingChat ? <p className="note-ai-history-empty" role="status">{t("Loading…")}</p> : messages.length === 0 ? (
          <div className="note-ai-empty">
            <p>{!editable ? t(kindText.readOnly)
              : autoApplyOn ? t("Tell the AI how to change this page. Its changes are applied right away, and you can undo them.")
              : pageKind === "note" ? t("Tell the AI how to change this note. You review its proposal before anything changes.")
              : t("Tell the AI how to change this page. You review its proposal before anything changes.")}</p>
            {/* 範囲を選んでいる間は、範囲用のボタン（入力欄の上）だけを出す。 */}
            {!hasSelection && <div className="note-ai-chips">
              {actions.map((action) => (
                <button key={action.label} type="button" className="note-ai-chip" disabled={busy || loadingChat} onClick={() => void send(action.prompt, t(action.label))}>{t(action.label)}</button>
              ))}
            </div>}
          </div>
        ) : <ProposalHostContext.Provider value={proposalHost}>{messages.map((message) => (
          <ChatMessage key={message.renderKey ?? message.id} message={message} isStreaming={streaming && message.id === activeTurnAssistantId} thinkingSeconds={seconds}
            characterState={message.id === activeTurnAssistantId ? replyCharacterState : undefined} characterSize={24} />
        ))}</ProposalHostContext.Provider>}
      </div>
      )}

      {upgradeLimit && <UpgradePrompt kind="chat" onClose={() => setUpgradeLimit(false)} attachmentsLost={files.length > 0 || attachedPages.length > 0}
        onBeforeUpgrade={() => savePendingDraft(`note:${noteId}`, draftToKeep(input))} />}
      {storageLimit && <StorageLimitPrompt limit={storageLimit} actions={!embedded} onClose={() => setStorageLimit(null)} attachmentsLost={files.length > 0 || attachedPages.length > 0}
        onBeforeSignIn={() => savePendingDraft(`note:${noteId}`, draftToKeep(input))} onBeforeUpgrade={() => savePendingDraft(`note:${noteId}`, draftToKeep(input))} />}
      {guestLimit && <GuestLimitPrompt kind="chat" onClose={() => setGuestLimit(false)} attachmentsLost={files.length > 0 || attachedPages.length > 0}
        onBeforeSignIn={() => savePendingDraft(`note:${noteId}`, draftToKeep(input))} />}
      {(uploadError || error) && <p className="note-ai-error" role="alert">{uploadError || t(error)}</p>}
      {notice && !uploadError && !error && <p className="note-ai-notice" role="status">{t(notice)}</p>}
      {/* チャットの入力欄と同じ理由で、ページ翻訳の対象から外す（書き換えられると React の更新が失敗する）。 */}
      <form className="note-ai-form" onSubmit={submit} translate="no">
        {hasSelection && (
          <div className="note-ai-selection">
            <div className="chat-quote note-ai-quote" role="group" aria-label={selectionText ? t("Selected text") : t("Selected items")}>
              <Sparkles size={13} className="note-ai-quote-icon" aria-hidden="true" />
              <span className="chat-quote-text">{selectionText || t("{count} items selected", { count: selectionIds.length })}</span>
              {Boolean(selection?.captureImage && modelOption.supportsImageInput) && (
                <ImageIcon size={13} className="note-ai-quote-vision" aria-hidden="true" />
              )}
              <button type="button" className="chat-quote-remove" disabled={busy} onClick={() => { setNotice(""); onClearSelection?.(); }}
                aria-label={t("Remove selection")} title={t("Remove selection")}>
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <div className="note-ai-chips note-ai-selection-chips">
              {pickedActions.map((action) => (
                <button key={action.label} type="button" className="note-ai-chip is-compact" disabled={busy || loadingChat}
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
                  {page.icon ? <span aria-hidden="true"><NoteIcon icon={page.icon} /></span> : <PageKindIcon kind={page.kind} size={13} aria-hidden="true" />}
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
            placeholder={t(kindText.placeholder)} aria-label={t("Instruction for the AI")} className="note-ai-input" />
          <div className="note-ai-tools">
            <AttachMenu className="relative" backToClose={phone} disabled={busy} onFilesChange={(event) => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }}
              onAttachPages={() => setPageDialogOpen(true)} />
            {onModelChange && onReasoningChange && <ModelSelect value={model} reasoning={reasoning} onModelChange={onModelChange} onReasoningChange={onReasoningChange} />}
            <button type="submit" className="note-ai-send" disabled={busy || loadingChat || !input.trim() || Boolean(uploadError)} aria-label={t("Send")}><ArrowUp size={16} /></button>
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
      <button ref={fabRef} type="button" className={`note-ai-fab ${open ? "is-open" : ""} ${!open && hasSelection ? "has-selection" : ""} ${dragging ? "is-dragging" : ""} ${anchored ? "is-anchored" : ""}`}
        style={fab ? { right: fab.right, bottom: fab.bottom } : undefined}
        onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerEnd} onPointerCancel={onFabPointerEnd}
        onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setOpen((current) => !current); }}
        aria-label={t(kindText.title)} aria-expanded={open} title={t("Ask NoteFable")}>
        <AppIcon size={phone ? 42 : 40} state={noteCharacterState} animated />
        {!open && hasSelection && (
          <span className="note-ai-fab-badge" aria-hidden="true">
            {selectionIds.length > 0 ? selectionIds.length : <Sparkles size={10} />}
          </span>
        )}
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
