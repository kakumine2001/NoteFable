"use client";

import Image from "next/image";
import { Download, ImagePlus, Paperclip } from "lucide-react";
import { memo } from "react";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { ChatActivity } from "@/components/chat-activity";
import { PageCreateProposal, PageEditProposal } from "@/components/page-edit-proposal";
import { isImageMimeType } from "@/lib/client-files";
import type { Message, StoredProposal } from "@/types/chat";

function GeneratingImagePreview() {
  // 生成中は Notion のブロックに近い控えめな状態表示を出し、完成画像より目立たせない。
  return (
    <div className="generated-image-grid" aria-label="Generating image">
      <div className="generated-image-placeholder">
        <div className="generated-image-placeholder-header">
          <span className="generated-image-placeholder-icon" aria-hidden="true">
            <ImagePlus size={18} strokeWidth={1.7} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[var(--notion-text)]">Generating image</span>
            <span className="mt-0.5 block text-xs text-[var(--notion-muted)]">This may take a moment</span>
          </span>
          <span className="generated-image-placeholder-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
        <div className="generated-image-placeholder-canvas" aria-hidden="true">
          <ImagePlus size={28} strokeWidth={1.5} />
          <span className="generated-image-placeholder-progress" />
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
  // 待機中の途中経過ヘッダーに出す経過秒数。
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
  const steps = message.activity ?? [];
  // 編集案は進捗の一覧ではなく、回答の下に承認カードとして出す。
  const activity = steps.filter((step) => step.kind !== "proposal" && step.kind !== "create_proposal");
  // 保存済みの提案を優先し、ストリーム中でまだ保存側に出ていないものだけを足す。
  const stored = message.proposals ?? [];
  const proposals: StoredProposal[] = [...stored, ...steps.filter((step): step is StoredProposal => (step.kind === "proposal" || step.kind === "create_proposal") && !stored.some((item) => item.id === step.id))];
  const shouldShowActivity = message.role === "ASSISTANT" && (shouldShowThinking || activity.length > 0);
  // 待機中は経過秒数、完了後は本文が届くまでにかかった秒数を出す。
  const activitySeconds = shouldShowThinking
    ? thinkingSeconds
    : message.thinkingMs !== undefined
      ? Math.max(1, Math.round(message.thinkingMs / 1000))
      : null;

  return (
    <article className="notion-turn motion-page-enter">
      <div className="w-full min-w-0">
        <div className="notion-role-label">{message.role === "USER" ? "You" : "StudyMate"}</div>
        {shouldShowActivity && (
          <ChatActivity steps={activity} isThinking={shouldShowThinking} seconds={activitySeconds} />
        )}
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
            {message.content && <AssistantMarkdown content={message.content} />}
            {proposals.map((proposal) => proposal.kind === "proposal"
              ? <PageEditProposal key={proposal.id} proposal={proposal} />
              : <PageCreateProposal key={proposal.id} proposal={proposal} />)}
          </div>
        ) : (
          <div className="notion-user-block">
            {!!message.attachments?.some((attachment) =>
              isImageMimeType(attachment.mimeType),
            ) && (
              // ユーザーが添付した画像は、本文吹き出しの上にサムネイルとして並べる。
              <div className="mb-3 flex flex-wrap gap-2">
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
                        className="h-32 w-32 rounded object-cover"
                      />
                    ) : null;
                  })}
              </div>
            )}
            {message.content && (
              <div className="text-[15px] leading-7 text-[var(--notion-text)]">
                <div className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
              </div>
            )}
          </div>
        )}
        {!!message.attachments?.some(
          (attachment) =>
            message.role === "ASSISTANT" || !isImageMimeType(attachment.mimeType),
        ) && (
          // 画像以外のユーザー添付と、アシスタント側の通常添付はファイルチップとして表示する。
          <div className="mt-3 flex flex-wrap gap-1.5">
            {message.attachments
              .filter(
                (attachment) =>
                  message.role === "ASSISTANT" || !isImageMimeType(attachment.mimeType),
              )
              .map((attachment) => (
                <span
                  key={attachment.id}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--notion-border)] bg-[var(--notion-sidebar)] px-2 py-1 text-xs text-[var(--notion-muted)]"
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
