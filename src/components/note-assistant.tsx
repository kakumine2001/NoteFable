"use client";

import { ArrowUp, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type UIEvent } from "react";
import { createPortal } from "react-dom";
import { ChatMessage } from "@/components/chat-message";
import { GuestLimitPrompt } from "@/components/guest-limit-prompt";
import { keepRejectedDraft, savePendingDraft, takePendingDraft, useKeepDraftOnLeave } from "@/lib/pending-draft";
import "@/components/note-assistant.css";
import { applyActivityEvent, type ActivityEvent } from "@/lib/chat-activity";
import { parseChatStreamLine } from "@/lib/chat-stream";
import { useBackToClose } from "@/lib/use-back-to-close";
import { useSwipeDismiss } from "@/lib/use-swipe-dismiss";
import { useMediaQuery } from "@/lib/use-media-query";
import type { Message } from "@/types/chat";
import { useT } from "@/components/i18n-provider";
import { msg } from "@/lib/i18n/translate";
import { failureText } from "@/lib/failure-text";
import { UsageLimitError, usageLimitErrorFrom } from "@/lib/usage-plans";

// よく使う頼み事。押すとそのまま送る。
const QUICK_ACTIONS = [
  { label: msg("Improve writing"), prompt: "Improve the writing of this note: make it clearer and smoother, keep the meaning, the structure and the language." },
  { label: msg("Fix spelling & grammar"), prompt: "Fix spelling and grammar mistakes in this note. Do not change the wording otherwise." },
  { label: msg("Summarize"), prompt: "Add a short summary of this note at the very top, in the note's own language." },
  { label: msg("Make it shorter"), prompt: "Make this note shorter without losing the key points." },
  { label: msg("Continue writing"), prompt: "Continue writing this note from where it ends, in the same style and language." },
] as const;

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

// ノートを開いたまま使う AI アシスタント。右下の丸いボタンで開き、頼んだ内容は「編集案」として出る。
// ノートは、編集案の Apply を押すまで変わらない（チャットと同じ仕組み）。
export function NoteAssistant({ noteId, noteTitle, model, reasoning, flush }: {
  noteId: string;
  noteTitle: string;
  model: string;
  reasoning: string;
  // 頼む前に、入力中の内容を保存する（AI が最新の版を読めるように）。保存できなければ false。
  flush: () => Promise<boolean>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  // 保存待ちから返答の終わりまで true。チャットのボタンを無効にするのに使う。
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [guestLimit, setGuestLimit] = useState(false);
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

  // display は画面に出す発言（ボタンの短い名前など）。AI へは text をそのまま送る。
  async function send(text: string, display?: string) {
    const content = text.trim();
    if (!content || sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    if (!(await flush())) {
      setError(msg("Resolve the note's unsaved changes first, then ask again."));
      sending.current = false;
      setBusy(false);
      return;
    }
    stick.current = true;

    const assistantId = crypto.randomUUID();
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: "USER", content: display ?? content },
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

    try {
      await streamChat(
        body,
        (id) => { sessionId.current = id; },
        (chunk, activity, elapsedMs) => setMessages((current) => current.map((message) => message.id !== assistantId ? message : {
          ...message,
          content: message.content + chunk,
          activity: activity.length ? activity.reduce(applyActivityEvent, message.activity ?? []) : message.activity,
          thinkingMs: message.thinkingMs ?? (chunk ? elapsedMs : undefined),
        })),
      );
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : msg("Unknown error.");
      const limited = caught instanceof UsageLimitError;
      if (limited && caught.tier === "guest") { guestLimitHitRef.current = true; setGuestLimit(true); }
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

  const panel = (
    <div ref={attach} className={`note-ai-panel ${phone ? "is-sheet" : ""}`} role="dialog" aria-label={t("Ask AI about this note")}>
      {phone && <div className="sheet-grip" {...bind}><div className="model-sheet-grab" aria-hidden="true" /></div>}
      <header className="note-ai-header">
        <Sparkles size={16} aria-hidden="true" />
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
          <ChatMessage key={message.id} message={message} isStreaming={streaming && message.id === lastAssistant?.id} thinkingSeconds={seconds} />
        ))}
      </div>

      {guestLimit && <GuestLimitPrompt kind="chat" onClose={() => setGuestLimit(false)} onBeforeSignIn={() => savePendingDraft(`note:${noteId}`, input)} />}
      {error && <p className="note-ai-error" role="alert">{t(error)}</p>}
      <form className="note-ai-form" onSubmit={submit}>
        <textarea ref={inputRef} value={input} rows={1} onChange={(event) => setInput(event.target.value)} onKeyDown={onKeyDown}
          placeholder={t("Ask AI to edit this note…")} aria-label={t("Instruction for the AI")} className="note-ai-input" />
        <button type="submit" className="note-ai-send" disabled={busy || !input.trim()} aria-label={t("Send")}><ArrowUp size={16} /></button>
      </form>
    </div>
  );

  return (
    <>
      <button type="button" className={`note-ai-fab ${open ? "is-open" : ""}`} onClick={() => setOpen((current) => !current)}
        aria-label={t("Ask AI about this note")} aria-expanded={open} title={t("Ask AI")}>
        <Sparkles size={20} />
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
