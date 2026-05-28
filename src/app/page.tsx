"use client";

import {
  ArrowDown,
  ArrowUp,
  Globe2,
  ImagePlus,
  Menu,
  Paperclip,
  PanelLeft,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ChatMessage } from "@/components/chat-message";
import { ModelSelect, ReasoningSelect } from "@/components/model-controls";
import { StudyMateLogo } from "@/components/studymate-logo";
import { isImageMimeType } from "@/lib/client-files";
import { DEFAULT_MODEL, getModelOption } from "@/lib/models";
import type { ImageStreamEvent, Message, Session, UploadFile } from "@/types/chat";

const INPUT_RESTORE_GUARD_MS = 5000;

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

function parseImageStreamLine(line: string) {
  // 画像生成 API は NDJSON 形式なので、1 行ごとに空行を除いて JSON として読む。
  const trimmed = line.trim();
  if (!trimmed) return null;

  return JSON.parse(trimmed) as ImageStreamEvent;
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

export default function Home() {
  // 左サイドバーに表示するチャットセッション一覧。
  const [sessions, setSessions] = useState<Session[]>([]);
  // 現在表示しているセッション ID。未保存の新規チャットでは null になる。
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // 画面中央に表示する会話メッセージ。送信直後の楽観表示もここに入る。
  const [messages, setMessages] = useState<Message[]>([]);
  // 入力欄のテキスト。送信時に trim して API へ渡す。
  const [input, setInput] = useState("");
  // 現在選択中のモデル ID。API へそのまま渡し、サーバー側で再検証する。
  const [model, setModel] = useState(DEFAULT_MODEL);
  // 推論強度の UI 選択値。モデルごとに選べる値が違うため、changeModel で補正する。
  const [reasoning, setReasoning] = useState("medium");
  // 通常チャットではなく画像生成 API へ送るかどうかを表す。
  const [imageGenerationMode, setImageGenerationMode] = useState(false);
  // GPT の通常チャットで OpenAI Web 検索ツールを使うかどうか。
  const [webSearchMode, setWebSearchMode] = useState(false);
  // 送信前に選択されている添付ファイル。画像の場合は previewUrl も持つ。
  const [files, setFiles] = useState<UploadFile[]>([]);
  // AI からのストリーム応答を受信中かどうか。二重送信防止と待機表示に使う。
  const [isStreaming, setIsStreaming] = useState(false);
  // ストリーム開始時刻。Thinking 表示の経過秒数を計算する基準になる。
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  // 経過秒数を再計算するための現在時刻。ストリーミング中だけ interval で更新する。
  const [now, setNow] = useState(() => Date.now());
  // モバイル表示でサイドバーのオーバーレイを開いているかどうか。
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // デスクトップ表示でサイドバー自体を表示するかどうか。
  const [sidebarVisible, setSidebarVisible] = useState(true);
  // 最下部にいる時は手動スクロールボタンを隠す。
  const [isAtChatBottom, setIsAtChatBottom] = useState(true);
  // 会話本文のスクロール領域。手動で最下部へ移動するボタンだけで使う。
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  // ストリーム処理中の古いクロージャを避けるため、現在のセッション ID を ref にも保持する。
  const activeSessionIdRef = useRef<string | null>(null);
  // アンマウント時のクリーンアップで最新の添付一覧を参照するための ref。
  const filesRef = useRef<UploadFile[]>([]);
  // 送信直後の古い入力イベントで本文が戻らないよう、DOM 側も直接空にする。
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // state 更新前に連続 submit が入っても、同じ本文を二重送信しない。
  const isSubmittingRef = useRef(false);
  // 送信直後に遅れて届いた古い input/change イベントだけを捨てる。
  const submittedInputRestoreGuardRef = useRef<{
    value: string;
    expiresAt: number;
  } | null>(null);

  // 送信可能条件。空文字とストリーミング中は送信ボタンを無効にする。
  const canSend = input.trim().length > 0 && !isStreaming;
  // モデル ID から、対応機能や表示名をまとめた設定を引く。
  const selectedModel = getModelOption(model);

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

  async function loadMessages(sessionId: string) {
    // サイドバーで選ばれたセッションの本文だけを取得する。
    const response = await fetch(`/api/sessions/${sessionId}/messages`, {
      cache: "no-store",
    });

    if (!response.ok) return;

    // 取得した履歴を表示対象にし、現在のセッション ID とモバイルサイドバーを更新する。
    const data = await readJsonObject(response);
    setMessages(Array.isArray(data.messages) ? (data.messages as Message[]) : []);
    setActiveSessionId(sessionId);
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

    const response = await fetch("/api/sessions", { method: "POST" });
    const data = await readJsonObject(response);
    if (!response.ok) return;
    const session = data.session as Session | undefined;
    if (!session) return;
    setSessions((current) => [session, ...current]);
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
    if (activeSessionId === sessionId) {
      // 表示中のセッションを削除した場合は、新規チャット状態へ戻す。
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

    scroller.scrollTop = scroller.scrollHeight;
    setIsAtChatBottom(true);
    window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
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
      if (Date.now() > guard.expiresAt) {
        submittedInputRestoreGuardRef.current = null;
      } else if (nextInput.startsWith(guard.value)) {
        // 送信済み本文がブラウザイベントで復元された場合は、その部分だけ落とす。
        const recoveredInput = nextInput.slice(guard.value.length);
        element.value = recoveredInput;
        setInput(recoveredInput);
        if (recoveredInput) {
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
    if (!userContent || isStreaming || isSubmittingRef.current) return;

    isSubmittingRef.current = true;

    // 送信後すぐにユーザー発言と空のアシスタント枠を追加する。
    // API の応答を待ってから描画すると体感が遅くなるため、先に表示してストリーム差分で埋めていく。
    // 入力欄の値はここで確定する。以降は state を空にしてもこの変数を API 送信用に使う。
    // 送信時点の添付を固定する。setFiles([]) 後もこの配列を使って FormData とプレビュー解放を行う。
    const submittedFiles = files;
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

    setMessages((current) => [
      ...current,
      localUserMessage,
      {
        id: assistantMessageId,
        role: "ASSISTANT",
        content: "",
        model,
        reasoningEffort: reasoning.toUpperCase(),
      },
    ]);
    submittedInputRestoreGuardRef.current = {
      value: submittedInputValue,
      expiresAt: Date.now() + INPUT_RESTORE_GUARD_MS,
    };
    setInput("");
    if (inputRef.current) {
      inputRef.current.value = "";
    }
    setFiles([]);

    if (imageGenerationMode && !selectedModel.supportsImageGeneration) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: `${selectedModel.label} does not support image generation. Switch to GPT-5.5 to use images.`,
              }
            : message,
        ),
      );
      isSubmittingRef.current = false;
      return;
    }

    if (
      imageGenerationMode &&
      submittedFiles.some((item) => !isImageMimeType(item.file.type || "application/octet-stream"))
    ) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: "Image generation only accepts image uploads. Remove non-image files or turn off Image generation.",
              }
            : message,
        ),
      );
      isSubmittingRef.current = false;
      return;
    }

    setStreamStartedAt(Date.now());
    setIsStreaming(true);

    // 通常チャット API は multipart/form-data を受けるため、本文・モデル設定・添付を FormData に詰める。
    const body = new FormData();
    body.append("message", userContent);
    body.append("model", model);
    body.append("reasoning", reasoning);
    body.append("webSearch", String(webSearchMode && selectedModel.supportsWebSearch));
    if (activeSessionId) body.append("sessionId", activeSessionId);
    submittedFiles.forEach(({ file }) => body.append("files", file));

    // 送信完了後にサーバー履歴へ差し替えられた時だけ、楽観表示用 previewUrl を解放する。
    let shouldCleanupSubmittedPreviews = false;

    try {
      if (imageGenerationMode) {
        // 画像生成はテキストチャットとは別 API に送る。
        // サーバーからは partial/completed の NDJSON が届くため、同じアシスタント枠の画像を差し替えながら表示する。
        // 画面上で生成画像を同じ ID として扱うためのローカル ID。
        const generatedImageId = crypto.randomUUID();
        // 送信開始時点のセッション ID。途中でユーザーが別セッションを開いたかの判定に使う。
        const requestSessionId = activeSessionId;
        // 参照画像を一緒に送れるよう、画像生成 API へも multipart/form-data で渡す。
        const imageBody = new FormData();
        imageBody.append("prompt", userContent);
        imageBody.append("model", model);
        imageBody.append("reasoning", reasoning);
        if (requestSessionId) imageBody.append("sessionId", requestSessionId);
        submittedFiles.forEach(({ file }) => imageBody.append("files", file));
        // 画像生成 API は画像の途中経過を NDJSON ストリームで返す。
        const response = await fetch("/api/images", {
          method: "POST",
          body: imageBody,
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to generate image.");
        }

        // ReadableStream を chunk 単位で読み、TextDecoder で文字列化する。
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        // chunk の境目で JSON 1 行が分断されることがあるため、未処理の末尾を保持する。
        let streamBuffer = "";
        let completedSessionId = requestSessionId;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          // NDJSON は改行区切り。最後の要素は途中行の可能性があるので次回へ持ち越す。
          const lines = streamBuffer.split(/\r?\n/);
          streamBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            // partial/completed/error のいずれかのイベントとして解釈する。
            const event = parseImageStreamLine(line);
            if (!event) continue;

            if (event.type === "error") {
              throw new Error(event.error ?? "Failed to generate image.");
            }

            if ((event.type === "partial" || event.type === "completed") && event.image?.dataUrl) {
              if (event.sessionId) {
                completedSessionId = event.sessionId;
              }

              if (
                event.sessionId &&
                event.sessionId !== activeSessionIdRef.current &&
                activeSessionIdRef.current === requestSessionId
              ) {
                // 新規チャットから画像生成した場合、完了時にサーバー側でセッションが作られる。
                // ユーザーが途中で別セッションへ移動していなければ、その新しいセッションを現在表示に採用する。
                activeSessionIdRef.current = event.sessionId;
                setActiveSessionId(event.sessionId);
              }

              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: "",
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
            }
          }
        }

        await loadSessions();
        if (completedSessionId && activeSessionIdRef.current === completedSessionId) {
          await loadMessages(completedSessionId);
          shouldCleanupSubmittedPreviews = true;
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
      const resolvedSessionId = nextSessionId ?? activeSessionId;
      if (nextSessionId && nextSessionId !== activeSessionId) {
        setActiveSessionId(nextSessionId);
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
          setMessages((current) =>
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
        await loadMessages(resolvedSessionId);
        shouldCleanupSubmittedPreviews = true;
      }
    } catch (error) {
      // ネットワークや上流 API の失敗も、空のアシスタント枠へエラー文として表示する。
      const detail = error instanceof Error ? error.message : "Unknown error.";
      setMessages((current) =>
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
        setMessages((current) => current.map(stripAttachmentPreviewUrls));
      }
      setIsStreaming(false);
      setStreamStartedAt(null);
      isSubmittingRef.current = false;
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
    if (!isStreaming || streamStartedAt === null) return;

    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);

    return () => window.clearInterval(interval);
  }, [isStreaming, streamStartedAt]);

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

  const activeTitle = useMemo(
    // ヘッダーに表示するタイトル。未選択または新規チャット中は固定文言にする。
    () => sessions.find((session) => session.id === activeSessionId)?.title ?? "New chat",
    [activeSessionId, sessions],
  );
  // Thinking 表示に出す秒数。0 秒表示を避けるため、ストリーム中は最低 1 秒に丸める。
  const thinkingSeconds =
    streamStartedAt === null ? 0 : Math.max(1, Math.round((now - streamStartedAt) / 1000));

  // デスクトップでは常設、モバイルではオーバーレイとして再利用するサイドバー UI。
  const sidebar = (
    <aside className="flex h-full w-72 shrink-0 flex-col bg-[#f8fafd]">
      <div className="flex h-16 items-center justify-between px-4">
        <StudyMateLogo />
        <button
          type="button"
          className="grid h-9 w-9 place-items-center rounded-full text-slate-500 hover:bg-slate-200"
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
          onClick={createSession}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#e9e7e5] px-4 text-sm font-semibold text-slate-950 hover:bg-[#dfdddb]"
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
              className={`group mb-1 flex items-center gap-1 rounded-full ${
                activeSessionId === session.id ? "bg-[#e9e7e5]" : "hover:bg-[#f1f0ef]"
              }`}
            >
              <button
                onClick={() => loadMessages(session.id)}
                className="min-w-0 flex-1 truncate px-3 py-2.5 text-left text-sm font-medium text-slate-800 hover:text-slate-950"
                title={session.title}
              >
                {session.title}
              </button>
              <button
                onClick={() => deleteSession(session.id)}
                className="mr-1 grid h-8 w-8 place-items-center rounded-full text-slate-600 opacity-0 hover:bg-white/70 hover:text-red-600 group-hover:opacity-100"
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
  // 空のアシスタントメッセージがありストリーミング中なら、Thinking 背景と待機表示を有効にする。
  const isThinking = isStreaming && messages.some(
    (message) => message.role === "ASSISTANT" && message.content.length === 0,
  );

  return (
    <main className="flex h-dvh bg-white text-slate-900">
      {sidebarVisible && <div className="hidden lg:block">{sidebar}</div>}

      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            className="absolute inset-0 bg-slate-950/30"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close sidebar overlay"
          />
          <div className="relative h-full">{sidebar}</div>
        </div>
      )}

      <section
        className={`relative flex min-w-0 flex-1 flex-col overflow-hidden ${
          emptyState
            ? "bg-[radial-gradient(ellipse_92%_58%_at_56%_58%,#cde9ff_0%,#e9f6ff_42%,#ffffff_78%)]"
            : isThinking
              ? "thinking-page-background"
              : "bg-white"
        }`}
      >
        <header
          className={`relative z-10 flex h-16 items-center justify-between px-4 ${
            emptyState ? "" : "border-b border-slate-200"
          }`}
        >
          <div className="flex min-w-0 items-center gap-3">
            <button
              className="grid h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-[#e9e7e5] lg:hidden"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open sidebar"
            >
              <Menu size={20} />
            </button>
            {!sidebarVisible && (
              <button
                type="button"
                className="hidden h-10 w-10 place-items-center rounded-full text-slate-600 hover:bg-[#e9e7e5] lg:grid"
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

          <div className={`text-xs font-semibold text-slate-500 ${emptyState ? "hidden" : ""}`}>
            {selectedModel.label}
          </div>
        </header>

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
                {messages.map((message) => (
                  <ChatMessage
                    key={message.id}
                    message={message}
                    isStreaming={isStreaming}
                    thinkingSeconds={thinkingSeconds}
                  />
                ))}
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
            className={`mx-auto mb-2 flex max-w-4xl justify-center ${
              !emptyState && !isAtChatBottom ? "" : "invisible"
            }`}
          >
            <button
              type="button"
              onClick={scrollChatToBottom}
              className="grid h-10 w-10 place-items-center rounded-full bg-white text-slate-500 shadow-[0_8px_24px_rgba(15,23,42,0.16)] ring-1 ring-slate-200 transition-colors hover:bg-slate-50 hover:text-slate-900"
              aria-label="Scroll to bottom"
              title="Scroll to bottom"
            >
              <ArrowDown size={20} strokeWidth={2.1} />
            </button>
          </div>
          <form onSubmit={sendMessage} className="mx-auto max-w-4xl">
            {!!files.length && (
              <div className="mb-3 flex flex-wrap gap-2">
                {files.map(({ id, file, previewUrl }) =>
                  previewUrl ? (
                    <div key={id} className="group relative h-28 w-28 overflow-hidden rounded-[1.4rem]">
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
                        className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/55 text-white hover:bg-black/70"
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
                      className="inline-flex max-w-full items-center gap-2 rounded-full bg-[#e9e7e5] px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-[#dfdddb]"
                    >
                      <Paperclip size={13} />
                      <span className="truncate">{file.name}</span>
                      <X size={13} />
                    </button>
                  ),
                )}
              </div>
            )}

            <div className="flex min-h-20 items-center gap-2 rounded-[2rem] border border-slate-100 bg-white px-5 py-3 shadow-[0_12px_32px_rgba(15,23,42,0.16)] focus-within:border-slate-200">
              <label className="grid h-11 w-8 shrink-0 cursor-pointer place-items-center text-slate-950 hover:text-blue-600">
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
              <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:flex-col max-sm:items-stretch">
                <div className="flex min-w-0 flex-1 items-center gap-2">
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
                    placeholder=""
                    className="max-h-40 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-6 text-slate-900 outline-none placeholder:text-slate-500"
                  />
                </div>
                <div className="flex shrink-0 items-center gap-1 max-sm:self-end">
                  <ModelSelect value={model} onChange={changeModel} />
                  <ReasoningSelect
                    value={reasoning}
                    options={selectedModel.reasoningEfforts}
                    xhighLabel={selectedModel.provider === "deepseek" ? "Max" : "XHigh"}
                    onChange={setReasoning}
                  />
                  {selectedModel.supportsWebSearch && !imageGenerationMode && (
                    <button
                      type="button"
                      onClick={() => setWebSearchMode((current) => !current)}
                      className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${
                        webSearchMode
                          ? "bg-[#e9e7e5] text-slate-950"
                          : "text-slate-900 hover:bg-[#e9e7e5]"
                      }`}
                      aria-label="Web search"
                      aria-pressed={webSearchMode}
                      title="Web search"
                    >
                      <Globe2 size={18} />
                    </button>
                  )}
                  {selectedModel.supportsImageGeneration && (
                    <button
                      type="button"
                      onClick={() => setImageGenerationMode((current) => !current)}
                      className={`grid h-10 w-10 place-items-center rounded-full transition-colors ${
                        imageGenerationMode
                          ? "bg-[#e9e7e5] text-slate-950"
                          : "text-slate-900 hover:bg-[#e9e7e5]"
                      }`}
                      aria-label="Image generation"
                      aria-pressed={imageGenerationMode}
                      title="Image generation"
                    >
                      <ImagePlus size={18} />
                    </button>
                  )}
                </div>
              </div>
              <button
                type="submit"
                disabled={!canSend}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-sky-300 text-slate-950 hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
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
