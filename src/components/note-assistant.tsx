"use client";

import { ArrowUp, FileText, Paperclip, X } from "lucide-react";
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
import { GuestLimitPrompt, UpgradePrompt } from "@/components/guest-limit-prompt";
import { keepRejectedDraft, savePendingDraft, takePendingDraft, useKeepDraftOnLeave } from "@/lib/pending-draft";
import "@/components/note-assistant.css";
import { applyActivityEvent, type ActivityEvent } from "@/lib/chat-activity";
import { parseChatStreamLine } from "@/lib/chat-stream";
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

// 固定配置（position: fixed）の基準になる画面の大きさ。window.innerWidth と違い、スクロールバーの幅を含まない。rem は 1rem の px（ボタンとパネルの大きさは CSS で rem 指定なので、ブラウザーの文字サイズ設定に合わせる）。
const viewportSize = () => ({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) || 16 });

// /api/chat に送り、届いた本文の差分と途中経過を順に渡す。セッション ID はレスポンスヘッダーから受け取る。
async function streamChat(
  body: FormData,
  onSession: (id: string) => void,
  onChunk: (chunk: string, activity: ActivityEvent[], elapsedMs: number) => void,
) {
  const startedAt = Date.now();
  const response = await fetch("/api/chat", { method: "POST", body });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}));
    throw usageLimitErrorFrom(response.status, data) ?? new Error(typeof data.error === "string" ? data.error : msg("Failed to send the request."));
  }
  const id = response.headers.get("X-Session-Id");
  if (id) onSession(id);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";

    let chunk = "";
    const activity: ActivityEvent[] = [];
    for (const eventText of events) {
      for (const line of eventText.split(/\r?\n/)) {
        try {
          const item = parseChatStreamLine(line);
          if (typeof item === "string") chunk += item;
          else if (item) activity.push(item);
        } catch { /* 壊れた 1 行は読み飛ばす。 */ }
      }
    }
    if (chunk || activity.length) onChunk(chunk, activity, Date.now() - startedAt);
  }
}

