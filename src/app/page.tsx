"use client";

import {
  ArrowDown,
  ArrowUp,
  FileText,
  ImagePlus,
  Menu,
  Paperclip,
  PanelLeft,
  Plus,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChatSidebar } from "@/components/chat-sidebar";
import { ChatMessage } from "@/components/chat-message";
import { EmptyConversation } from "@/components/empty-conversation";
import { AttachSheet } from "@/components/attach-sheet";
import { ModelSelect } from "@/components/model-controls";
import { NotesSidebar } from "@/components/notes-sidebar";
import type { WorkspaceView } from "@/components/workspace-nav";
import { NotesWorkspace } from "@/components/notes-workspace";
import { useNotePages } from "@/lib/use-note-pages";
import { applyActivityEvent, type ActivityEvent } from "@/lib/chat-activity";
import { getClipboardImageFiles, isImageMimeType } from "@/lib/client-files";
import { DEFAULT_MODEL, getModelOption } from "@/lib/models";
import { getSubmissionValidationError } from "@/lib/submission-validation";
import { useMediaQuery } from "@/lib/use-media-query";
import type { ImageGenerationResult, Message, Session, UploadFile } from "@/types/chat";

const INPUT_RESTORE_GUARD_MS = 5000;
const NEW_SESSION_MESSAGES_KEY = "__new_session__";
const SESSION_CREATE_FALLBACK_ERROR = "Database is unavailable. Start local PostgreSQL and try again.";
const SESSION_LOAD_FALLBACK_ERROR = "Failed to load conversation.";

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

function parseChatStreamLine(line: string): string | ActivityEvent | null {
  // チャット API は SSE 形式。data は本文差分なら JSON 文字列、途中経過なら { activity } になる。
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;

  const payload = trimmed.replace(/^data:\s*/, "");
  if (!payload || payload === "[DONE]") return null;

  const data = JSON.parse(payload) as string | { activity?: ActivityEvent };
  return typeof data === "string" ? data : (data.activity ?? null);
}

function carryStreamActivity(current: Message[], fetched: Message[], streamedId: string) {
  // 途中経過は DB に保存しないため、履歴を再取得した後も直前の回答には残しておく。
  const streamed = current.find((message) => message.id === streamedId);
  if (!streamed?.activity?.length && streamed?.thinkingMs === undefined) return fetched;

  const lastAssistantIndex = fetched.findLastIndex((message) => message.role === "ASSISTANT");
  return fetched.map((message, index) =>
    index === lastAssistantIndex
      ? { ...message, activity: streamed.activity, thinkingMs: streamed.thinkingMs }
      : message,
  );
}

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

