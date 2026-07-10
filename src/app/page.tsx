"use client";

import {
  ArrowDown,
  ArrowUp,
  ExternalLink,
  Globe2,
  ImagePlus,
  Loader2,
  Menu,
  MessageSquare,
  Paperclip,
  PanelLeft,
  Plus,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChatMessage } from "@/components/chat-message";
import { ModelSelect } from "@/components/model-controls";
import { StudyMateLogo } from "@/components/studymate-logo";
import { isImageMimeType } from "@/lib/client-files";
import { DEFAULT_MODEL, getModelOption } from "@/lib/models";
import { formatTranscriptForNotion } from "@/lib/notion-transcript";
import { getSubmissionValidationError } from "@/lib/submission-validation";
import type { ImageGenerationResult, Message, Session, UploadFile } from "@/types/chat";

const INPUT_RESTORE_GUARD_MS = 5000;
const NEW_SESSION_MESSAGES_KEY = "__new_session__";
const SESSION_CREATE_FALLBACK_ERROR = "Database is unavailable. Start local PostgreSQL and try again.";
const NOTION_SAVE_FALLBACK_ERROR = "Failed to save to Notion.";

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

function parseTextStreamLine(line: string) {
  // チャット API は SSE 形式。data には JSON 文字列化した本文差分だけを入れる。
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return "";

  const payload = trimmed.replace(/^data:\s*/, "");
  if (!payload || payload === "[DONE]") return "";

  return JSON.parse(payload) as string;
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
  // GPT の通常チャットで OpenAI Web 検索ツールを使うかどうか。
  const [webSearchMode, setWebSearchMode] = useState(false);
  // 入力欄を狭めないよう、Chat/Search/Image は一つのモードメニューにまとめる。
  const [modeMenuOpen, setModeMenuOpen] = useState(false);
  // 送信前に選択されている添付ファイル。画像の場合は previewUrl も持つ。
  const [files, setFiles] = useState<UploadFile[]>([]);
  // 会話ごとのストリーム開始時刻。複数会話を並行生成できるよう、会話キー別に持つ。
  const [streamingSessions, setStreamingSessions] = useState<Record<string, number>>({});
  // 経過秒数を再計算するための現在時刻。ストリーミング中だけ interval で更新する。
  const [now, setNow] = useState(() => Date.now());
  // モバイル表示でサイドバーのオーバーレイを開いているかどうか。
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // デスクトップ表示でサイドバー自体を表示するかどうか。
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // 最下部にいる時は手動スクロールボタンを隠す。
  const [isAtChatBottom, setIsAtChatBottom] = useState(true);
  // Notion へ保存する前にユーザーが編集できる下書きパネル。
  const [notionDraftOpen, setNotionDraftOpen] = useState(false);
  // Notion ページタイトル。会話タイトルを初期値にし、手動メモにも使える。
  const [notionTitle, setNotionTitle] = useState("");
  // Notion へ送る本文。会話全文を初期値にするが、自由に貼り替えられる。
  const [notionContent, setNotionContent] = useState("");
  // Notion 保存中の二重送信を防ぐ。
  const [notionSaving, setNotionSaving] = useState(false);
  // Notion 保存エラーを下書きパネル内に表示する。
  const [notionError, setNotionError] = useState("");
  // 保存成功後に Notion ページを開けるよう URL を保持する。
  const [notionUrl, setNotionUrl] = useState("");
  // 会話本文のスクロール領域。手動で最下部へ移動するボタンだけで使う。
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  // ストリーム処理中の古いクロージャを避けるため、現在のセッション ID を ref にも保持する。
  const activeSessionIdRef = useRef<string | null>(null);
  // 会話ごとの表示中メッセージ。ストリーミング中に別会話へ移動しても一時表示を失わない。
  const sessionMessagesRef = useRef<Record<string, Message[]>>({});
  // 会話ごとの生成状態。切り替え時にDB履歴で上書きしないために使う。
  const streamingSessionsRef = useRef<Record<string, number>>({});
  // アンマウント時のクリーンアップで最新の添付一覧を参照するための ref。
  const filesRef = useRef<UploadFile[]>([]);
  // 送信直後の古い入力イベントで本文が戻らないよう、DOM 側も直接空にする。
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // モードメニューの外側クリック判定に使う。
  const modeMenuRef = useRef<HTMLDivElement | null>(null);
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
  const inputPlaceholder = imageGenerationMode
    ? "作りたい画像を入力"
    : webSearchMode
      ? "Webで調べたいことを入力"
      : "メッセージを入力";
  const activeInputMode = imageGenerationMode
    ? { icon: ImagePlus, label: "Image" }
    : webSearchMode
      ? { icon: Globe2, label: "WebSearch" }
      : { icon: MessageSquare, label: "Chat" };
  const ActiveInputModeIcon = activeInputMode.icon;

  useEffect(() => {
    // メニューを開いた時だけ外側クリックを監視し、通常時のイベント数を増やさない。
    function closeModeMenuOnOutsideClick(event: MouseEvent) {
      if (!modeMenuRef.current?.contains(event.target as Node)) {
        setModeMenuOpen(false);
      }
    }

    if (modeMenuOpen) {
      document.addEventListener("mousedown", closeModeMenuOnOutsideClick);
    }

    return () => document.removeEventListener("mousedown", closeModeMenuOnOutsideClick);
  }, [modeMenuOpen]);

  function chooseInputMode(nextMode: "chat" | "search" | "image") {
    setImageGenerationMode(nextMode === "image");
    setWebSearchMode(nextMode === "search");
    setModeMenuOpen(false);
  }

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

  async function fetchSessionMessages(sessionId: string) {
    const response = await fetch(`/api/sessions/${sessionId}/messages`, {
      cache: "no-store",
    });

    if (!response.ok) return null;

    const data = await readJsonObject(response);
    return Array.isArray(data.messages) ? (data.messages as Message[]) : [];
  }

  async function refreshSessionMessages(sessionId: string) {
    const fetchedMessages = await fetchSessionMessages(sessionId);
    if (!fetchedMessages) return false;

    replaceCachedMessages(sessionId, fetchedMessages);
    return true;
  }

  function changeModel(nextModel: string) {
    // モデルごとに使える機能が違うため、選択変更時に UI の状態も合わせて正規化する。
    // 画像非対応モデルへ切り替えた場合は、画像生成モードと画像添付を先に落として送信時の不整合を避ける。
    const option = getModelOption(nextModel);
    setModel(option.id);
    if (!option.supportsImageGeneration) {
      setImageGenerationMode(false);
    }
    if (!option.supportsWebSearch) {
      setWebSearchMode(false);
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
    const response = await fetch("/api/sessions", { cache: "no-store" });
    // API は { sessions } を返す想定。欠けていても画面が壊れないよう空配列に倒す。
    const data = await readJsonObject(response);
    setSessions(Array.isArray(data.sessions) ? (data.sessions as Session[]) : []);
  }

  async function createEmptySession() {
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
  }

  async function loadMessages(sessionId: string) {
    if (streamingSessionsRef.current[sessionId]) {
      // 生成中の会話はDB保存前の差分を持つため、ローカル表示を優先する。
      setMessages(sessionMessagesRef.current[sessionId] ?? []);
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      setSidebarOpen(false);
      return;
    }

    const fetchedMessages = await fetchSessionMessages(sessionId);
    if (!fetchedMessages) return;

    // 取得した履歴を表示対象にし、現在のセッション ID とモバイルサイドバーを更新する。
    replaceCachedMessages(sessionId, fetchedMessages);
    activeSessionIdRef.current = sessionId;
    setActiveSessionId(sessionId);
    setMessages(fetchedMessages);
    setSidebarOpen(false);
  }

  async function createSession() {
    // 空の新規チャットがすでに表示されている場合は、DB 上に同じ空セッションを増やさない。
    // 実際にユーザーが送信した時点で、その会話にタイトルが付き履歴として意味を持つ。
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if ((!activeSessionId || activeSession?.title === "New chat") && messages.length === 0) {
      setSidebarOpen(false);
      return;
    }

    const { error, session } = await createEmptySession();
    if (!session) {
      setSendError(error || SESSION_CREATE_FALLBACK_ERROR);
      return;
    }
    setSendError("");
    setSessions((current) => [session, ...current]);
    replaceCachedMessages(session.id, []);
    activeSessionIdRef.current = session.id;
    setActiveSessionId(session.id);
    setMessages([]);
    setSidebarOpen(false);
  }

  async function deleteSession(sessionId: string) {
    // 削除 API はサーバー側で現在ユーザーの所有セッションか確認する。
    const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    if (!response.ok) return;
    // サイドバーから対象セッションを即座に消す。
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    const nextMessagesBySession = { ...sessionMessagesRef.current };
    delete nextMessagesBySession[sessionId];
    sessionMessagesRef.current = nextMessagesBySession;
    if (activeSessionId === sessionId) {
      // 表示中のセッションを削除した場合は、新規チャット状態へ戻す。
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

  function openNotionDraft() {
    // 現在表示中の会話を初期値にする。空なら自由入力用の空下書きを開く。
    setNotionTitle(activeTitle);
    setNotionContent(formatTranscriptForNotion(messages));
    setNotionError("");
    setNotionUrl("");
    setNotionDraftOpen(true);
  }

  async function saveNotionDraft() {
    const title = notionTitle.trim();
    const content = notionContent.trim();

    if (!title || !content || notionSaving) {
      setNotionError("Title and content are required.");
      return;
    }

    setNotionSaving(true);
    setNotionError("");
    setNotionUrl("");

    try {
      const response = await fetch("/api/notion/pages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          content,
          sessionId: activeSessionId ?? undefined,
        }),
      });
      const data = await readJsonObject(response);

      if (!response.ok) {
        setNotionError(readErrorMessage(data, NOTION_SAVE_FALLBACK_ERROR));
        return;
      }

      setNotionUrl(typeof data.url === "string" ? data.url : "");
    } catch {
      setNotionError(NOTION_SAVE_FALLBACK_ERROR);
    } finally {
      setNotionSaving(false);
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();

    const submittedInputValue = inputRef.current?.value ?? input;
    const userContent = submittedInputValue.trim();
    const submittedFiles = files;
    let requestSessionId = activeSessionId;
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

    startStreamingSession(requestSessionKey, new Date().getTime());

    // 通常チャット API は multipart/form-data を受けるため、本文・モデル設定・添付を FormData に詰める。
    const body = new FormData();
    body.append("message", userContent);
    body.append("model", model);
    body.append("reasoning", reasoning);
    body.append("webSearch", String(webSearchMode && selectedModel.supportsWebSearch));
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

        for (const eventText of events) {
          const chunk = eventText
            .split(/\r?\n/)
            .map(parseTextStreamLine)
            .join("");

          if (!chunk) continue;

          // chunk は AI が追加で生成した本文の差分。既存 content の末尾へ連結する。
          updateCachedMessages(requestSessionKey, (current) =>
            current.map((message) =>
              message.id === assistantMessageId
                ? { ...message, content: message.content + chunk }
                : message,
            ),
          );
        }
      }

      await loadSessions();
      if (resolvedSessionId) {
        shouldCleanupSubmittedPreviews = await refreshSessionMessages(resolvedSessionId);
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
    return () => revokeUploadPreviews(filesRef.current);
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

  // デスクトップでは常設、モバイルではオーバーレイとして再利用するサイドバー UI。
  const sidebar = (
    <aside className="flex h-full w-72 shrink-0 flex-col bg-[#f8fafd]">
      <div className="flex h-16 items-center justify-between px-4">
        <StudyMateLogo />
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-slate-200 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98]"
          onClick={() => {
            if (window.matchMedia("(min-width: 1024px)").matches) {
              setSidebarVisible(false);
            } else {
              setSidebarOpen(false);
            }
          }}
          aria-label="Close sidebar"
          title="Toggle sidebar (Ctrl+B)"
        >
          <PanelLeft size={21} strokeWidth={1.8} />
        </button>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          onClick={createSession}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#e9e7e5] px-4 text-sm font-semibold text-slate-950 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-[#dfdddb] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:translate-y-0 active:scale-[0.98]"
        >
          <Plus size={17} />
          New chat
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-4">
        {sessions.length === 0 ? (
          <div className="px-3 py-6 text-sm text-slate-500">No sessions yet.</div>
        ) : (
          sessions.map((session) => (
            <div
              key={session.id}
              className={`group mb-1 flex items-center gap-1 rounded-full transition-[background-color,transform] duration-150 ease-out ${
                activeSessionId === session.id ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
              }`}
            >
              <button
                onClick={() => loadMessages(session.id)}
                className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm font-medium text-slate-800 transition-colors duration-150 ease-out hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300/60 active:scale-[0.99]"
                title={session.title}
              >
                {session.title}
              </button>
              <button
                onClick={() => deleteSession(session.id)}
                className="mr-1 grid h-8 w-8 place-items-center rounded-full text-slate-600 opacity-0 transition-[background-color,color,opacity,transform] duration-150 ease-out hover:bg-white/70 hover:text-red-600 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-200 active:scale-[0.96] group-hover:opacity-100"
                aria-label="Delete session"
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))
        )}
      </div>
    </aside>
  );

  // メッセージがない時は中央を空け、入力フォームを下部に大きく見せる。
  const emptyState = messages.length === 0;

  return (
    <main className="flex h-dvh bg-white text-slate-900">
      {sidebarVisible && <div className="motion-desktop-sidebar hidden lg:block">{sidebar}</div>}

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="motion-fade-in absolute inset-0 bg-slate-950/30"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar overlay"
          />
          <div className="motion-sidebar-panel relative h-full w-72">{sidebar}</div>
        </div>
      )}

      <section
        className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[#f7ffff] bg-[url(/chat-gradient-background.png)] bg-cover bg-center bg-no-repeat"
      >
        <header
          className={`relative z-10 flex h-16 items-center justify-between px-4 ${
            emptyState ? "" : "border-b border-slate-200"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="grid h-10 w-10 place-items-center rounded-full text-slate-600 transition-[background-color,color,transform] duration-150 ease-out hover:bg-[#e9e7e5] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={20} />
            </button>
            {!sidebarVisible && (
              <button
                type="button"
                className="hidden h-10 w-10 place-items-center rounded-full text-slate-600 transition-[background-color,color,transform] duration-150 ease-out hover:bg-[#e9e7e5] hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] lg:grid"
                onClick={() => setSidebarVisible(true)}
                aria-label="Open sidebar"
                title="Toggle sidebar (Ctrl+B)"
              >
                <PanelLeft size={22} strokeWidth={1.8} />
              </button>
            )}
            <div className={`min-w-0 ${emptyState ? "hidden" : ""}`}>
              <div className="truncate text-sm font-semibold text-slate-900">{activeTitle}</div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <div className={`text-xs font-semibold text-slate-500 ${emptyState ? "hidden" : ""}`}>
              {selectedModel.label}
            </div>
            <button
              type="button"
              onClick={openNotionDraft}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white/80 px-3 text-xs font-semibold text-slate-700 ring-1 ring-slate-200 transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-white hover:text-slate-950 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:translate-y-0 active:scale-[0.98]"
              aria-label="Open Notion draft"
              title="Save to Notion"
            >
              <UploadCloud size={15} />
              <span className="hidden sm:inline">Notion</span>
            </button>
          </div>
        </header>

        {notionDraftOpen && (
          <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/30">
            <button
              type="button"
              className="absolute inset-0 cursor-default"
              onClick={() => setNotionDraftOpen(false)}
              aria-label="Close Notion draft"
            />
            <aside className="motion-sidebar-panel relative z-10 flex h-full w-full max-w-xl flex-col bg-white shadow-[0_24px_70px_rgba(15,23,42,0.24)]">
              <div className="flex h-16 items-center justify-between border-b border-slate-200 px-5">
                <div>
                  <div className="text-sm font-semibold text-slate-950">Save to Notion</div>
                  <div className="text-xs text-slate-500">Edit or paste anything before saving.</div>
                </div>
                <button
                  type="button"
                  onClick={() => setNotionDraftOpen(false)}
                  className="grid h-9 w-9 place-items-center rounded-full text-slate-500 transition-[background-color,color,transform] duration-150 ease-out hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.96]"
                  aria-label="Close Notion draft"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
                <label className="grid gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Title
                  </span>
                  <input
                    value={notionTitle}
                    onChange={(event) => setNotionTitle(event.target.value)}
                    className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-950 outline-none transition-[border-color,box-shadow] duration-150 ease-out focus:border-sky-300 focus:shadow-[0_0_0_3px_rgba(125,211,252,0.28)]"
                    placeholder="Notion page title"
                  />
                </label>

                <label className="grid min-h-0 flex-1 gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                    Content
                  </span>
                  <textarea
                    value={notionContent}
                    onChange={(event) => setNotionContent(event.target.value)}
                    className="min-h-[22rem] flex-1 resize-none rounded-xl border border-slate-200 px-3 py-3 text-sm leading-6 text-slate-950 outline-none transition-[border-color,box-shadow] duration-150 ease-out focus:border-sky-300 focus:shadow-[0_0_0_3px_rgba(125,211,252,0.28)]"
                    placeholder="Paste or edit the note to save."
                  />
                </label>

                {notionError && (
                  <div className="rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-100">
                    {notionError}
                  </div>
                )}

                {notionUrl && (
                  <a
                    href={notionUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-700 ring-1 ring-emerald-100 transition-[background-color,transform] duration-150 ease-out hover:bg-emerald-100 active:scale-[0.99]"
                  >
                    Saved to Notion
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
                <button
                  type="button"
                  onClick={() => setNotionDraftOpen(false)}
                  className="h-10 rounded-full px-4 text-sm font-semibold text-slate-600 transition-[background-color,color,transform] duration-150 ease-out hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={saveNotionDraft}
                  disabled={notionSaving || !notionTitle.trim() || !notionContent.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-full bg-sky-300 px-4 text-sm font-semibold text-slate-950 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-sky-400 hover:shadow-[0_8px_20px_rgba(14,165,233,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:translate-y-0"
                >
                  {notionSaving && <Loader2 size={16} className="animate-spin" />}
                  Save to Notion
                </button>
              </div>
            </aside>
          </div>
        )}

        <div ref={chatScrollRef} className="relative z-0 flex-1 overflow-y-auto">
          <div
            className={`mx-auto flex min-h-full w-full max-w-6xl flex-col px-4 sm:px-6 lg:px-10 ${
              emptyState ? "items-center justify-center pb-44 pt-16" : "py-8"
            }`}
          >
            {emptyState ? (
              <div className="flex-1" />
            ) : (
              <div className="space-y-8">
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
            )}
          </div>
        </div>

        <div
          className={`relative z-10 px-4 py-4 ${
            emptyState
              ? "absolute bottom-0 left-0 right-0 pb-6 sm:pb-8"
              : ""
          }`}
        >
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
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-slate-500 shadow-[0_8px_24px_rgba(15,23,42,0.16)] ring-1 ring-slate-200 transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-slate-50 hover:text-slate-900 hover:shadow-[0_10px_28px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:translate-y-0 active:scale-[0.96]"
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
            >
              <ArrowDown size={20} strokeWidth={2.1} />
            </button>
          </div>
          {sendError && (
            <div
              className="mx-auto mb-3 max-w-4xl rounded-2xl bg-red-50 px-4 py-2 text-sm font-medium text-red-700 ring-1 ring-red-100"
              role="alert"
            >
              {sendError}
            </div>
          )}
          <form onSubmit={sendMessage} className="mx-auto max-w-4xl">
            {!!files.length && (
              <div className="mb-3 flex flex-wrap gap-2">
                {files.map(({ id, file, previewUrl }) =>
                  previewUrl ? (
                    <div key={id} className="group motion-menu relative h-28 w-28 overflow-hidden rounded-[1.4rem]">
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
                        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white transition-[background-color,transform] duration-150 ease-out hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 active:scale-[0.94]"
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
                      className="motion-menu inline-flex max-w-full items-center gap-2 rounded-full bg-[#e9e7e5] px-3 py-1.5 text-xs font-medium text-slate-700 transition-[background-color,color,transform] duration-150 ease-out hover:bg-[#dfdddb] hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98]"
                    >
                      <Paperclip size={13} />
                      <span className="truncate">{file.name}</span>
                      <X size={13} />
                    </button>
                  ),
                )}
              </div>
            )}

            <div className="grid min-h-20 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2 rounded-[1.75rem] border border-slate-100 bg-white px-4 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.16)] transition-[border-color,box-shadow] duration-150 ease-out focus-within:border-slate-200 focus-within:shadow-[0_14px_36px_rgba(15,23,42,0.18)] sm:flex sm:gap-2 sm:rounded-[2rem] sm:px-5">
              <label className="col-start-1 row-start-2 grid h-9 w-9 shrink-0 cursor-pointer place-items-center text-slate-950 transition-[color,transform] duration-150 ease-out hover:text-blue-600 focus-within:outline-none focus-within:ring-2 focus-within:ring-sky-300/60 active:scale-[0.96] sm:row-start-1 sm:h-11 sm:w-8">
                <Plus size={30} strokeWidth={1.8} />
                <input
                  type="file"
                  multiple
                  className="sr-only"
                  onChange={(event) => {
                    const selectedFiles = Array.from(event.target.files ?? []);
                    const allowedFiles = selectedModel.supportsImageInput
                      ? selectedFiles
                      : selectedFiles.filter(
                          (file) => !isImageMimeType(file.type || "application/octet-stream"),
                        );
                    const selected = allowedFiles.map(createUploadFile);
                    setFiles((current) => [...current, ...selected]);
                    event.target.value = "";
                  }}
                />
              </label>
              <div className="col-span-2 row-start-1 flex min-w-0 items-center sm:col-span-1 sm:flex-1">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => changeInput(event.target.value, event.currentTarget)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  rows={1}
                  placeholder={inputPlaceholder}
                  className="max-h-40 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-1 py-2 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-500 sm:min-h-11 sm:py-2.5"
                />
              </div>
              <div className="col-span-2 col-start-2 row-start-2 flex min-w-0 flex-wrap items-center justify-start gap-1 sm:col-span-1 sm:col-start-auto sm:shrink-0 sm:flex-nowrap">
                <ModelSelect
                  value={model}
                  reasoning={reasoning}
                  onModelChange={changeModel}
                  onReasoningChange={setReasoning}
                />
                <div ref={modeMenuRef} className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setModeMenuOpen((current) => !current)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#f1f5f9] px-3 text-xs font-medium text-slate-900 transition-[background-color,box-shadow,transform] duration-150 ease-out hover:bg-[#e9e7e5] hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.98] sm:h-10 sm:text-sm"
                    aria-haspopup="menu"
                    aria-expanded={modeMenuOpen}
                  >
                    <ActiveInputModeIcon size={15} />
                    <span>{activeInputMode.label}</span>
                  </button>
                  {modeMenuOpen && (
                    <div
                      className="motion-menu fixed bottom-28 left-1/2 z-30 w-64 -translate-x-1/2 overflow-hidden rounded-2xl bg-white py-1 shadow-[0_16px_42px_rgba(15,23,42,0.18)] ring-1 ring-slate-200 sm:absolute sm:bottom-full sm:left-auto sm:right-0 sm:mb-3 sm:w-56 sm:translate-x-0 sm:rounded-[1.35rem]"
                      role="menu"
                    >
                      <div className="space-y-0.5 p-1.5">
                        <button
                          type="button"
                          onClick={() => chooseInputMode("chat")}
                          className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.99] ${
                            !imageGenerationMode && !webSearchMode
                              ? "bg-[#e9e7e5] text-slate-950"
                              : "text-slate-700 hover:bg-[#f1f0ef] hover:text-slate-950"
                          }`}
                          role="menuitemradio"
                          aria-checked={!imageGenerationMode && !webSearchMode}
                        >
                          <MessageSquare size={16} />
                          <span>Chat</span>
                        </button>
                        {selectedModel.supportsWebSearch && (
                          <button
                            type="button"
                            onClick={() => chooseInputMode("search")}
                            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.99] ${
                              webSearchMode && !imageGenerationMode
                                ? "bg-[#e9e7e5] text-slate-950"
                                : "text-slate-700 hover:bg-[#f1f0ef] hover:text-slate-950"
                            }`}
                            role="menuitemradio"
                            aria-checked={webSearchMode && !imageGenerationMode}
                          >
                            <Globe2 size={16} />
                            <span>WebSearch</span>
                          </button>
                        )}
                        {selectedModel.supportsImageGeneration && (
                          <button
                            type="button"
                            onClick={() => chooseInputMode("image")}
                            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-[background-color,color,transform] duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/60 active:scale-[0.99] ${
                              imageGenerationMode
                                ? "bg-[#e9e7e5] text-slate-950"
                                : "text-slate-700 hover:bg-[#f1f0ef] hover:text-slate-950"
                            }`}
                            role="menuitemradio"
                            aria-checked={imageGenerationMode}
                          >
                            <ImagePlus size={16} />
                            <span>Image</span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <button
                type="submit"
                disabled={!canSend}
                className="col-start-3 row-start-1 grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sky-300 text-slate-950 transition-[background-color,color,box-shadow,transform] duration-150 ease-out hover:-translate-y-0.5 hover:bg-sky-400 hover:shadow-[0_8px_20px_rgba(14,165,233,0.25)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 active:translate-y-0 active:scale-[0.96] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:scale-100 sm:h-11 sm:w-11"
                aria-label="Send message"
              >
                <ArrowUp size={24} strokeWidth={2.1} />
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