// ノートを開いたまま使う AI アシスタント。丸いボタン（初めは右下。好きな場所へドラッグでき、位置はこのブラウザに覚える）で開き、頼んだ内容は「編集案」として出る。
// ノートは、編集案の Apply を押すまで変わらない（チャットと同じ仕組み）。
// 入力欄はチャットと同じ機能を持つ：「＋」メニュー（ファイル・写真、ノートの添付）とモデル選択。画像の作成だけは置かない（ノートの編集には使わない）。
export function NoteAssistant({ noteId, noteTitle, model, reasoning, onModelChange, onReasoningChange, flush, embedded = false }: {
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
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 保存待ちから返答の終わりまで true。チャットのボタンを無効にするのに使う。
  const [busy, setBusy] = useState(false);
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
  const composerMountedRef = useKeepDraftOnLeave(`note:${noteId}`, () => (guestLimitHitRef.current ? inputValueRef.current : null));
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
  // CSS の .note-ai-fab と同じ大きさ（3rem、スマホは 3.25rem）。
  const fabSize = (phone ? 3.25 : 3) * viewport.rem;
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
    if (open && !phone) inputRef.current?.focus();
  }, [open, phone]);

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
    queueMicrotask(() => setInput((current) => current || pending));
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
    if (!content || sending.current) return;
    const sentFiles = display === undefined ? files : [];
    const sentPages = display === undefined ? attachedPages : [];
    const rawFiles = sentFiles.map(({ file }) => file);
    const problem = getUploadValidationError(rawFiles, uploadOptions, t) || getUploadRequestError(rawFiles, content, t)
      || (sentPages.length > MAX_MESSAGE_NOTES ? t("You can attach up to 5 pages to a message.") : "");
    if (problem) { setError(problem); flashOutcome("error"); return; }
    sending.current = true;
    setBusy(true);
    setError("");
    flashOutcome(null);
    if (!(await flush())) {
      setError(msg("Resolve the note's unsaved changes first, then ask again."));
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
      flashOutcome("error");
      sending.current = false;
      setBusy(false);
      return;
    } finally {
      setUploadProgress(null);
    }
    stick.current = true;

    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      {
        id: crypto.randomUUID(), role: "USER", content: display ?? content,
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
    body.append("message", content);
    body.append("model", model);
    body.append("reasoning", reasoning);
    body.append("webSearch", "off");
    body.append("noteId", noteId);
    if (sessionId.current) body.append("sessionId", sessionId.current);
    if (tickets.length) body.append("uploads", JSON.stringify(tickets));
    if (sentPages.length) body.append("pages", JSON.stringify(sentPages.map((page) => page.id)));

    // サーバーが発言を受け付けたか。受け付ける前に断られたら、添付は入力欄に残し、上げたファイルは片付ける。
    let accepted = false;
    try {
      await streamChat(
        body,
        (id) => {
          sessionId.current = id;
          accepted = true;
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
      flashOutcome("completed");
    } catch (caught) {
      flashOutcome("error");
      const detail = caught instanceof Error ? caught.message : msg("Unknown error.");
      const limited = caught instanceof UsageLimitError;
      if (!accepted && tickets.length) void cleanupClientUploads(tickets);
      if (limited && caught.tier === "guest") { guestLimitHitRef.current = true; setGuestLimit(true); }
      if (limited && caught.tier === "member" && !embedded) { guestLimitHitRef.current = true; setUpgradeLimit(true); }
      // 上限で断られた本文は保存されていない。入力欄から送ったものなら戻す（待つ間に書き足した文は後ろに残す）。
      // 待つ間に別のノートへ移っていたら、入力欄の代わりにこのノートの分として預けておく。
      if (limited && display === undefined && !composerMountedRef.current) keepRejectedDraft(`note:${noteId}`, text);
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

  const lastAssistant = [...messages].reverse().find((message) => message.role === "ASSISTANT");
  const hasTurnOutput = Boolean(
    lastAssistant && (
      lastAssistant.content.length > 0 ||
      lastAssistant.proposals?.length ||
      lastAssistant.activity?.some((step) => step.kind === "proposal" || step.kind === "create_proposal")
    ),
  );
  const noteCharacterState = deriveTurnCharacterState({
    isBusy: busy,
    hasOutput: hasTurnOutput,
    outcome,
    isTyping: open && (inputFocused || Boolean(input.trim())),
    hidden: docHidden,
  });
  const replyCharacterState = deriveTurnCharacterState({
    isBusy: streaming,
    hasOutput: hasTurnOutput,
    outcome,
    hidden: docHidden,
  });

  const panel = (
    <div ref={attach} className={`note-ai-panel ${phone ? "is-sheet" : ""}`} style={panelStyle} role="dialog" aria-label={t("Ask AI about this note")}>
      {phone && <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>}
      <header className="note-ai-header">
        <AppIcon size={18} state={replyCharacterState} animated={replyCharacterState !== "idle" && replyCharacterState !== "hidden"} />
        <span className="note-ai-title" title={noteTitle}>{t("Ask AI about this note")}</span>
        <button type="button" className="notion-icon-button grid" onClick={close} aria-label={t("Close")}><X size={16} /></button>
      </header>

      <div ref={listRef} className="note-ai-list" onScroll={onListScroll}>
        {messages.length === 0 ? (
          <div className="note-ai-empty">
            <p>{t("Tell the AI how to change this note. You review its proposal before anything changes.")}</p>
            <div className="note-ai-chips">
              {QUICK_ACTIONS.map((action) => (
                <button key={action.label} type="button" className="note-ai-chip" disabled={busy} onClick={() => void send(action.prompt, t(action.label))}>{t(action.label)}</button>
              ))}
            </div>
          </div>
        ) : messages.map((message) => (
          <ChatMessage key={message.id} message={message} isStreaming={streaming && message.id === lastAssistant?.id} thinkingSeconds={seconds}
            characterState={message.id === lastAssistant?.id ? replyCharacterState : undefined} />
        ))}
      </div>

      {upgradeLimit && <UpgradePrompt kind="chat" onClose={() => setUpgradeLimit(false)} onBeforeUpgrade={() => savePendingDraft(`note:${noteId}`, input)} />}
      {guestLimit && <GuestLimitPrompt kind="chat" onClose={() => setGuestLimit(false)} onBeforeSignIn={() => savePendingDraft(`note:${noteId}`, input)} />}
      {(uploadError || error) && <p className="note-ai-error" role="alert">{uploadError || t(error)}</p>}
      {/* チャットの入力欄と同じ理由で、ページ翻訳の対象から外す（書き換えられると React の更新が失敗する）。 */}
      <form className="note-ai-form" onSubmit={submit} translate="no">
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
            <button type="submit" className="note-ai-send" disabled={busy || !input.trim() || Boolean(uploadError)} aria-label={t("Send")}><ArrowUp size={16} /></button>
          </div>
        </div>
        {uploadProgress && <div role="status" className="note-ai-progress">{t(uploadProgress.key, uploadProgress.vars)}</div>}
      </form>
      {pageDialogOpen && <AttachPageDialog initial={attachedPages} onClose={() => setPageDialogOpen(false)} onAttach={(pages) => { setError(""); setAttachedPages(pages); }} />}
    </div>
  );

  return (
    <>
      <button type="button" className={`note-ai-fab ${open ? "is-open" : ""} ${dragging ? "is-dragging" : ""}`}
        style={fab ? { right: fab.right, bottom: fab.bottom } : undefined}
        onPointerDown={onFabPointerDown} onPointerMove={onFabPointerMove} onPointerUp={onFabPointerEnd} onPointerCancel={onFabPointerEnd}
        onClick={() => { if (skipClick.current) { skipClick.current = false; return; } setOpen((current) => !current); }}
        aria-label={t("Ask AI about this note")} aria-expanded={open} title={t("Ask AI")}>
        <AppIcon size={28} state={noteCharacterState} animated />
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
