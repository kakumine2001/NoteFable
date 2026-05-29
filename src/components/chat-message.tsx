"use client";

import Image from "next/image";
import { Download, ImagePlus, Paperclip } from "lucide-react";
import { memo } from "react";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { isImageMimeType } from "@/lib/client-files";
import type { Message } from "@/types/chat";

function ThinkingIndicator({ seconds }: { seconds: number }) {
  // アシスタント枠はあるが本文がまだ届いていない時に、経過秒数を表示する。
  return (
    <div className="thinking-indicator" aria-live="polite">
      Thinking time: {seconds}s
      <span aria-hidden="true">›</span>
    </div>
  );
}

function GeneratingImagePreview() {
  // 完成前の部分画像は出さず、画像生成中だと分かる固定プレビューだけ出す。
  return (
    <div className="generated-image-grid" aria-label="Generating image">
      <div className="generated-image-placeholder">
        <div className="generated-image-placeholder-frame">
          <ImagePlus size={34} />
          <div className="generated-image-placeholder-glow" />
        </div>
      </div>
    </div>
  );
}

type ChatMessageProps = {
  // 表示対象の 1 メッセージ。role によってレイアウトを切り替える。
  message: Message;
  // 現在ストリーミング中かどうか。空のアシスタント本文を待機表示にする判断で使う。
  isStreaming: boolean;
  // ThinkingIndicator に出す経過秒数。
  thinkingSeconds: number;
};

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  thinkingSeconds,
}: ChatMessageProps) {
  // メッセージの役割ごとに表示密度を変える。
  // ユーザー発言は短い吹き出し、アシスタント発言は Markdown・コード・生成画像を扱うため横幅を広く取る。
  const generatedImages = message.generatedImages ?? [];
  const hasGeneratedImages = generatedImages.length > 0;
  const shouldShowImagePreview = !!message.isGeneratingImage && !hasGeneratedImages;
  const shouldShowThinking =
    isStreaming &&
    message.role === "ASSISTANT" &&
    !message.content &&
    !hasGeneratedImages;

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
            {hasGeneratedImages && (
              // 画像生成モードの結果。本文とは別に、ダウンロード可能な画像として表示する。
              <div className="generated-image-grid">
                {generatedImages.map((image) => (
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
            {shouldShowImagePreview && <GeneratingImagePreview />}
            {message.content ? (
              <AssistantMarkdown content={message.content} />
            ) : (
              shouldShowThinking ? <ThinkingIndicator seconds={thinkingSeconds} /> : ""
            )}
          </div>
        ) : (
          <>
            {!!message.attachments?.some((attachment) =>
              isImageMimeType(attachment.mimeType),
            ) && (
              // ユーザーが添付した画像は、本文吹き出しの上にサムネイルとして並べる。
              <div className="flex flex-wrap justify-end gap-2">
                {message.attachments
                  .filter((attachment) => isImageMimeType(attachment.mimeType))
                  .map((attachment) => {
                    // 送信直後は previewUrl、履歴取得後はサーバーの dataUrl を使う。
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
              <div className="max-w-full rounded-[1.6rem] bg-[#dff1ff] px-5 py-2.5 text-base leading-6 text-slate-950">
                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
              </div>
            )}
          </>
        )}
        {!!message.attachments?.some(
          (attachment) =>
            message.role === "ASSISTANT" || !isImageMimeType(attachment.mimeType),
        ) && (
          // 画像以外のユーザー添付と、アシスタント側の通常添付はファイルチップとして表示する。
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
  // 大きな Markdown や画像を含むメッセージは再描画コストが高い。
  // 通常は message オブジェクトが変わった時だけ描画し、待機中アシスタントだけ秒数更新で再描画する。
  if (previous.message !== next.message || previous.isStreaming !== next.isStreaming) {
    return false;
  }

  const isWaitingAssistant =
    // 空本文のアシスタントがストリーミング中なら、経過秒数の更新だけは再描画対象にする。
    next.message.role === "ASSISTANT" &&
    next.message.content.length === 0 &&
    !next.message.generatedImages?.length &&
    next.isStreaming;

  return !isWaitingAssistant || previous.thinkingSeconds === next.thinkingSeconds;
}
