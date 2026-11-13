"use client";

import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  FileText,
  History,
  ImagePlus,
  Menu,
  Paperclip,
  PanelLeft,
  Plus,
  Search,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { ChatProject } from "@/components/chat-actions";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatTitleIcon, ChatTopbarIcon } from "@/components/chat-icon";
import { ChatMessage } from "@/components/chat-message";
import { EmptyConversation } from "@/components/empty-conversation";
import { GuestLimitPrompt } from "@/components/guest-limit-prompt";
import { AttachSheet } from "@/components/attach-sheet";
import { ModelSelect } from "@/components/model-controls";
import { NoteHistoryDialog } from "@/components/note-history-dialog";
import { NotesSidebar } from "@/components/notes-sidebar";
import { SearchDialog, useSearchShortcut } from "@/components/search-dialog";
import type { WorkspaceView } from "@/components/workspace-nav";
import { NotesWorkspace } from "@/components/notes-workspace";
import { useNotePages } from "@/lib/use-note-pages";
import { applyActivityEvent, type ActivityEvent } from "@/lib/chat-activity";
import { ATTACHMENT_ACCEPT, formatUploadSize, getClipboardImageFiles, getUploadRequestError, getUploadSelectionError, getUploadValidationError, isImageMimeType } from "@/lib/client-files";
import { MAX_UPLOAD_FILES } from "@/lib/upload-limits";
import { cleanupClientUploads, uploadChatFiles } from "@/lib/client-chat-upload";
import type { ReorderRequest } from "@/lib/list-order";
import { ChatProjectSync, SessionOrganizationSync } from "@/lib/session-organization-sync";
import { SessionIconSync } from "@/lib/session-icon-sync";
import { parseChatStreamLine } from "@/lib/chat-stream";
import { useSwipeDismiss } from "@/lib/use-swipe-dismiss";
import { runTransition } from "@/lib/view-transition";
import { DEFAULT_MODEL, getModelOption } from "@/lib/models";
import { revealChatMessage, revealNoteBlock } from "@/lib/search-reveal";
import { getSubmissionValidationError } from "@/lib/submission-validation";
import { restoreSheetMarker, useBackToClose } from "@/lib/use-back-to-close";
import { useMediaQuery } from "@/lib/use-media-query";
import { UsageLimitError, usageLimitErrorFrom, type UsageKind } from "@/lib/usage-plans";
import { savePendingDraft, takePendingDraft, useKeepDraftOnLeave } from "@/lib/pending-draft";
import type { ImageGenerationResult, Message, Session, UploadFile } from "@/types/chat";
import { useT } from "@/components/i18n-provider";
import { localizeSystemText, msg, type Translate, type TranslateVars } from "@/lib/i18n/translate";
import { failureText } from "@/lib/failure-text";

const INPUT_RESTORE_GUARD_MS = 5000;
const NEW_SESSION_MESSAGES_KEY = "__new_session__";
// 検索結果などから開いたあと、その場所まで動かすための予約。開き終わる前に別の操作をされたら捨てる。
const REVEAL_TTL_MS = 10000;
// 会話・メッセージへのリンク（?chat= / &message=）の ID の形。DB の ID は英数字だけ。
const LINK_ID = /^[\w-]{1,64}$/;
type ErrorText = string | ((t: Translate) => string);
type UploadProgress = string | { key: string; vars: TranslateVars };
type RevealTarget =
  | { kind: "chat"; sessionId: string; messageId: string }
  | { kind: "note"; noteId: string; blockId: string };
type RevealRequest = RevealTarget & { expires: number };

function getMessagesKey(sessionId: string | null) {
  return sessionId ?? NEW_SESSION_MESSAGES_KEY;
}

function createUploadFile(file: File): UploadFile {
  // ブラウザが MIME type を返さないファイルもあるため、未設定時は汎用バイナリとして扱う。
  const mimeType = file.type || "application/octet-stream";

  return {
    // React の key や削除対象の識別に使う、画面内だけの一時 ID。
    id: crypto.randomUUID(),
    // 送信時に FormData へ詰める元の File オブジェクト。
    file,
    // 画像だけは送信前にサムネイル表示できるよう object URL を作る。
    previewUrl: isImageMimeType(mimeType) ? URL.createObjectURL(file) : undefined,
  };
}

