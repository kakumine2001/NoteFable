"use client";

import Image from "next/image";
import { Download, Paperclip } from "lucide-react";
import { memo } from "react";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { isImageMimeType } from "@/lib/client-files";
import type { Message } from "@/types/chat";

function ThinkingIndicator({ seconds }: { seconds: number }) {
  return (
    <div className="thinking-indicator" aria-live="polite">
      Thinking time: {seconds}s
      <span aria-hidden="true">›</span>
    </div>
  );
}

type ChatMessageProps = {
  message: Message;
  isStreaming: boolean;
  thinkingSeconds: number;
};

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  thinkingSeconds,
}: ChatMessageProps) {
  return (
    <article className={`flex gap-3 ${message.role === "USER" ? "justify-end" : "justify-start"}`}>
      <div
        className={`${
          message.role === "USER"
            ? "flex max-w-[78%] flex-col items-end gap-3"
            : "w-full max-w-none text-slate-950"
        }`}
      >
        {message.role === "ASSISTANT" ? (
          <div className="markdown-body">
            {!!message.generatedImages?.length && (
              <div className="generated-image-grid">
                {message.generatedImages.map((image) => (
                  <div key={image.id} className="generated-image-shell">
                    <Image
                      src={image.dataUrl}
                      alt="Generated image"
                      width={1024}
                      height={1024}
                      unoptimized
                      className="generated-image"
                    />
                    <a
                      href={image.dataUrl}
                      download={`studymate-${image.id}.png`}
                      className="generated-image-download"
                      aria-label="Download image"
                      title="Download"
                    >
                      <Download size={20} />
                    </a>
                  </div>
                ))}
              </div>
            )}
            {message.content ? (
              <AssistantMarkdown content={message.content} />
            ) : (
              isStreaming ? <ThinkingIndicator seconds={thinkingSeconds} /> : ""
            )}
          </div>
        ) : (
          <>
            {!!message.attachments?.some((attachment) =>
              isImageMimeType(attachment.mimeType),
            ) && (
              <div className="flex flex-wrap justify-end gap-2">
                {message.attachments
                  .filter((attachment) => isImageMimeType(attachment.mimeType))
                  .map((attachment) => {
                    const imageUrl = attachment.previewUrl ?? attachment.dataUrl;

                    return imageUrl ? (
                      <Image
                        key={attachment.id}
                        src={imageUrl}
                        alt={attachment.filename}
                        width={144}
                        height={144}
                        unoptimized
                        className="h-36 w-36 rounded-[1.6rem] object-cover"
                      />
                    ) : null;
                  })}
              </div>
            )}
            {message.content && (
              <div className="rounded-full bg-[#dff1ff] px-5 py-2.5 text-base leading-6 text-slate-950">
                <div className="whitespace-pre-wrap break-words">{message.content}</div>
              </div>
            )}
          </>
        )}
        {!!message.attachments?.some(
          (attachment) =>
            message.role === "ASSISTANT" || !isImageMimeType(attachment.mimeType),
        ) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {message.attachments
              .filter(
                (attachment) =>
                  message.role === "ASSISTANT" || !isImageMimeType(attachment.mimeType),
              )
              .map((attachment) => (
                <span
                  key={attachment.id}
                  className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-1 text-xs ${
                    message.role === "USER"
                      ? "bg-[#e9e7e5] text-slate-700"
                      : "bg-white/15"
                  }`}
                >
                  <Paperclip size={12} />
                  <span className="truncate">{attachment.filename}</span>
                </span>
              ))}
          </div>
        )}
      </div>
    </article>
  );
}, areChatMessagePropsEqual);

function areChatMessagePropsEqual(previous: ChatMessageProps, next: ChatMessageProps) {
  if (previous.message !== next.message || previous.isStreaming !== next.isStreaming) {
    return false;
  }

  const isWaitingAssistant =
    next.message.role === "ASSISTANT" && next.message.content.length === 0 && next.isStreaming;

  return !isWaitingAssistant || previous.thinkingSeconds === next.thinkingSeconds;
}
