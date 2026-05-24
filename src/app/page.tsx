"use client";

import {
  ArrowUp,
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

function createUploadFile(file: File): UploadFile {
  const mimeType = file.type || "application/octet-stream";

  return {
    id: crypto.randomUUID(),
    file,
    previewUrl: isImageMimeType(mimeType) ? URL.createObjectURL(file) : undefined,
  };
}

function revokeUploadPreviews(files: UploadFile[]) {
  for (const file of files) {
    if (file.previewUrl) {
      URL.revokeObjectURL(file.previewUrl);
    }
  }
}

function stripAttachmentPreviewUrls(message: Message): Message {
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
  const trimmed = line.trim();
  if (!trimmed) return null;

  return JSON.parse(trimmed) as ImageStreamEvent;
}

export default function Home() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);
  const [reasoning, setReasoning] = useState("medium");
  const [imageGenerationMode, setImageGenerationMode] = useState(false);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamStartedAt, setStreamStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const filesRef = useRef<UploadFile[]>([]);

  const canSend = (input.trim().length > 0 || files.length > 0) && !isStreaming;
  const selectedModel = getModelOption(model);

  function changeModel(nextModel: string) {
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
    const response = await fetch("/api/sessions", { cache: "no-store" });
    const data = await response.json();
    setSessions(data.sessions ?? []);
  }

  async function loadMessages(sessionId: string) {
    const response = await fetch(`/api/sessions/${sessionId}/messages`, {
      cache: "no-store",
    });

    if (!response.ok) return;

    const data = await response.json();
    setMessages(data.messages ?? []);
    setActiveSessionId(sessionId);
    setSidebarOpen(false);
  }

  async function createSession() {
    const activeSession = sessions.find((session) => session.id === activeSessionId);
    if ((!activeSessionId || activeSession?.title === "New chat") && messages.length === 0) {
      setSidebarOpen(false);
      return;
    }

    const response = await fetch("/api/sessions", { method: "POST" });
    const data = await response.json();
    if (!response.ok) return;
    setSessions((current) => [data.session, ...current]);
    setActiveSessionId(data.session.id);
    setMessages([]);
    setSidebarOpen(false);
  }

  async function deleteSession(sessionId: string) {
    const response = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
    if (!response.ok) return;
    setSessions((current) => current.filter((session) => session.id !== sessionId));
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setMessages([]);
    }
  }

  function removeUploadFile(fileId: string) {
    setFiles((current) => {
      const target = current.find((item) => item.id === fileId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }

      return current.filter((item) => item.id !== fileId);
    });
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!canSend) return;

    const userContent = input.trim();
    const submittedFiles = files;
    const localUserMessage: Message = {
      id: crypto.randomUUID(),
      role: "USER",
      content: userContent,
      model,
      reasoningEffort: reasoning.toUpperCase(),
      attachments: submittedFiles.map(({ file, previewUrl }) => ({
        id: `${file.name}-${file.size}`,
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        previewUrl,
      })),
    };
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
    setInput("");
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
      return;
    }

    if (imageGenerationMode && submittedFiles.length > 0) {
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? {
                ...message,
                content: "Image generation does not accept file uploads yet. Remove attachments or turn off Image generation.",
              }
            : message,
        ),
      );
      return;
    }

    setStreamStartedAt(Date.now());
    setIsStreaming(true);

    const body = new FormData();
    body.append("message", userContent);
    body.append("model", model);
    body.append("reasoning", reasoning);
    if (activeSessionId) body.append("sessionId", activeSessionId);
    submittedFiles.forEach(({ file }) => body.append("files", file));

    try {
      if (imageGenerationMode) {
        const generatedImageId = crypto.randomUUID();
        const requestSessionId = activeSessionId;
        const response = await fetch("/api/images", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            prompt: userContent,
            sessionId: requestSessionId,
            model,
            reasoning,
          }),
        });

        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error ?? "Failed to generate image.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let streamBuffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          streamBuffer += decoder.decode(value, { stream: true });
          const lines = streamBuffer.split(/\r?\n/);
          streamBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) continue;

            const event = parseImageStreamLine(line);
            if (!event) continue;

            if (event.type === "error") {
              throw new Error(event.error ?? "Failed to generate image.");
            }

            if ((event.type === "partial" || event.type === "completed") && event.image?.dataUrl) {
              if (
                event.sessionId &&
                event.sessionId !== activeSessionIdRef.current &&
                activeSessionIdRef.current === requestSessionId
              ) {
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
        return;
      }

      const response = await fetch("/api/chat", {
        method: "POST",
        body,
      });

      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to send message.");
      }

      const nextSessionId = response.headers.get("X-Session-Id");
      if (nextSessionId && nextSessionId !== activeSessionId) {
        setActiveSessionId(nextSessionId);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessageId
              ? { ...message, content: message.content + chunk }
              : message,
          ),
        );
      }

      await loadSessions();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error.";
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessageId
            ? { ...message, content: `Request failed: ${detail}` }
            : message,
        ),
      );
    } finally {
      revokeUploadPreviews(submittedFiles);
      setMessages((current) => current.map(stripAttachmentPreviewUrls));
      setIsStreaming(false);
      setStreamStartedAt(null);
    }
  }

  useEffect(() => {
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
    return () => revokeUploadPreviews(filesRef.current);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
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
    () => sessions.find((session) => session.id === activeSessionId)?.title ?? "New chat",
    [activeSessionId, sessions],
  );
  const thinkingSeconds =
    streamStartedAt === null ? 0 : Math.max(1, Math.round((now - streamStartedAt) / 1000));

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

  const emptyState = messages.length === 0;
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
              <div className="text-xs text-slate-500">Learn smarter. Ask anything.</div>
            </div>
          </div>

          <div className={`text-xs font-semibold text-slate-500 ${emptyState ? "hidden" : ""}`}>
            {selectedModel.label}
          </div>
        </header>

        <div className="relative z-0 flex-1 overflow-y-auto">
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
                <div ref={scrollRef} />
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
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
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
                  {selectedModel.supportsImageGeneration && (
                    <button
                      type="button"
                      onClick={() => setImageGenerationMode((current) => !current)}
                      className={`h-10 rounded-full px-3 text-sm font-medium transition-colors ${
                        imageGenerationMode
                          ? "bg-[#e9e7e5] text-slate-950"
                          : "text-slate-900 hover:bg-[#e9e7e5]"
                      }`}
                    >
                      Image generation
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