function revokeUploadPreviews(files: UploadFile[]) {
  // 画像プレビュー用の object URL はブラウザのメモリを保持する。
  // 送信完了・削除・画面破棄のタイミングで明示的に解放し、長時間利用時のメモリ増加を抑える。
  for (const file of files) {
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
}

function stripAttachmentPreviewUrls(message: Message): Message {
  // previewUrl は送信直後の楽観表示だけで使うローカル URL。
  // サーバーから再取得した履歴には API 経由の dataUrl が入るため、古い previewUrl を残さない。
  if (!message.attachments?.some((attachment) => attachment.previewUrl)) {
    return message;
  }

  return {
    ...message,
    attachments: message.attachments.map(({ previewUrl: _previewUrl, ...attachment }) => {
      void _previewUrl;
      return attachment;
    }),
  };
}

async function saveSessionIcon(sessionId: string, icon: string | null) {
  try {
    const response = await fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ icon }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

// 会話アイコンの保存と一覧の再取得を突き合わせる。画面の状態を持たないので、ページ全体で 1 つを使う。
const iconSync = new SessionIconSync(saveSessionIcon);

async function readJsonObject(response: Response) {
  // API 側が落ちた時に空 body や HTML が返っても、画面全体を unhandled rejection で壊さない。
  const text = await response.text();
  if (!text) return {};

  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readErrorMessage(data: Record<string, unknown>, fallback: string) {
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

// 一覧を出すのは「スマホ幅・Notes・URL に page= が無い」とき。
function computeNotesList() {
  const params = new URL(window.location.href).searchParams;
  return window.matchMedia("(max-width: 639px)").matches && params.get("view") === "pages" && !params.get("page");
}

export default function Home() {
  const t = useT();
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const notes = useNotePages(workspaceView === "pages");
  // スマホで Notes を開いたとき、ノートが選ばれていない間は一覧（NotesHome）を出す。URL に page= が無いことと対応させる。
  const [notesList, setNotesList] = useState(false);

  // 一覧を出すのは「スマホ幅・Notes・URL に page= が無い」とき。URL が変わる操作のあとにここで合わせ直す。
  function syncNotesList() {
    setNotesList(computeNotesList());
  }
  // 検索の小窓（Ctrl/Cmd+K）。履歴の小窓は、開いた時点のノート ID を持ち、別のノートに移ったら出さない。
  const [searchOpen, setSearchOpen] = useState(false);
  const [historyNoteId, setHistoryNoteId] = useState<string | null>(null);
  useSearchShortcut(() => setSearchOpen(true));
  // 検索結果から開いたブロック・メッセージまで動かす予約と、待っている動かす処理の中止用。
  const revealRef = useRef<RevealRequest | null>(null);
  const revealAbortRef = useRef<AbortController | null>(null);
  const [revealTick, setRevealTick] = useState(0);
  const notesRef = useRef(notes);
  // 戻る操作で画面が変わるかを見分けて、変わるときだけ動きをつけるために、いまの表示を覚えておく。
  const shownRef = useRef({ view: workspaceView, list: notesList });
  useEffect(() => {
    notesRef.current = notes;
    shownRef.current = { view: workspaceView, list: notesList };
  });

  useEffect(() => {
    function syncWorkspace(animate: boolean) {
      const params = new URL(window.location.href).searchParams;
      const view: WorkspaceView = params.get("view") === "pages" ? "pages" : "chat";
      const list = computeNotesList();
      const apply = () => {
        setWorkspaceView(view);
        setNotesList(list);
      };
      // 端末の「戻る」でノートから一覧へ戻るときなど、画面が変わるときだけ動かす（シートを閉じるだけの戻るでは何もしない）。
      if (animate && (view !== shownRef.current.view || list !== shownRef.current.list)) runTransition(apply, "back");
      else runTransition(apply, "back", false);
    }
    const onPopState = () => syncWorkspace(true);
    queueMicrotask(() => syncWorkspace(false));
    window.addEventListener("popstate", onPopState);

    // 画面を回して幅が変わったら一覧モードを合わせ直す。パソコン幅へ広がったときは、開いているノートが無ければ先頭を開く。
    const phone = window.matchMedia("(max-width: 639px)");
    function onWidthChange() {
      syncNotesList();
      const current = notesRef.current;
      if (!phone.matches && !current.activeId && current.pages[0]) void current.select(current.pages[0].id, "replace");
    }
    phone.addEventListener("change", onWidthChange);
    return () => {
      window.removeEventListener("popstate", onPopState);
      phone.removeEventListener("change", onWidthChange);
    };
  }, []);

  function changeWorkspace(view: WorkspaceView) {
    const url = new URL(window.location.href);
    if (view === (url.searchParams.get("view") === "pages" ? "pages" : "chat")) return;
    cancelReveal();
    let list = false;
    if (view === "pages") {
      url.searchParams.set("view", "pages");
      const phone = window.matchMedia("(max-width: 639px)").matches;
      if (phone) url.searchParams.delete("page");
      else if (notes.activeId) url.searchParams.set("page", notes.activeId);
      list = phone;
    }
    else url.searchParams.delete("view");
    // ドロワーは切り替えの動きの外で閉じる。動きの中（runTransition の更新）に入れると、直後の別の画面更新で
    // その更新ごと取り消されたとき、透明になったドロワーが開いたまま画面を覆い、次のタップで履歴を戻してしまう。
    setSidebarOpen(false);
    // Chat ⇄ Note は、同じ場所でふわっと入れ替える。
    runTransition(() => {
      setWorkspaceView(view);
      if (view === "pages") setNotesList(list);
    }, "fade");
    // モバイルのドロワーが履歴に積んだ目印がある場合は、その履歴を置き換えて、戻る操作で空振りする履歴を残さない。
    if (window.history.state?.studymateSheet) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    restoreSheetMarker();
    if (view === "chat") void notes.active?.flush();
  }

  function openNote(id: string) {
    cancelReveal();
    if (!window.matchMedia("(max-width: 639px)").matches) {
      void notes.select(id);
      return;
    }
    // スマホ：一覧から開くとき、戻るで一覧へ戻れるよう page= 付きの履歴を 1 件積んでから読み込む。
    // ドロワーや底部シートが積んだ履歴の上なら、新しく積まずその履歴を置き換える（空の戻り先を残さない）。
    const url = new URL(window.location.href);
    if (url.searchParams.get("page") !== id) {
      url.searchParams.set("page", id);
      if (window.history.state?.studymateSheet) window.history.replaceState(null, "", url);
      else window.history.pushState(null, "", url);
      restoreSheetMarker();
    }
    // 一覧からノートへは、右から入ってくる動き。
    runTransition(() => setNotesList(false), "forward");
    if (notes.activeId !== id) void notes.select(id, "none");
  }

  async function deleteNote(id: string) {
    await notes.remove(id);
    // 参照ノートに選ばれていたノートがゴミ箱へ入ると、プロジェクトの参照ノート数が変わる。
    refreshChatProjects();
    // スマホで開いていたノートを消したら、URL から page= が外れているので一覧に戻る。
    runTransition(syncNotesList, "back");
  }

  function createNote() {
    cancelReveal();
    runTransition(() => setNotesList(false), "forward");
    void notes.create();
  }

  // 動かす予約を取り消す。別の会話・ノートを開いたときに、前の予約が後から効かないようにする。
  function cancelReveal() {
    revealRef.current = null;
    revealAbortRef.current?.abort();
    revealAbortRef.current = null;
  }

  function queueReveal(target: RevealTarget) {
    revealRef.current = { ...target, expires: Date.now() + REVEAL_TTL_MS };
    setRevealTick((value) => value + 1);
  }

  // 検索結果・プロジェクトの参照元から、Chat と Notes のどちらにいても指定のノートを開く。blockId があればそのブロックまで動かす。
  function openNoteFromLink(id: string, blockId?: string) {
    cancelReveal();
    const url = new URL(window.location.href);
    url.searchParams.set("view", "pages");
    url.searchParams.set("page", id);
    // 小窓（検索・ドロワー）が積んだ目印があれば置き換え、無ければ URL が変わるときだけ積む。戻る操作で空振りする履歴を残さない。
    if (window.history.state?.studymateSheet) window.history.replaceState(null, "", url);
    else if (url.href !== window.location.href) window.history.pushState(null, "", url);
    restoreSheetMarker();
    // ドロワーは動きの外で閉じる（changeWorkspace と同じ理由）。
    setSidebarOpen(false);
    const show = () => {
      setWorkspaceView("pages");
      setNotesList(false);
    };
    if (workspaceView !== "pages") runTransition(show, "fade");
    else if (notesList) runTransition(show, "forward");
    else show();
    // 初回の Notes は、画面が切り替わったあとの一覧取得が URL の page= を見て開く。すでに開いているノートは取り直さない。
    if (notes.activeId !== id) {
      void notes.select(id, "none").then((opened) => {
        if (opened) return;
        // 開けなかった（別のタブでゴミ箱に入った・削除された）ノートの指定は、URL に残さない。
        cancelReveal();
        const next = new URL(window.location.href);
        if (next.searchParams.get("page") === id) {
          next.searchParams.delete("page");
          window.history.replaceState(null, "", next);
        }
        syncNotesList();
      });
    }
    if (blockId) queueReveal({ kind: "note", noteId: id, blockId });
  }

  // 検索結果・プロジェクトの参照元から会話を開く。messageId があれば、読み込み後にそのメッセージまで動かす。
  async function openChatFromLink(id: string, messageId?: string) {
    if (workspaceView !== "chat") changeWorkspace("chat");
    const loading = loadMessages(id);
    // 末尾へ寄せる処理（会話を開いた直後の固定）が、一致したメッセージへの移動を打ち消さないようにする。
    if (messageId) pinToBottomRef.current = null;
    await loading;
    if (!messageId || activeSessionIdRef.current !== id) return;
    pinToBottomRef.current = null;
    queueReveal({ kind: "chat", sessionId: id, messageId });
  }

  function openNotesList() {
    const url = new URL(window.location.href);
    url.searchParams.delete("page");
    // シートが積んだ目印が一番上にあるときは置き換えて、戻る操作で空振りする履歴を残さない。
    if (window.history.state?.studymateSheet) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    restoreSheetMarker();
    // ノートから一覧へは、左へ戻る動き。
    runTransition(() => setNotesList(true), "back");
  }

  // 左サイドバーに表示するチャットセッション一覧。
  const organizationSync = useRef(new SessionOrganizationSync());
  const projectSync = useRef(new ChatProjectSync());
  const [sessions, setSessions] = useState<Session[]>([]);
  const [chatProjects, setChatProjects] = useState<ChatProject[]>([]);
  const [chatProjectError, setChatProjectError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const started=projectSync.current.mark();
    void fetch("/api/chat-projects", {signal:controller.signal,cache:"no-store"}).then(async response=>{
      if (!response.ok) throw new Error();
      const data=await response.json(); setChatProjects(projectSync.current.reconcile(data.projects,started));
    }).catch(()=>{if(!controller.signal.aborted) setChatProjectError(msg("Could not load projects. Refresh to retry."));});
    return ()=>controller.abort();
  }, []);
  // 一覧の件数だけを取り直す（ノートをゴミ箱へ入れた・戻したあと用）。失敗しても今の表示は変えない。
  function refreshChatProjects() {
    const started = projectSync.current.mark();
    void fetch("/api/chat-projects", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.projects)) setChatProjects(projectSync.current.reconcile(data.projects, started));
    }).catch(() => {});
  }
  // まだ会話が保存されていない新規チャットで先に選んだアイコン。最初の送信で会話を作るときに一緒に保存する。
  const [draftIcon, setDraftIcon] = useState<string | null>(null);
  const draftIconRef = useRef<string | null>(null);
  // 別の会話を開くたびに進める。最初の送信の途中で移動したかを見分ける。
  const draftEpochRef = useRef(0);
  const changeDraftIcon = (icon: string | null) => {
    draftIconRef.current = icon;
    setDraftIcon(icon);
  };
  // 現在表示しているセッション ID。未保存の新規チャットでは null になる。
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // 画面中央に表示する会話メッセージ。送信直後の楽観表示もここに入る。
  const [messages, setMessages] = useState<Message[]>([]);
  // 入力欄のテキスト。送信時に trim して API へ渡す。
  const [input, setInput] = useState("");
  // 送信前のセッション作成など、会話に紐づかない失敗を入力欄の近くに出す。
  // エラーは英語か API の原文で保持する。複数の値のある添付校正は、値を分け直さず今の t で描く関数を保持する。
  const [sendError, setSendError] = useState<ErrorText>("");
  // 未ログインで上限に達したとき、入力欄の上に閉じられるログイン案内を出す。
  const [guestLimit, setGuestLimit] = useState<UsageKind | null>(null);
  // 一度でも未ログインの上限に達したら、以後ページを離れるとき（サイドバーからのログインも含む）入力欄の本文を預ける。
  const guestLimitHitRef = useRef(false);
  useKeepDraftOnLeave("chat", () => (guestLimitHitRef.current ? inputRef.current?.value ?? "" : null));
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  // 現在選択中のモデル ID。API へそのまま渡し、サーバー側で再検証する。
  const [model, setModel] = useState(DEFAULT_MODEL);
  // 推論強度の UI 選択値。モデルごとに選べる値が違うため、changeModel で補正する。
  const [reasoning, setReasoning] = useState("medium");
  // 通常チャットではなく画像生成 API へ送るかどうかを表す。
  const [imageGenerationMode, setImageGenerationMode] = useState(false);
  const [attachSheetOpen, setAttachSheetOpen] = useState(false);
  // 送信前に選択されている添付ファイル。画像の場合は previewUrl も持つ。
  const [files, setFiles] = useState<UploadFile[]>([]);
  // 会話ごとのストリーム開始時刻。複数会話を並行生成できるよう、会話キー別に持つ。
  const [streamingSessions, setStreamingSessions] = useState<Record<string, number>>({});
  // 経過秒数を再計算するための現在時刻。ストリーミング中だけ interval で更新する。
  const [now, setNow] = useState(() => Date.now());
  // モバイル表示でサイドバーのオーバーレイを開いているかどうか。
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // モバイルのドロワーを開いている間は履歴を 1 件積み、端末の「戻る」でアプリを閉じずにドロワーだけ閉じる。
  // ドロワーの上にアイコン選択などが重なっているときは、先にそちらが閉じる（共通のフックが一番上だけを閉じる）。
  useBackToClose(sidebarOpen, () => setSidebarOpen(false));
  // ドロワーは、左へ指で引いて閉じられる。
  const { attach: attachDrawer, bind: drawerBind } = useSwipeDismiss<HTMLDivElement>({ axis: "x", direction: -1, onDismiss: () => setSidebarOpen(false) });
  useEffect(() => {
    if (!sidebarOpen) return;
    // 画面を広げてデスクトップ表示になったら、見えなくなったドロワーの履歴が残らないよう閉じる。
    const desktop = window.matchMedia("(min-width: 1024px)");
    function onResize() {
      if (desktop.matches) setSidebarOpen(false);
    }
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, [sidebarOpen]);
  // デスクトップ表示でサイドバー自体を表示するかどうか。
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // 最下部にいる時は手動スクロールボタンを隠す。
  const [isAtChatBottom, setIsAtChatBottom] = useState(true);
  // 会話本文のスクロール領域。手動で最下部へ移動するボタンだけで使う。
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  // 会話を開いた直後は、履歴の高さが落ち着くまで最下部に固定する（読み込み・画像・Markdown の描画で高さが変わるため）。
  const pinToBottomRef = useRef<{ key: string; until: number } | null>(null);
  // ストリーム処理中の古いクロージャを避けるため、現在のセッション ID を ref にも保持する。
  const activeSessionIdRef = useRef<string | null>(null);
  // 会話切り替えの順序を追跡し、遅れて返った古いレスポンスを無視する。
  const sessionNavigationIntentRef = useRef(0);
  // 新しい会話を選んだ時に、直前の履歴取得を中断する。
  const sessionLoadAbortRef = useRef<AbortController | null>(null);
  // 会話ごとの表示中メッセージ。ストリーミング中に別会話へ移動しても一時表示を失わない。
  const sessionMessagesRef = useRef<Record<string, Message[]>>({});
  // 会話ごとの生成状態。切り替え時にDB履歴で上書きしないために使う。
  const streamingSessionsRef = useRef<Record<string, number>>({});
  // アンマウント時のクリーンアップで最新の添付一覧を参照するための ref。
  const filesRef = useRef<UploadFile[]>([]);
  // 送信直後の古い入力イベントで本文が戻らないよう、DOM 側も直接空にする。
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // state 更新前に連続 submit が入っても、同じ会話へ二重送信しない。
  const submittingSessionKeysRef = useRef<Set<string>>(new Set());
  // 送信直後に遅れて届いた古い input/change イベントだけを捨てる。
  const submittedInputRestoreGuardRef = useRef<{
    value: string;
    expiresAt: number;
  } | null>(null);

  const activeSessionKey = getMessagesKey(activeSessionId);
  const activeStreamStartedAt = streamingSessions[activeSessionKey] ?? null;
  const isActiveSessionStreaming = activeStreamStartedAt !== null;
  const selectedModel = getModelOption(model);
  // 送信可能条件。空文字と現在会話のストリーミング中は送信ボタンを無効にする。
  const uploadOptions = {
    supportsImages: imageGenerationMode || selectedModel.supportsImageInput,
    claudeImages: !imageGenerationMode && selectedModel.provider === "anthropic",
  };
  const uploadError = getUploadValidationError(files.map(({ file }) => file), uploadOptions, t);
  const canSend = input.trim().length > 0 && !isActiveSessionStreaming && !uploadError && !uploadProgress;
  // 狭い画面（スマホ）では、提示文が折り返して切れないよう短くする。
  const isNarrowScreen = useMediaQuery("(max-width: 639px)");
  const inputPlaceholder = imageGenerationMode
    ? t("Describe an image to create...")
    : isNarrowScreen
      ? t("Ask anything...")
      : t("Ask anything — StudyMate searches when needed...");

  function replaceCachedMessages(sessionKey: string, nextMessages: Message[]) {
    sessionMessagesRef.current = {
      ...sessionMessagesRef.current,
      [sessionKey]: nextMessages,
    };

    if (getMessagesKey(activeSessionIdRef.current) === sessionKey) {
      setMessages(nextMessages);
    }
  }

  function updateCachedMessages(
    sessionKey: string,
    updater: (current: Message[]) => Message[],
  ) {
    replaceCachedMessages(
      sessionKey,
      updater(sessionMessagesRef.current[sessionKey] ?? []),
    );
  }

  function startStreamingSession(sessionKey: string, startedAt: number) {
    const nextStreamingSessions = {
      ...streamingSessionsRef.current,
      [sessionKey]: startedAt,
    };
    streamingSessionsRef.current = nextStreamingSessions;
    setStreamingSessions(nextStreamingSessions);
  }

  function finishStreamingSession(sessionKey: string) {
    if (!streamingSessionsRef.current[sessionKey]) return;

    const nextStreamingSessions = { ...streamingSessionsRef.current };
    delete nextStreamingSessions[sessionKey];
    streamingSessionsRef.current = nextStreamingSessions;
    setStreamingSessions(nextStreamingSessions);
  }

  function migrateCachedMessages(fromKey: string, toSessionId: string) {
    if (fromKey === toSessionId) return;

    const cachedMessages = sessionMessagesRef.current[fromKey];
    if (!cachedMessages) return;

    const nextMessagesBySession = {
      ...sessionMessagesRef.current,
      [toSessionId]: cachedMessages,
    };
    delete nextMessagesBySession[fromKey];
    sessionMessagesRef.current = nextMessagesBySession;

    const streamingStartedAt = streamingSessionsRef.current[fromKey];
    if (streamingStartedAt) {
      const nextStreamingSessions = {
        ...streamingSessionsRef.current,
        [toSessionId]: streamingStartedAt,
      };
      delete nextStreamingSessions[fromKey];
      streamingSessionsRef.current = nextStreamingSessions;
      setStreamingSessions(nextStreamingSessions);
    }

    if (getMessagesKey(activeSessionIdRef.current) === fromKey) {
      activeSessionIdRef.current = toSessionId;
      setActiveSessionId(toSessionId);
      setMessages(cachedMessages);
    }
  }

  async function fetchSessionMessages(sessionId: string, signal?: AbortSignal) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}/messages`, {
        cache: "no-store",
        signal,
      });

      // 存在しない・他人の会話（404）は、一時的な失敗と区別する。呼び出し側が、消えた会話に入力欄を結びつけたままにしないため。
      if (response.status === 404) return "missing" as const;
      if (!response.ok) return null;

      const data = await readJsonObject(response);
      return Array.isArray(data.messages) ? (data.messages as Message[]) : [];
    } catch {
      return null;
    }
  }

  async function refreshSessionMessages(sessionId: string) {
    const fetchedMessages = await fetchSessionMessages(sessionId);
    if (!fetchedMessages || fetchedMessages === "missing") return false;

    replaceCachedMessages(sessionId, fetchedMessages);
    return true;
  }

  function addUploadFiles(incoming: File[]) {
    if (uploadProgress) return;
    if (!incoming.length) return;
    const current = files;
    const fileList = current.map(({ file }) => file);
    const error = getUploadSelectionError(fileList, incoming, uploadOptions);
    setSendError(error ? () => (translate: Translate) => getUploadSelectionError(fileList, incoming, uploadOptions, translate) : "");
    if (error) return;
    // Validate before allocating preview URLs.
    const next = [...current, ...incoming.map(createUploadFile)];
    setFiles(next);
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    addUploadFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function changeModel(nextModel: string) {
    // Keep attachments when switching models; show a recoverable error instead of silently deleting them.
    const option = getModelOption(nextModel);
    setModel(option.id);
    setSendError("");
    setReasoning((current) =>
      option.reasoningEfforts.includes(current as never)
        ? current
        : option.defaultReasoning,
    );
  }

  async function loadSessions() {
    // cache: no-store にして、直前に作成・更新されたセッション一覧を常に取りに行く。
    try {
      const startedAt = iconSync.mark();
      const organizationMark = organizationSync.current.mark();
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!response.ok) return false;

      const data = await readJsonObject(response);
      if (!Array.isArray(data.sessions)) return false;

      // 取得中に変えたアイコンが古い一覧で巻き戻らないよう、動いたものを重ねる。
      setSessions(organizationSync.current.reconcile(iconSync.reconcile(data.sessions as Session[], startedAt), organizationMark));
      return true;
    } catch {
      // 一時的な同期失敗では、現在表示している一覧を消さない。
      return false;
    }
  }

  async function createEmptySession(icon: string | null = null, projectId: string | null = null) {
    try {
      // アイコンとプロジェクトは、あるものだけ本文に入れる（どちらも無ければ本文なしの従来の呼び出し）。
      const payload = { ...(icon ? { icon } : {}), ...(projectId ? { projectId } : {}) };
      const response = await fetch("/api/sessions", {
        method: "POST",
        ...(Object.keys(payload).length ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) } : {}),
      });
      const data = await readJsonObject(response);
      if (!response.ok) {
        return {
          error: readErrorMessage(data, msg("Database is unavailable. Start local PostgreSQL and try again.")),
          session: null,
        };
      }

      return {
        error: "",
        session: (data.session as Session | undefined) ?? null,
      };
    } catch {
      return {
        error: msg("Database is unavailable. Start local PostgreSQL and try again."),
        session: null,
      };
    }
  }

  async function loadMessages(sessionId: string) {
    cancelReveal();
    draftEpochRef.current += 1;
    changeDraftIcon(null);
    const intent = sessionNavigationIntentRef.current + 1;
    sessionNavigationIntentRef.current = intent;
    sessionLoadAbortRef.current?.abort();
    const controller = new AbortController();
    sessionLoadAbortRef.current = controller;
    activeSessionIdRef.current = sessionId;
    pinToBottomRef.current = { key: getMessagesKey(sessionId), until: Date.now() + 2000 };
    setActiveSessionId(sessionId);
    setMessages(sessionMessagesRef.current[sessionId] ?? []);
    setSidebarOpen(false);
    setSendError("");

    if (streamingSessionsRef.current[sessionId]) {
      // 生成中の会話はDB保存前の差分を持つため、ローカル表示を優先する。
      return;
    }

    const fetchedMessages = await fetchSessionMessages(sessionId, controller.signal);
    if (
      fetchedMessages === "missing" &&
      !controller.signal.aborted &&
      sessionNavigationIntentRef.current === intent &&
      activeSessionIdRef.current === sessionId
    ) {
      // 開こうとした会話が無い（消えた・他人のもの）：そのまま新しいチャットとして使えるよう、結びつけを外してエラーだけ出す。
      activeSessionIdRef.current = null;
      setActiveSessionId(null);
      setMessages([]);
      setSendError(msg("Failed to load conversation."));
      return;
    }
    if (
      !fetchedMessages ||
      fetchedMessages === "missing" ||
      controller.signal.aborted ||
      sessionNavigationIntentRef.current !== intent ||
      activeSessionIdRef.current !== sessionId ||
      streamingSessionsRef.current[sessionId]
    ) {
      if (
        !controller.signal.aborted &&
        sessionNavigationIntentRef.current === intent &&
        activeSessionIdRef.current === sessionId &&
        !streamingSessionsRef.current[sessionId]
      ) {
        setSendError(msg("Failed to load conversation."));
      }
      return;
    }

    // 最新の選択に対応する履歴だけを表示へ反映する。
    replaceCachedMessages(sessionId, fetchedMessages);
    if (sessionLoadAbortRef.current === controller) {
      sessionLoadAbortRef.current = null;
    }
  }

  // projectId を渡すと、そのプロジェクトの中に新しいチャットを作る（プロジェクト行の「＋」）。
  async function createSession(projectId: string | null = null) {
    cancelReveal();
    // 空の新規チャットがすでに表示されている場合は、DB 上に同じ空セッションを増やさない。
    // 実際にユーザーが送信した時点で、その会話にタイトルが付き履歴として意味を持つ。
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if ((!activeSessionId || activeSession?.title === "New chat") && messages.length === 0) {
      // 同じプロジェクト（または両方なし）の空チャットなら、そのまま使う。
      if ((activeSession?.projectId ?? null) === projectId) {
        setSidebarOpen(false);
        return;
      }
      // 別のプロジェクトにある空チャットは、増やさずに目的の場所へ移す（ピン留め中のものは動かさず、新しく作る）。
      if (activeSession && !activeSession.pinned) {
        try {
          await updateSession(activeSession.id, { projectId });
          setSendError("");
        } catch (error) {
          setSendError(error instanceof Error ? error.message : msg("Could not save the chat. Please try again."));
        }
        setSidebarOpen(false);
        return;
      }
    }

    const intent = sessionNavigationIntentRef.current + 1;
    sessionNavigationIntentRef.current = intent;
    sessionLoadAbortRef.current?.abort();
    // まだ保存されていない新規チャットで先に選んだアイコンは、作る会話へ引き継ぐ。
    const carriedIcon = activeSessionId ? null : draftIconRef.current;
    const { error, session } = await createEmptySession(carriedIcon, projectId);
    if (!session) {
      setSendError(error || msg("Database is unavailable. Start local PostgreSQL and try again."));
      return;
    }
    setSendError("");
    setSessions((current) => [session, ...current]);
    replaceCachedMessages(session.id, []);
    if (sessionNavigationIntentRef.current !== intent) return;
    if (!activeSessionId) {
      draftEpochRef.current += 1;
      changeDraftIcon(null);
    }

    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setMessages([]);
    setSidebarOpen(false);
  }

  function changeSessionIcon(sessionId: string, icon: string | null) {
    const current = sessions.find((session) => session.id === sessionId)?.icon ?? null;
    const show = (value: string | null) =>
      setSessions((list) => list.map((session) => (session.id === sessionId ? { ...session, icon: value } : session)));
    // 画面へ先に反映し、保存は会話ごとに順番に送る。失敗したら最後に保存できた値へ戻す。
    void iconSync.change(sessionId, icon, current, show, () => setSendError(msg("Failed to change the chat icon.")));
  }

  const reorderChatBusy=useRef(false);
  async function reorderChat(move: ReorderRequest) {
    if(reorderChatBusy.current) throw new Error(msg("Wait for the previous move to finish."));
    reorderChatBusy.current=true;
    try {
      const response=await fetch("/api/sessions/reorder",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(move)});
      const data=await readJsonObject(response);
      if(!response.ok) throw new Error(typeof data.error==="string" ? data.error : msg("Could not move the chat."));
      const updates=data.items as Array<{id:string;position:number;pinned?:boolean;projectId?:string|null}>;
      for(const {id,...changes} of updates) organizationSync.current.saved(id,changes);
      setSessions(list=>list.map(session=>({...session,...updates.find(update=>update.id===session.id)})));
      return true;
    } finally {reorderChatBusy.current=false;}
  }

  async function changeChatProject(method: "POST" | "PATCH" | "DELETE", name?: string, id?: string) {
    try {
      const response=await fetch(id ? `/api/chat-projects/${id}` : "/api/chat-projects", {method,headers:{"Content-Type":"application/json"},...(method==="DELETE" ? {} : {body:JSON.stringify({name})})});
      if(!response.ok) {const data=await readJsonObject(response);throw new Error(typeof data.error==="string" ? data.error : msg("Could not save the project. Please try again."));}
      const data=await response.json();
      if(method==="DELETE") {
        projectSync.current.removed(id!);
        setChatProjects(list=>list.filter(project=>project.id!==id));
        for (const session of sessions) if(session.projectId===id) organizationSync.current.saved(session.id,{projectId:null});
        setSessions(list=>list.map(session=>session.projectId===id ? {...session,projectId:null} : session));
        return true;
      }
      projectSync.current.saved(data.project);
      setChatProjects(list=>method==="POST" ? [...list,data.project] : list.map(project=>project.id===id ? data.project : project));
      return data.project as ChatProject;
    } catch (error) { throw error instanceof Error ? error : new Error(msg("Could not save the project. Please try again.")); }
  }

  // プロジェクトの設定画面で保存した内容（共通指示の有無・参照ノート数）を一覧へ反映する。
  function saveProject(project: ChatProject) {
    projectSync.current.saved(project);
    setChatProjects((list) => list.map((item) => (item.id === project.id ? project : item)));
  }

  async function updateSession(sessionId: string, changes: Partial<Pick<Session, "title" | "pinned" | "projectId">>) {
    try {
      const response = await fetch(`/api/sessions/${sessionId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) });
      if (!response.ok) {const data=await readJsonObject(response);throw new Error(typeof data.error==="string" ? data.error : msg("Could not save the chat. Please try again."));}
      organizationSync.current.saved(sessionId,changes);
      setSessions(list => list.map(session => session.id === sessionId ? { ...session, ...changes } : session));
      return true;
    } catch (error) { throw error instanceof Error ? error : new Error(msg("Could not save the chat. Please try again.")); }
  }

  async function deleteSession(sessionId: string) {
    if (streamingSessionsRef.current[sessionId] || submittingSessionKeysRef.current.has(sessionId)) { throw new Error(msg("Wait for the reply to finish before deleting this chat.")); }
    // 削除 API はサーバー側で現在ユーザーの所有セッションか確認する。
    let response: Response;
    try {
      response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    } catch {
      throw new Error(msg("Failed to delete conversation. Please try again."));
    }
    if (!response.ok) { const data=await readJsonObject(response); throw new Error(typeof data.error==="string" ? data.error : msg("Failed to delete conversation. Please try again.")); }
    organizationSync.current.removed(sessionId);
    // サイドバーから対象セッションを消す。行がすっと消えて、下の行が詰まる。
    runTransition(() => setSessions((current) => current.filter((session) => session.id !== sessionId)), "list");
    const nextMessagesBySession = { ...sessionMessagesRef.current };
    delete nextMessagesBySession[sessionId];
    sessionMessagesRef.current = nextMessagesBySession;
    if (activeSessionIdRef.current === sessionId) {
      // 表示中のセッションを削除した場合は、新規チャット状態へ戻す。
      sessionNavigationIntentRef.current += 1;
      sessionLoadAbortRef.current?.abort();
      activeSessionIdRef.current = null;
      setActiveSessionId(null);
      setMessages([]);
    }
    return true;
  }

  function removeUploadFile(fileId: string) {
    if (uploadProgress) return;
    setSendError("");
    const current = files;
    revokeUploadPreviews(current.filter((item) => item.id === fileId));
    const next = current.filter((item) => item.id !== fileId);
    setFiles(next);
  }

  function scrollChatToBottom() {
    const scroller = chatScrollRef.current;
    if (!scroller) return;

    const scrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    scroller.scrollTo({
      top: scroller.scrollHeight,
      behavior: scrollBehavior,
    });
    setIsAtChatBottom(true);
    window.requestAnimationFrame(() => {
      scroller.scrollTo({
        top: scroller.scrollHeight,
        behavior: scrollBehavior,
      });
      setIsAtChatBottom(true);
    });
  }

  function updateChatBottomState() {
    const scroller = chatScrollRef.current;
    if (!scroller) return;

    const distanceToBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
    setIsAtChatBottom(distanceToBottom <= 8);
  }

  function changeInput(nextInput: string, element: HTMLTextAreaElement) {
    const guard = submittedInputRestoreGuardRef.current;

    if (guard) {
      if (new Date().getTime() > guard.expiresAt) {
        submittedInputRestoreGuardRef.current = null;
      } else if (nextInput.startsWith(guard.value)) {
        // 送信済み本文がブラウザイベントで復元された場合は、その部分だけ落とす。
        const recoveredInput = nextInput.slice(guard.value.length);
        const nextRecoveredInput =
          recoveredInput === "\n" || recoveredInput === "\r\n" ? "" : recoveredInput;
        element.value = nextRecoveredInput;
        setInput(nextRecoveredInput);
        if (nextRecoveredInput) {
          submittedInputRestoreGuardRef.current = null;
        }
        return;
      }
    }

    submittedInputRestoreGuardRef.current = null;
    setInput(nextInput);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();

    const submittedInputValue = inputRef.current?.value ?? input;
    const userContent = submittedInputValue.trim();
    const submittedFiles = files;
    let requestSessionId = activeSessionIdRef.current;
    let requestSessionKey = getMessagesKey(requestSessionId);
    const initialRequestSessionKey = requestSessionKey;
    if (
      !userContent ||
      uploadProgress ||
      streamingSessionsRef.current[requestSessionKey] ||
      submittingSessionKeysRef.current.has(requestSessionKey)
    ) {
      return;
    }

    const validationError = getUploadValidationError(submittedFiles.map(({ file }) => file), uploadOptions) || getUploadRequestError(submittedFiles.map(({ file }) => file), userContent) || getSubmissionValidationError({
      imageGenerationMode,
      fileMimeTypes: submittedFiles.map((item) => item.file.type),
    });
    if (validationError) {
      const submitted = submittedFiles.map(({ file }) => file);
      setSendError(() => (translate: Translate) => getUploadValidationError(submitted, uploadOptions, translate) || getUploadRequestError(submitted, userContent, translate) || translate(validationError));
      return;
    }

    setSendError("");
    submittingSessionKeysRef.current.add(requestSessionKey);

    let uploadedTickets: string[] = [];
    const navigationIntent = sessionNavigationIntentRef.current;
    try {
      if (submittedFiles.length) setUploadProgress(msg("Preparing attachments…"));
      uploadedTickets = await uploadChatFiles(submittedFiles.map(({ file }) => file), (name, index, total, percentage) => {
        setUploadProgress({ key: msg("Uploading {index}/{total} · {name} · {percentage}%"), vars: { index, total, name, percentage } });
      });
      if (navigationIntent !== sessionNavigationIntentRef.current) {
        await cleanupClientUploads(uploadedTickets);
        submittingSessionKeysRef.current.delete(initialRequestSessionKey);
        return;
      }
    } catch (error) {
      if (navigationIntent === sessionNavigationIntentRef.current) setSendError(error instanceof Error ? error.message : msg("Attachment upload failed. Please try again."));
      submittingSessionKeysRef.current.delete(initialRequestSessionKey);
      return;
    } finally {
      setUploadProgress(null);
    }

    if (!requestSessionId) {
      // 未保存の新規チャットは送信開始前に実セッション化する。
      // 画像生成も完了待ちにならず、他セッションと同じ単位で並行管理できる。
      const sentIcon = draftIconRef.current;
      const draftEpoch = draftEpochRef.current;
      const { error, session } = await createEmptySession(sentIcon);
      if (!session) {
        await cleanupClientUploads(uploadedTickets);
        setSendError(error || msg("Database is unavailable. Start local PostgreSQL and try again."));
        submittingSessionKeysRef.current.delete(initialRequestSessionKey);
        return;
      }

      requestSessionId = session.id;
      requestSessionKey = session.id;
      submittingSessionKeysRef.current.add(requestSessionKey);
      setSessions((current) =>
        current.some((item) => item.id === session.id) ? current : [session, ...current],
      );
      // 作成を待っている間に選び直したアイコンは、会話ができたあとで保存する（そのまま消えないように）。
      // 作成の途中で別の会話へ移っていたら、移動側が下書きを片付け済み。ここでは何も触らない。
      const latestIcon = draftEpochRef.current === draftEpoch ? draftIconRef.current : sentIcon;
      if (draftEpochRef.current === draftEpoch) changeDraftIcon(null);
      if (latestIcon !== sentIcon) {
        const created = session.id;
        void iconSync.change(created, latestIcon, sentIcon,
          (value) => setSessions((list) => list.map((item) => (item.id === created ? { ...item, icon: value } : item))),
          () => setSendError(msg("Failed to change the chat icon.")));
      }
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
    }

    // 送信後すぐにユーザー発言と空のアシスタント枠を追加する。
    // API の応答を待ってから描画すると体感が遅くなるため、先に表示してストリーム差分で埋めていく。
    // 入力欄の値はここで確定する。以降は state を空にしてもこの変数を API 送信用に使う。
    // 送信時点の添付を固定する。setFiles([]) 後もこの配列を使って FormData とプレビュー解放を行う。
    // API 応答を待たずに画面へ出すユーザー発言。添付には送信前プレビュー URL も含める。
    const localUserMessage: Message = {
      id: crypto.randomUUID(),
      role: "USER",
      content: userContent,
      model,
      reasoningEffort: reasoning.toUpperCase(),
      attachments: submittedFiles.map(({ id, file, previewUrl }) => ({
        id,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        previewUrl,
      })),
    };
    // ストリームで本文や画像を流し込む対象の、空のアシスタントメッセージ ID。
    const assistantMessageId = crypto.randomUUID();

    updateCachedMessages(requestSessionKey, (current) => [
      ...current,
      localUserMessage,
      {
        id: assistantMessageId,
        role: "ASSISTANT",
        content: "",
        model,
        reasoningEffort: reasoning.toUpperCase(),
        isGeneratingImage: imageGenerationMode,
      },
    ]);
    submittedInputRestoreGuardRef.current = {
      value: submittedInputValue,
      expiresAt: new Date().getTime() + INPUT_RESTORE_GUARD_MS,
    };
    setInput("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setFiles([]);

    const streamStartedAt = new Date().getTime();
    startStreamingSession(requestSessionKey, streamStartedAt);

    // 本文・モデル設定・署名付き添付参照だけを送る。画像/ファイルのバイナリは Blob 直送済み。
    const body = new FormData();
    body.append("message", userContent);
    body.append("model", model);
    body.append("reasoning", reasoning);
    if (requestSessionId) body.append("sessionId", requestSessionId);
    body.append("uploads", JSON.stringify(uploadedTickets));

    // 送信完了後にサーバー履歴へ差し替えられた時だけ、楽観表示用 previewUrl を解放する。
    let shouldCleanupSubmittedPreviews = false;

    try {
      if (imageGenerationMode) {
        // 画像生成はテキストチャットとは別 API に送る。
        // UI では完成前の部分画像を出さず、固定の生成中プレビューから完成画像へ一度だけ差し替える。
        const generatedImageId = crypto.randomUUID();
        // 参照画像を一緒に送れるよう、画像生成 API へも multipart/form-data で渡す。
        const imageBody = new FormData();
        imageBody.append("prompt", userContent);
        imageBody.append("model", model);
        imageBody.append("reasoning", reasoning);
        if (requestSessionId) imageBody.append("sessionId", requestSessionId);
        imageBody.append("uploads", JSON.stringify(uploadedTickets));
        // 画像生成 API は完成画像だけを JSON で返す。
        const response = await fetch("/api/images", {
          method: "POST",
          body: imageBody,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw usageLimitErrorFrom(response.status, data) ?? new Error(data.error ?? msg("Failed to generate image."));
        }

        const event = (await response.json()) as ImageGenerationResult;
        let completedSessionId = requestSessionId;

        if (event.error) {
          throw new Error(event.error);
        }

        if (!event.image?.dataUrl) {
          throw new Error(msg("Failed to generate image."));
        }

        if (event.sessionId) {
          completedSessionId = event.sessionId;
          if (requestSessionKey !== event.sessionId) {
            // 新規チャットから画像生成した場合、完成時のセッション ID へローカル表示を移す。
            migrateCachedMessages(requestSessionKey, event.sessionId);
            requestSessionKey = event.sessionId;
          }
        }

        updateCachedMessages(requestSessionKey, (current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? {
                  ...message,
                  content: "",
                  isGeneratingImage: false,
                  generatedImages: [
                    {
                      id: generatedImageId,
                      dataUrl: event.image?.dataUrl ?? "",
                      mimeType: event.image?.mimeType ?? "image/png",
                    },
                  ],
                }
              : message,
          ),
        );

        await loadSessions();
        if (completedSessionId) {
          shouldCleanupSubmittedPreviews = await refreshSessionMessages(completedSessionId);
        }
        return;
      }

      // 通常チャットは text/plain のストリームを受け取り、到着した chunk を本文末尾に追記する。
      // 最後に履歴を再取得して、DB 側で採番された添付 ID や保存画像 URL とローカル表示を同期する。
      // チャット API へ送信し、返ってくる text/plain ストリームをそのまま表示に反映する。
      const response = await fetch("/api/chat", {
        method: "POST",
        body,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw usageLimitErrorFrom(response.status, data) ?? new Error(data.error ?? msg("Failed to send message."));
      }

      // 新規チャットの場合、サーバーで作成されたセッション ID がレスポンスヘッダーに入る。
      const nextSessionId = response.headers.get("X-Session-Id");
      // 既存セッションなら activeSessionId、新規ならヘッダー値を使って最後に履歴を再取得する。
      const resolvedSessionId = nextSessionId ?? requestSessionId;
      if (nextSessionId && requestSessionKey !== nextSessionId) {
        migrateCachedMessages(requestSessionKey, nextSessionId);
        requestSessionKey = nextSessionId;
        void loadSessions();
      }

      // SSE ストリームをバイト列から文字列へ変換しながら読む。
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamBuffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        streamBuffer += decoder.decode(value, { stream: true });
        // SSE は空行区切り。最後の要素は途中イベントの可能性があるので次回へ持ち越す。
        const events = streamBuffer.split(/\r?\n\r?\n/);
        streamBuffer = events.pop() ?? "";

        // 推論要約は細かい差分で大量に届くため、1 回の read 分をまとめて 1 回だけ再描画する。
        let chunk = "";
        const activityEvents: ActivityEvent[] = [];
        for (const eventText of events) {
          for (const item of eventText.split(/\r?\n/).map(parseChatStreamLine)) {
            if (typeof item === "string") chunk += item;
            else if (item) activityEvents.push(item);
          }
        }

        if (!chunk && !activityEvents.length) continue;

        const receivedAt = Date.now();
        updateCachedMessages(requestSessionKey, (current) =>
          current.map((message) => {
            if (message.id !== assistantMessageId) return message;
            // chunk は AI が追加で生成した本文の差分。既存 content の末尾へ連結する。
            return {
              ...message,
              content: message.content + chunk,
              activity: activityEvents.length
                ? activityEvents.reduce(applyActivityEvent, message.activity ?? [])
                : message.activity,
              // 本文が届き始めた時点までを「考えていた時間」として残す。
              thinkingMs:
                message.thinkingMs ?? (chunk ? receivedAt - streamStartedAt : undefined),
            };
          }),
        );
      }

      await loadSessions();
      if (resolvedSessionId) {
        shouldCleanupSubmittedPreviews = await refreshSessionMessages(resolvedSessionId);
      }
    } catch (error) {
      // ネットワークや上流 API の失敗も、空のアシスタント枠へエラー文として表示する。
      // 原文を保持し、明示した失敗・上限の文だけを表示時に訳す。
      const detail = error instanceof Error ? error.message : msg("Unknown error.");
      const limited = error instanceof UsageLimitError;
      if (limited) {
        if (error.tier === "guest") {
          guestLimitHitRef.current = true;
          setGuestLimit(error.kind);
        }
        // 上限で断られた送信はどこにも保存されていない。本文と添付を入力欄に戻す。
        // 待っている間に書き足した本文や添付があれば消さず、断られた分を前に足す。
        // 添付のプレビューは入力欄側が持ち続けるので、画面上の送信済み発言からは外す。
        submittedInputRestoreGuardRef.current = null;
        const typedMeanwhile = inputRef.current?.value ?? "";
        const restored = typedMeanwhile.trim() ? [submittedInputValue.trimEnd(), typedMeanwhile].join("\n\n") : submittedInputValue;
        setInput(restored);
        if (inputRef.current) inputRef.current.value = restored;
        if (submittedFiles.length) setFiles((current) => [...submittedFiles, ...current.filter((item) => !submittedFiles.some((sent) => sent.id === item.id))]);
      }
      updateCachedMessages(requestSessionKey, (current) =>
        current.map((message) =>
          message.id === localUserMessage.id && limited
            ? stripAttachmentPreviewUrls(message)
            : message.id === assistantMessageId
            ? { ...message, content: limited ? detail : failureText(detail), failed: true, isGeneratingImage: false,
              usageLimit: limited ? error.kind : undefined,
              activity: limited ? message.activity : applyActivityEvent(message.activity ?? [], { type: "failure", id: "request-failure", offset: 0, detail }) }
            : message,
        ),
      );
    } finally {
      if (shouldCleanupSubmittedPreviews) {
        // DB から再取得した添付情報に置き換わったので、送信前 previewUrl は不要になる。
        revokeUploadPreviews(submittedFiles);
        updateCachedMessages(requestSessionKey, (current) =>
          current.map(stripAttachmentPreviewUrls),
        );
      }
      await cleanupClientUploads(uploadedTickets);
      finishStreamingSession(requestSessionKey);
      submittingSessionKeysRef.current.delete(initialRequestSessionKey);
      submittingSessionKeysRef.current.delete(requestSessionKey);
    }
  }

  useEffect(() => {
    // 上限の案内からログインして戻ってきたら、送れなかった本文を入力欄へ戻す。
    const pending = takePendingDraft("chat");
    if (pending) queueMicrotask(() => setInput((current) => current || pending));
  }, []);

  useEffect(() => {
    // 初回表示時は会話本文を読み込まず、サイドバーのセッション一覧だけ取得する。
    // 本文はユーザーがセッションを選んだ時に遅延取得する。
    queueMicrotask(() => {
      void loadSessions();
    });
  }, []);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  useEffect(() => {
    // files は state のためクリーンアップ関数内だと古い値になりやすい。
    // ref に最新値を持たせ、ページ破棄時に未送信ファイルの previewUrl をまとめて解放する。
    return () => {
      sessionLoadAbortRef.current?.abort();
      revokeUploadPreviews(filesRef.current);
    };
  }, []);

  useEffect(() => {
    const scroller = chatScrollRef.current;
    if (!scroller) return;

    updateChatBottomState();
    scroller.addEventListener("scroll", updateChatBottomState, { passive: true });

    return () => scroller.removeEventListener("scroll", updateChatBottomState);
  }, [messages.length]);

  useEffect(() => {
    window.requestAnimationFrame(updateChatBottomState);
  }, [messages]);

  // 既存の会話を開いた時は、いちばん新しいやり取りが見える最下部から始める。
  // 履歴は先にキャッシュ、続けて取得結果で置き換わり、画像などで高さも後から変わるので、短時間は何度か最下部へ寄せる。
  useLayoutEffect(() => {
    const pin = pinToBottomRef.current;
    const scroller = chatScrollRef.current;
    if (!pin || !scroller || pin.key !== activeSessionKey || Date.now() > pin.until || !messages.length) return;
    const jump = () => {
      const current = pinToBottomRef.current;
      if (!current || current.key !== activeSessionKey || Date.now() > current.until) return;
      scroller.scrollTop = scroller.scrollHeight;
      updateChatBottomState();
    };
    jump();
    const frame = window.requestAnimationFrame(jump);
    const timers = [120, 400, 1000].map((delay) => window.setTimeout(jump, delay));
    return () => {
      window.cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [messages, activeSessionKey]);

  useEffect(() => {
    // アシスタント本文がまだ空の間、待機表示の秒数を更新する。
    // 通常時は interval を作らず、ストリーミング中だけ最小限の再描画にする。
    if (Object.keys(streamingSessions).length === 0) return;

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, [streamingSessions]);

  useEffect(() => {
    function toggleSidebarShortcut(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") {
        return;
      }

      // 編集中の Ctrl+B は区画編集器の太字ショートカットに渡す。
      if (event.target instanceof HTMLElement && event.target.closest('[contenteditable="true"], input, textarea')) return;

      event.preventDefault();
      if (window.matchMedia("(min-width: 1024px)").matches) {
        setSidebarVisible((current) => !current);
      } else {
        setSidebarOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", toggleSidebarShortcut);
    return () => window.removeEventListener("keydown", toggleSidebarShortcut);
  }, []);

  // 検索結果から開いた会話・ノートが画面に出そろったら、一致した場所まで動かして目立たせる（予約は 1 回だけ使う）。
  useEffect(() => {
    const request = revealRef.current;
    if (!request) return;
    if (Date.now() > request.expires) {
      revealRef.current = null;
      return;
    }
    if (request.kind === "chat") {
      if (workspaceView !== "chat" || activeSessionId !== request.sessionId) return;
    } else if (workspaceView !== "pages" || notesList || notes.loading || !notes.active || notes.activeId !== request.noteId) return;
    revealRef.current = null;
    revealAbortRef.current?.abort();
    const controller = new AbortController();
    revealAbortRef.current = controller;
    if (request.kind === "note") {
      void revealNoteBlock(request.blockId, { signal: controller.signal });
      return;
    }
    void revealChatMessage(request.messageId, { signal: controller.signal }).then((found) => {
      // 一致したメッセージが見つからなければ（削除済みなど）、会話をいつもどおり最下部から見せる。
      const scroller = chatScrollRef.current;
      if (!found && !controller.signal.aborted && scroller) scroller.scrollTop = scroller.scrollHeight;
    });
  }, [revealTick, workspaceView, activeSessionId, notesList, notes.loading, notes.active, notes.activeId]);

  // プロジェクトの参照ノートのチップなどが投げる "studymate:open-note" / "studymate:open-chat" を、検索結果と同じ開き方に流す。
  const linkOpenersRef = useRef({ note: openNoteFromLink, chat: openChatFromLink, projects: refreshChatProjects });
  useEffect(() => {
    linkOpenersRef.current = { note: openNoteFromLink, chat: openChatFromLink, projects: refreshChatProjects };
  });
  useEffect(() => {
    function detailOf(event: Event) {
      const detail = (event as CustomEvent<Record<string, unknown> | null>).detail;
      return typeof detail?.id === "string" && detail.id ? detail : null;
    }
    function onOpenNote(event: Event) {
      const detail = detailOf(event);
      if (detail) linkOpenersRef.current.note(detail.id as string, typeof detail.blockId === "string" ? detail.blockId : undefined);
    }
    function onOpenChat(event: Event) {
      const detail = detailOf(event);
      if (detail) void linkOpenersRef.current.chat(detail.id as string, typeof detail.messageId === "string" ? detail.messageId : undefined);
    }
    // ゴミ箱から戻したノートが参照ノートに入っていたプロジェクトの件数を合わせる。
    function onPageCreated() {
      linkOpenersRef.current.projects();
    }
    window.addEventListener("studymate:open-note", onOpenNote);
    window.addEventListener("studymate:open-chat", onOpenChat);
    window.addEventListener("studymate:page-created", onPageCreated);
    return () => {
      window.removeEventListener("studymate:open-note", onOpenNote);
      window.removeEventListener("studymate:open-chat", onOpenChat);
      window.removeEventListener("studymate:page-created", onPageCreated);
      revealAbortRef.current?.abort();
    };
  }, []);

  // 保存したノートやダウンロードしたファイルに書いた会話へのリンク（/?chat=<会話>&message=<メッセージ>）で開いたとき、その会話を開く。
  // 先にこの指定を URL から外す（再読み込みや戻る操作でもう一度開かない）。他の指定は残すが、Notes を開く指定が一緒にあれば会話を優先して外す。
  // 開発時の StrictMode が付ける「一度外して付け直す」動作で、開きかけの読み込みが中断されないよう、microtask に回して取り消せるようにする。
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const url = new URL(window.location.href);
      const chatId = url.searchParams.get("chat");
      if (!chatId) return;
      const rawMessageId = url.searchParams.get("message") ?? "";
      url.searchParams.delete("chat");
      url.searchParams.delete("message");
      if (url.searchParams.get("view") === "pages") {
        url.searchParams.delete("view");
        url.searchParams.delete("page");
      }
      window.history.replaceState(window.history.state, "", url);
      setWorkspaceView("chat");
      setNotesList(false);
      // ID は URL から来る値なので、API のパスに入れる前に形を確かめる。形が違えば、存在しない会話と同じ扱いにする。
      if (!LINK_ID.test(chatId)) {
        setSendError(msg("Failed to load conversation."));
        return;
      }
      void linkOpenersRef.current.chat(chatId, LINK_ID.test(rawMessageId) ? rawMessageId : undefined);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ヘッダーに表示するタイトル。未選択または新規チャット中は固定文言にする。
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const activeTitle = activeSession?.title ?? t("New chat");
  // Thinking 表示に出す秒数。0 秒表示を避けるため、ストリーム中は最低 1 秒に丸める。
  const thinkingSeconds =
    activeStreamStartedAt === null
      ? 0
      : Math.max(1, Math.round((now - activeStreamStartedAt) / 1000));

  // デスクトップとモバイルで同じ会話履歴を使い、表示方法だけ切り替える。
  const closeSidebar = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) setSidebarVisible(false);
    else setSidebarOpen(false);
  };
  const sidebar = workspaceView === "pages" ? (
    <NotesSidebar pages={notes.pages} activeId={notes.activeId} busy={notes.busy || notes.loading}
      onCreate={() => { setSidebarOpen(false); createNote(); }} onSearch={() => setSearchOpen(true)} onSelect={(id) => { setSidebarOpen(false); openNote(id); }}
      onDelete={deleteNote} onClose={closeSidebar} onWorkspaceChange={changeWorkspace}
      groups={notes.groups} groupError={notes.groupError} onReorder={notes.reorder} onMoveNote={notes.moveNote} onChangeIcon={notes.changeIcon} onCreateGroup={notes.createGroup}
      onRenameGroup={notes.renameGroup} onDeleteGroup={notes.deleteGroup} />
  ) : (
    <ChatSidebar
      sessions={sessions}
      activeSessionId={activeSessionId}
      onCreate={() => void createSession()}
      onSearch={() => setSearchOpen(true)}
      onCreateInProject={(projectId) => void createSession(projectId)}
      onLoad={loadMessages}
      onDelete={deleteSession}
      onUpdate={updateSession}
      onReorder={reorderChat}
      projects={chatProjects}
      projectError={t(chatProjectError)}
      onProject={changeChatProject}
      onProjectSaved={saveProject}
      onChangeIcon={changeSessionIcon}
      onClose={closeSidebar}
      onWorkspaceChange={changeWorkspace}
    />
  );

  // 履歴の小窓は、開いたノートが今も表示中のときだけ出す。復元は、このノートの保存キュー（版を持つ）を通して行う。
  const historyQueue = workspaceView === "pages" && historyNoteId === notes.activeId ? notes.active : undefined;

  // メッセージがない時は中央を空け、入力フォームを下部に大きく見せる。
  const emptyState = messages.length === 0;
  // スマホでは、ホーム画面（空の会話・ノート未選択）では見出しを本文側に出すので、上部バーの標題は会話中・ノート編集中だけ出す。
  const showPhoneTitle = workspaceView === "chat" ? !emptyState : Boolean(notes.active) && !notesList;

  return (
    <main className="notion-workspace flex h-dvh">
      {sidebarVisible && <div className="motion-desktop-sidebar hidden lg:block">{sidebar}</div>}

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="motion-fade-in absolute inset-0 bg-black/15"
            onClick={() => setSidebarOpen(false)}
            aria-label={t("Close sidebar overlay")}
          />
          <div ref={attachDrawer} {...drawerBind} className="motion-sidebar-panel swipe-x relative h-full w-60 max-w-[88vw]">{sidebar}</div>
        </div>
      )}

      <section className="notion-page">
        <header className="notion-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="notion-icon-button mobile-sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label={t("Open sidebar")}
            >
              <Menu size={20} />
            </button>
            {workspaceView === "pages" && notes.active && !notesList && (
              <button type="button" className="notion-icon-button grid sm:hidden" onClick={openNotesList}
                aria-label={t("All notes")} title={t("All notes")}>
                <ChevronLeft size={22} />
              </button>
            )}
            {!sidebarVisible && (
              <button
                type="button"
                className="notion-icon-button desktop-sidebar-toggle"
                onClick={() => setSidebarVisible(true)}
                aria-label={t("Open sidebar")}
                title={t("Toggle sidebar (Ctrl+B)")}
              >
                <PanelLeft size={22} strokeWidth={1.8} />
              </button>
            )}
            <div className={`min-w-0 sm:block ${showPhoneTitle ? "" : "hidden"}`}>
              <div className="flex items-center gap-1.5 text-sm text-[var(--notion-muted)]">
                {workspaceView === "pages" && (notes.active?.content.icon ? <span className="shrink-0 text-[15px] leading-none">{notes.active.content.icon}</span> : <FileText size={15} className="shrink-0" />)}
                {workspaceView === "chat" && activeSession && (
                  <ChatTopbarIcon key={activeSession.id} icon={activeSession.icon} onChange={(icon) => changeSessionIcon(activeSession.id, icon)} />
                )}
                <span className="truncate">{workspaceView === "pages" ? notes.active?.content.title || t("Notes") : activeTitle}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* サイドバーの Search 行が見えているパソコン幅では出さない（サイドバーを畳んだとき・タブレット・スマホ用）。 */}
            <button type="button" className={`notion-icon-button grid${sidebarVisible ? " lg:hidden" : ""}`} onClick={() => setSearchOpen(true)}
              aria-label={t("Search chats and notes")} title={t("Search (Ctrl+K)")} aria-haspopup="dialog">
              <Search size={20} />
            </button>
            {workspaceView === "chat" && !emptyState && (
              <button type="button" className="notion-icon-button grid lg:hidden" onClick={() => void createSession()}
                aria-label={t("New chat")} title={t("New chat")}>
                <Plus size={20} />
              </button>
            )}
            {workspaceView === "pages" && !notesList && notes.active && notes.activeId && (
              <button type="button" className="notion-icon-button grid" disabled={notes.busy} onClick={() => setHistoryNoteId(notes.activeId)}
                aria-label={t("Version history")} title={t("Version history")} aria-haspopup="dialog">
                <History size={20} />
              </button>
            )}
            {workspaceView === "pages" && !notesList ? (
              <span role="status" className={`notes-save-status ${notes.active?.status === "error" || notes.active?.status === "conflict" ? "has-error" : ""}`}>
                {notes.active ? ({ saved: t("Saved"), pending: t("Saving…"), saving: t("Saving…"), error: t("Not saved"), conflict: t("Conflict") })[notes.active.status] : ""}
              </span>
            ) : null}
          </div>
        </header>

        <div className={workspaceView === "pages" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <NotesWorkspace notes={notes} listMode={notesList} model={model} reasoning={reasoning} onOpen={openNote} onCreate={createNote} onWorkspaceChange={changeWorkspace} />
        </div>

        <div className={workspaceView === "chat" ? `notion-chat-workspace${emptyState ? " is-empty" : ""}` : "hidden"}>
        <div ref={chatScrollRef} className="notion-chat-scroll relative z-0 flex-1 overflow-y-auto">
          <div
            className="notion-page-column flex min-h-full flex-col px-6 pb-12 sm:px-12"
          >
            {emptyState ? (
              <EmptyConversation
                title={activeTitle}
                icon={activeSession ? (activeSession.icon ?? null) : draftIcon}
                onIconChange={(icon) => (activeSession ? changeSessionIcon(activeSession.id, icon) : changeDraftIcon(icon))}
                onWorkspaceChange={changeWorkspace}
              />
            ) : (
              <>
                <header className="pb-10 pt-12 motion-page-enter max-sm:hidden">
                  <h1 aria-labelledby="chat-heading-text" className="break-words text-[2rem] font-[750] leading-tight tracking-[-0.04em] text-[var(--sm-ink)]">
                    {activeSession && <ChatTitleIcon key={activeSession.id} icon={activeSession.icon ?? null} onChange={(icon) => changeSessionIcon(activeSession.id, icon)} />}
                    <span id="chat-heading-text">{activeTitle}</span>
                  </h1>
                </header>
                <div className="space-y-9">
                  {messages.map((message, index) => {
                    const isWaitingAssistant =
                      message.role === "ASSISTANT" &&
                      !message.content &&
                      !message.generatedImages?.length &&
                      index === messages.length - 1;

                    return (
                      <ChatMessage
                        key={message.id}
                        message={message}
                        isStreaming={isActiveSessionStreaming && isWaitingAssistant}
                        thinkingSeconds={
                          isActiveSessionStreaming && isWaitingAssistant ? thinkingSeconds : 0
                        }
                        isGenerating={isActiveSessionStreaming && index === messages.length - 1}
                        sessionId={activeSessionId}
                        conversationTitle={activeTitle}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="notion-composer-wrap">
          <div
            className={`notion-scroll-bottom mx-auto mb-2 flex max-w-4xl justify-center transition-[opacity,transform] duration-150 ease-out ${
              !emptyState && !isAtChatBottom
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-95 opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={scrollChatToBottom}
              className="notion-icon-button grid bg-white shadow-[var(--notion-shadow)]"
              aria-label={t("Scroll to bottom")}
              title={t("Scroll to bottom")}
            >
              <ArrowDown size={20} strokeWidth={2.1} />
            </button>
          </div>
          {guestLimit && (
            <GuestLimitPrompt kind={guestLimit} onClose={() => setGuestLimit(null)} attachmentsLost={files.length > 0}
              onBeforeSignIn={() => savePendingDraft("chat", inputRef.current?.value ?? input)} />
          )}
          {(uploadError || sendError) && (
            <div
              className="notion-error notion-page-column mb-3"
              role="alert"
            >
              {uploadError || (typeof sendError === "function" ? sendError(t) : localizeSystemText(sendError, t))}
            </div>
          )}
          <form onSubmit={sendMessage} className="notion-page-column">
            {!!files.length && (
              <div className="mb-3 flex flex-wrap gap-2">
                {files.map(({ id, file, previewUrl }) =>
                  previewUrl ? (
                    <div key={id} className="group motion-menu relative h-24 w-24 overflow-hidden rounded-md border border-[var(--notion-border)]">
                      <Image
                        src={previewUrl}
                        alt={file.name}
                        width={112}
                        height={112}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeUploadFile(id)}
                        disabled={Boolean(uploadProgress)}
                        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        aria-label={t("Remove image")}
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <button
                      key={id}
                      type="button"
                      onClick={() => removeUploadFile(id)}
                      disabled={Boolean(uploadProgress)}
                      className="motion-menu inline-flex max-w-full items-center gap-2 rounded border border-[var(--notion-border)] bg-[var(--notion-sidebar)] px-2.5 py-1.5 text-xs text-[var(--notion-muted)] hover:bg-[var(--notion-hover)]"
                    >
                      <Paperclip size={13} />
                      <span className="truncate">{file.name}</span>
                      <X size={13} />
                    </button>
                  ),
                )}
              </div>
            )}

            <div className="notion-composer grid grid-cols-[auto_minmax(0,1fr)_auto] gap-x-1.5 gap-y-1 p-2.5">
              {isNarrowScreen ? (
                <button
                  type="button"
                  className="notion-icon-button col-start-1 row-start-2 grid"
                  onClick={() => {
                    (document.activeElement as HTMLElement | null)?.blur();
                    setAttachSheetOpen(true);
                  }}
                  aria-haspopup="dialog"
                  aria-label={t("Add")}
                  disabled={Boolean(uploadProgress)}
                >
                  <Plus size={18} strokeWidth={1.8} />
                </button>
              ) : (
                <label className="notion-icon-button col-start-1 row-start-2 grid cursor-pointer" title={t("Add files or photos")}>
                  <Plus size={18} strokeWidth={1.8} />
                  <input type="file" multiple disabled={Boolean(uploadProgress)} accept={ATTACHMENT_ACCEPT} aria-label={t("Add files or photos")} className="sr-only" onChange={handleFileSelect} />
                </label>
              )}
              <div className="col-span-3 row-start-1 min-w-0">
                {imageGenerationMode && (
                  <button
                    type="button"
                    className="image-mode-chip sm:hidden"
                    onClick={() => setImageGenerationMode(false)}
                    aria-label={t("Turn off image creation")}
                  >
                    <ImagePlus size={16} />
                    <span>{t("Create an image")}</span>
                    <X size={14} />
                  </button>
                )}
                <div className="flex items-center">
                <textarea
                  readOnly={Boolean(uploadProgress)}
                  ref={inputRef}
                  value={input}
                  onChange={(event) => changeInput(event.target.value, event.currentTarget)}
                  onPaste={(event) => {
                    const pastedImages = getClipboardImageFiles(event.clipboardData.items);
                    if (!pastedImages.length) return;

                    // 画像がある時だけ既定の貼り付けを止め、既存の添付フローへ渡す。
                    event.preventDefault();
                    addUploadFiles(pastedImages);
                  }}
                  onKeyDown={(event) => {
                    // IMEの確定Enter（keyCode 229）は送信せず、通常のEnterだけ送信する。
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing &&
                      event.nativeEvent.keyCode !== 229
                    ) {
                      event.preventDefault();
                      if (event.currentTarget.value.trim()) {
                        event.currentTarget.form?.requestSubmit();
                      }
                    }
                  }}
                  rows={1}
                  placeholder={inputPlaceholder}
                  className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1.5 py-1 text-[15px] leading-6 text-[var(--notion-text)] outline-none placeholder:text-[var(--notion-faint)]"
                />
              </div>
              </div>
              <div className="col-start-2 row-start-2 flex min-w-0 items-center gap-0.5 overflow-visible">
                <ModelSelect
                  value={model}
                  reasoning={reasoning}
                  onModelChange={changeModel}
                  onReasoningChange={setReasoning}
                />
                <button
                  type="button"
                  onClick={() => setImageGenerationMode((current) => !current)}
                  className={`notion-composer-control composer-image-toggle shrink-0 ${
                    imageGenerationMode ? "is-active" : ""
                  }`}
                  aria-pressed={imageGenerationMode}
                  aria-label={imageGenerationMode ? t("Disable image generation") : t("Enable image generation")}
                >
                  <ImagePlus size={15} />
                  <span className="hidden sm:inline">{t("Create an image")}</span>
                </button>
              </div>
              <button
                type="submit"
                disabled={!canSend}
                className="notion-send col-start-3 row-start-2"
                aria-label={t("Send message")}
              >
                <ArrowUp size={24} strokeWidth={2.1} />
              </button>
            </div>
            {!!files.length && <div id="attachment-limits" className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1 text-xs text-[var(--notion-muted)]">
              {!!files.length && <span role="status">{t("{count}/{max} attached", { count: files.length, max: MAX_UPLOAD_FILES })} · {formatUploadSize(files.reduce((sum, { file }) => sum + file.size, 0))}</span>}
            </div>}
            {uploadProgress && <div role="status" className="mt-2 px-1 text-xs text-[var(--notion-muted)]">{typeof uploadProgress === "string" ? t(uploadProgress) : t(uploadProgress.key, uploadProgress.vars)}</div>}
          </form>
          <AttachSheet
            open={attachSheetOpen && isNarrowScreen}
            onClose={() => setAttachSheetOpen(false)}
            onFilesChange={handleFileSelect}
            imageMode={imageGenerationMode}
            onToggleImageMode={() => setImageGenerationMode((current) => !current)}
          />
        </div>
        </div>
      </section>

      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} view={workspaceView}
        onOpenChat={(id, messageId) => void openChatFromLink(id, messageId)} onOpenNote={openNoteFromLink}
        projects={chatProjects} currentProjectId={activeSession?.projectId ?? null} />
      {historyQueue && historyNoteId && (
        <NoteHistoryDialog key={historyNoteId} noteId={historyNoteId} getVersion={() => historyQueue.version} flush={() => historyQueue.flush()}
          onRestored={() => setHistoryNoteId(null)} onClose={() => setHistoryNoteId(null)} />
      )}
    </main>
  );
}