export default function Home() {
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("chat");
  const notes = useNotePages(workspaceView === "pages");

  useEffect(() => {
    function syncWorkspace() {
      setWorkspaceView(new URL(window.location.href).searchParams.get("view") === "pages" ? "pages" : "chat");
    }
    queueMicrotask(syncWorkspace);
    window.addEventListener("popstate", syncWorkspace);
    return () => window.removeEventListener("popstate", syncWorkspace);
  }, []);

  function changeWorkspace(view: WorkspaceView) {
    if (view === workspaceView) return;
    setWorkspaceView(view);
    setSidebarOpen(false);
    const url = new URL(window.location.href);
    if (view === "pages") {
      url.searchParams.set("view", "pages");
      if (notes.activeId) url.searchParams.set("page", notes.activeId);
    }
    else url.searchParams.delete("view");
    // モバイルのドロワーが履歴に積んだ目印がある場合は、その履歴を置き換えて、戻る操作で空振りする履歴を残さない。
    if (window.history.state?.studymateDrawer || window.history.state?.studymateSheet) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    if (view === "chat") void notes.active?.flush();
  }

  // 左サイドバーに表示するチャットセッション一覧。
  const [sessions, setSessions] = useState<Session[]>([]);
  // 現在表示しているセッション ID。未保存の新規チャットでは null になる。
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // 画面中央に表示する会話メッセージ。送信直後の楽観表示もここに入る。
  const [messages, setMessages] = useState<Message[]>([]);
  // 入力欄のテキスト。送信時に trim して API へ渡す。
  const [input, setInput] = useState("");
  // 送信前のセッション作成など、会話に紐づかない失敗を入力欄の近くに出す。
  const [sendError, setSendError] = useState("");
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
  useEffect(() => {
    if (!sidebarOpen) return;

    window.history.pushState({ studymateDrawer: true }, "");
    let closedByBack = false;
    function onBack() {
      closedByBack = true;
      setSidebarOpen(false);
    }
    window.addEventListener("popstate", onBack, { once: true });
    // 画面を広げてデスクトップ表示になったら、見えなくなったドロワーの履歴が残らないよう閉じる。
    const desktop = window.matchMedia("(min-width: 1024px)");
    function onResize() {
      if (desktop.matches) setSidebarOpen(false);
    }
    desktop.addEventListener("change", onResize);

    return () => {
      window.removeEventListener("popstate", onBack);
      desktop.removeEventListener("change", onResize);
      // 画面のボタンなどで閉じた場合は、積んでおいた履歴を取り除く。
      if (!closedByBack && window.history.state?.studymateDrawer) window.history.back();
    };
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
  // 送信可能条件。空文字と現在会話のストリーミング中は送信ボタンを無効にする。
  const canSend = input.trim().length > 0 && !isActiveSessionStreaming;
  // モデル ID から、対応機能や表示名をまとめた設定を引く。
  const selectedModel = getModelOption(model);
  // 狭い画面（スマホ）では、提示文が折り返して切れないよう短くする。
  const isNarrowScreen = useMediaQuery("(max-width: 639px)");
  const inputPlaceholder = imageGenerationMode
    ? "Describe an image to create..."
    : isNarrowScreen
      ? "Ask anything..."
      : "Ask anything — StudyMate searches when needed...";

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

      if (!response.ok) return null;

      const data = await readJsonObject(response);
      return Array.isArray(data.messages) ? (data.messages as Message[]) : [];
    } catch {
      return null;
    }
  }

  async function refreshSessionMessages(sessionId: string, streamedAssistantId?: string) {
    const fetchedMessages = await fetchSessionMessages(sessionId);
    if (!fetchedMessages) return false;

    replaceCachedMessages(
      sessionId,
      streamedAssistantId
        ? carryStreamActivity(sessionMessagesRef.current[sessionId] ?? [], fetchedMessages, streamedAssistantId)
        : fetchedMessages,
    );
    return true;
  }

  function handleFileSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const selectedFiles = Array.from(event.target.files ?? []);
    const allowedFiles = selectedModel.supportsImageInput
      ? selectedFiles
      : selectedFiles.filter((file) => !isImageMimeType(file.type || "application/octet-stream"));
    const selected = allowedFiles.map(createUploadFile);
    setFiles((current) => [...current, ...selected]);
    event.target.value = "";
  }

  function changeModel(nextModel: string) {
    // モデルごとに使える機能が違うため、選択変更時に UI の状態も合わせて正規化する。
    // 画像非対応モデルへ切り替えた場合は、画像生成モードと画像添付を先に落として送信時の不整合を避ける。
    const option = getModelOption(nextModel);
    setModel(option.id);
    if (!option.supportsImageGeneration) {
      setImageGenerationMode(false);
    }
    if (!option.supportsImageInput) {
      setFiles((current) => {
        const blocked = current.filter(({ file }) =>
          isImageMimeType(file.type || "application/octet-stream"),
        );
        revokeUploadPreviews(blocked);
        return current.filter(({ file }) =>
          !isImageMimeType(file.type || "application/octet-stream"),
        );
      });
    }
    setReasoning((current) =>
      option.reasoningEfforts.includes(current as never)
        ? current
        : option.defaultReasoning,
    );
  }

  async function loadSessions() {
    // cache: no-store にして、直前に作成・更新されたセッション一覧を常に取りに行く。
    try {
      const response = await fetch("/api/sessions", { cache: "no-store" });
      if (!response.ok) return false;

      const data = await readJsonObject(response);
      if (!Array.isArray(data.sessions)) return false;

      setSessions(data.sessions as Session[]);
      return true;
    } catch {
      // 一時的な同期失敗では、現在表示している一覧を消さない。
      return false;
    }
  }

  async function createEmptySession() {
    try {
      const response = await fetch("/api/sessions", { method: "POST" });
      const data = await readJsonObject(response);
      if (!response.ok) {
        return {
          error: readErrorMessage(data, SESSION_CREATE_FALLBACK_ERROR),
          session: null,
        };
      }

      return {
        error: "",
        session: (data.session as Session | undefined) ?? null,
      };
    } catch {
      return {
        error: SESSION_CREATE_FALLBACK_ERROR,
        session: null,
      };
    }
  }

  async function loadMessages(sessionId: string) {
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
      !fetchedMessages ||
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
        setSendError(SESSION_LOAD_FALLBACK_ERROR);
      }
      return;
    }

    // 最新の選択に対応する履歴だけを表示へ反映する。
    replaceCachedMessages(sessionId, fetchedMessages);
    if (sessionLoadAbortRef.current === controller) {
      sessionLoadAbortRef.current = null;
    }
  }

  async function createSession() {
    // 空の新規チャットがすでに表示されている場合は、DB 上に同じ空セッションを増やさない。
    // 実際にユーザーが送信した時点で、その会話にタイトルが付き履歴として意味を持つ。
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if ((!activeSessionId || activeSession?.title === "New chat") && messages.length === 0) {
      setSidebarOpen(false);
      return;
    }

    const intent = sessionNavigationIntentRef.current + 1;
    sessionNavigationIntentRef.current = intent;
    sessionLoadAbortRef.current?.abort();
    const { error, session } = await createEmptySession();
    if (!session) {
      setSendError(error || SESSION_CREATE_FALLBACK_ERROR);
      return;
    }
    setSendError("");
    setSessions((current) => [session, ...current]);
    replaceCachedMessages(session.id, []);
    if (sessionNavigationIntentRef.current !== intent) return;

    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setMessages([]);
    setSidebarOpen(false);
  }

  async function deleteSession(sessionId: string) {
    // 削除 API はサーバー側で現在ユーザーの所有セッションか確認する。
    let response: Response;
    try {
      response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    } catch {
      setSendError("Failed to delete conversation.");
      return;
    }
    if (!response.ok) return;
    // サイドバーから対象セッションを即座に消す。
    setSessions((current) => current.filter((session) => session.id !== sessionId));
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
  }

  function removeUploadFile(fileId: string) {
    setFiles((current) => {
      // 削除対象を探し、画像プレビュー URL があれば先に解放する。
      const target = current.find((item) => item.id === fileId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((item) => item.id !== fileId);
    });
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
      streamingSessionsRef.current[requestSessionKey] ||
      submittingSessionKeysRef.current.has(requestSessionKey)
    ) {
      return;
    }

    const validationError = getSubmissionValidationError({
      imageGenerationMode,
      modelLabel: selectedModel.label,
      supportsImageGeneration: selectedModel.supportsImageGeneration,
      fileMimeTypes: submittedFiles.map((item) => item.file.type),
    });
    if (validationError) {
      setSendError(validationError);
      return;
    }

    setSendError("");
    submittingSessionKeysRef.current.add(requestSessionKey);

    if (!requestSessionId) {
      // 未保存の新規チャットは送信開始前に実セッション化する。
      // 画像生成も完了待ちにならず、他セッションと同じ単位で並行管理できる。
      const { error, session } = await createEmptySession();
      if (!session) {
        setSendError(error || SESSION_CREATE_FALLBACK_ERROR);
        submittingSessionKeysRef.current.delete(initialRequestSessionKey);
        return;
      }

      requestSessionId = session.id;
      requestSessionKey = session.id;
      submittingSessionKeysRef.current.add(requestSessionKey);
      setSessions((current) =>
        current.some((item) => item.id === session.id) ? current : [session, ...current],
      );
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

    // 通常チャット API は multipart/form-data を受けるため、本文・モデル設定・添付を FormData に詰める。
    const body = new FormData();
    body.append("message", userContent);
    body.append("model", model);
    body.append("reasoning", reasoning);
    if (requestSessionId) body.append("sessionId", requestSessionId);
    submittedFiles.forEach(({ file }) => body.append("files", file));

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
        submittedFiles.forEach(({ file }) => imageBody.append("files", file));
        // 画像生成 API は完成画像だけを JSON で返す。
        const response = await fetch("/api/images", {
          method: "POST",
          body: imageBody,
        });

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to generate image.");
        }

        const event = (await response.json()) as ImageGenerationResult;
        let completedSessionId = requestSessionId;

        if (event.error) {
          throw new Error(event.error);
        }

        if (!event.image?.dataUrl) {
          throw new Error("Failed to generate image.");
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
        throw new Error(data.error ?? "Failed to send message.");
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
        shouldCleanupSubmittedPreviews = await refreshSessionMessages(resolvedSessionId, assistantMessageId);
      }
    } catch (error) {
      // ネットワークや上流 API の失敗も、空のアシスタント枠へエラー文として表示する。
      const detail = error instanceof Error ? error.message : "Unknown error.";
      updateCachedMessages(requestSessionKey, (current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: `Request failed: ${detail}` }
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
      finishStreamingSession(requestSessionKey);
      submittingSessionKeysRef.current.delete(initialRequestSessionKey);
      submittingSessionKeysRef.current.delete(requestSessionKey);
    }
  }

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

  // ヘッダーに表示するタイトル。未選択または新規チャット中は固定文言にする。
  const activeTitle = sessions.find((session) => session.id === activeSessionId)?.title ?? "New chat";
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
      onCreate={() => { setSidebarOpen(false); void notes.create(); }} onSelect={(id) => { void notes.select(id); setSidebarOpen(false); }}
      onDelete={notes.remove} onClose={closeSidebar} onWorkspaceChange={changeWorkspace} />
  ) : (
    <ChatSidebar
      sessions={sessions}
      activeSessionId={activeSessionId}
      onCreate={createSession}
      onLoad={loadMessages}
      onDelete={deleteSession}
      onClose={closeSidebar}
      onWorkspaceChange={changeWorkspace}
    />
  );

  // メッセージがない時は中央を空け、入力フォームを下部に大きく見せる。
  const emptyState = messages.length === 0;
  // スマホでは、ホーム画面（空の会話・ノート未選択）では見出しを本文側に出すので、上部バーの標題は会話中・ノート編集中だけ出す。
  const showPhoneTitle = workspaceView === "chat" ? !emptyState : Boolean(notes.active);

  return (
    <main className="notion-workspace flex h-dvh">
      {sidebarVisible && <div className="motion-desktop-sidebar hidden lg:block">{sidebar}</div>}

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="motion-fade-in absolute inset-0 bg-black/15"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar overlay"
          />
          <div className="motion-sidebar-panel relative h-full w-60 max-w-[88vw]">{sidebar}</div>
        </div>
      )}

      <section className="notion-page">
        <header className="notion-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="notion-icon-button mobile-sidebar-toggle"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={20} />
            </button>
            {!sidebarVisible && (
              <button
                type="button"
                className="notion-icon-button desktop-sidebar-toggle"
                onClick={() => setSidebarVisible(true)}
                aria-label="Open sidebar"
                title="Toggle sidebar (Ctrl+B)"
              >
                <PanelLeft size={22} strokeWidth={1.8} />
              </button>
            )}
            <div className={`min-w-0 sm:block ${showPhoneTitle ? "" : "hidden"}`}>
              <div className="flex items-center gap-1.5 text-sm text-[var(--notion-muted)]">
                {workspaceView === "pages" && (notes.active?.content.icon ? <span className="shrink-0 text-[15px] leading-none">{notes.active.content.icon}</span> : <FileText size={15} className="shrink-0" />)}
                <span className="truncate">{workspaceView === "pages" ? notes.active?.content.title || "Notes" : activeTitle}</span>
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {workspaceView === "chat" && !emptyState && (
              <button type="button" className="notion-icon-button grid lg:hidden" onClick={() => void createSession()}
                aria-label="New chat" title="New chat">
                <Plus size={20} />
              </button>
            )}
            {workspaceView === "pages" ? (
              <span role="status" className={`notes-save-status ${notes.active?.status === "error" || notes.active?.status === "conflict" ? "has-error" : ""}`}>
                {notes.active ? ({ saved: "Saved", pending: "Saving…", saving: "Saving…", error: "Not saved", conflict: "Conflict" })[notes.active.status] : ""}
              </span>
            ) : null}
          </div>
        </header>

        <div className={workspaceView === "pages" ? "flex min-h-0 flex-1 flex-col" : "hidden"}>
          <NotesWorkspace notes={notes} onWorkspaceChange={changeWorkspace} />
        </div>

        <div className={workspaceView === "chat" ? "contents" : "hidden"}>
        <div ref={chatScrollRef} className="relative z-0 flex-1 overflow-y-auto">
          <div
            className="notion-page-column flex min-h-full flex-col px-6 pb-12 sm:px-12"
          >
            {emptyState ? (
              <EmptyConversation onWorkspaceChange={changeWorkspace} />
            ) : (
              <>
                <header className="pb-10 pt-12 motion-page-enter max-sm:hidden">
                  <h1 className="break-words text-[2rem] font-bold leading-tight tracking-[-0.025em] text-[var(--notion-text)]">{activeTitle}</h1>
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
            className={`mx-auto mb-2 flex max-w-4xl justify-center transition-[opacity,transform] duration-150 ease-out ${
              !emptyState && !isAtChatBottom
                ? "scale-100 opacity-100"
                : "pointer-events-none scale-95 opacity-0"
            }`}
          >
            <button
              type="button"
              onClick={scrollChatToBottom}
              className="notion-icon-button grid bg-white shadow-[var(--notion-shadow)]"
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
            >
              <ArrowDown size={20} strokeWidth={2.1} />
            </button>
          </div>
          {sendError && (
            <div
              className="notion-error notion-page-column mb-3"
              role="alert"
            >
              {sendError}
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
                        className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded bg-black/55 text-white opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                        aria-label="Remove image"
                      >
                        <X size={15} />
                      </button>
                    </div>
                  ) : (
                    <button
                      key={id}
                      type="button"
                      onClick={() => removeUploadFile(id)}
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
              {isNarrowScreen && selectedModel.supportsImageGeneration ? (
                <button
                  type="button"
                  className="notion-icon-button col-start-1 row-start-2 grid"
                  onClick={() => {
                    (document.activeElement as HTMLElement | null)?.blur();
                    setAttachSheetOpen(true);
                  }}
                  aria-haspopup="dialog"
                  aria-label="Add"
                >
                  <Plus size={18} strokeWidth={1.8} />
                </button>
              ) : (
                <label className="notion-icon-button col-start-1 row-start-2 grid cursor-pointer">
                  <Plus size={18} strokeWidth={1.8} />
                  <input type="file" multiple className="sr-only" onChange={handleFileSelect} />
                </label>
              )}
              <div className="col-span-3 row-start-1 min-w-0">
                {imageGenerationMode && (
                  <button
                    type="button"
                    className="image-mode-chip sm:hidden"
                    onClick={() => setImageGenerationMode(false)}
                    aria-label="Turn off image creation"
                  >
                    <ImagePlus size={16} />
                    <span>Create an image</span>
                    <X size={14} />
                  </button>
                )}
                <div className="flex items-center">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => changeInput(event.target.value, event.currentTarget)}
                  onPaste={(event) => {
                    const pastedImages = getClipboardImageFiles(event.clipboardData.items);
                    if (!pastedImages.length) return;

                    // 画像がある時だけ既定の貼り付けを止め、既存の添付フローへ渡す。
                    event.preventDefault();
                    if (!selectedModel.supportsImageInput) {
                      setSendError(
                        `${selectedModel.label} does not support image uploads. Use GPT-6 Luna for images.`,
                      );
                      return;
                    }

                    setSendError("");
                    setFiles((current) => [
                      ...current,
                      ...pastedImages.map(createUploadFile),
                    ]);
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
                {selectedModel.supportsImageGeneration && (
                  <button
                    type="button"
                    onClick={() => setImageGenerationMode((current) => !current)}
                    className={`notion-composer-control composer-image-toggle shrink-0 ${
                      imageGenerationMode ? "is-active" : ""
                    }`}
                    aria-pressed={imageGenerationMode}
                    aria-label={`${imageGenerationMode ? "Disable" : "Enable"} image generation`}
                  >
                    <ImagePlus size={15} />
                    <span className="hidden sm:inline">Create an image</span>
                  </button>
                )}
              </div>
              <button
                type="submit"
                disabled={!canSend}
                className="notion-send col-start-3 row-start-2"
                aria-label="Send message"
              >
                <ArrowUp size={24} strokeWidth={2.1} />
              </button>
            </div>
          </form>
          <AttachSheet
            open={attachSheetOpen && isNarrowScreen}
            onClose={() => setAttachSheetOpen(false)}
            onFilesChange={handleFileSelect}
            canCreateImage={selectedModel.supportsImageGeneration}
            imageMode={imageGenerationMode}
            onToggleImageMode={() => setImageGenerationMode((current) => !current)}
          />
        </div>
        </div>
      </section>
    </main>
  );
}
