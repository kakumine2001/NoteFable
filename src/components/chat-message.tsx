"use client";

import Image from "next/image";
import { Download, FileText, ImagePlus, Paperclip } from "lucide-react";
import { memo, useState } from "react";
import { AnswerActions, ReportAnswerButton, isSavedMessageId } from "@/components/answer-actions";
import { UserMessageEditor, UserTurnActions, VersionNav, type TurnActions } from "@/components/turn-actions";
import { AssistantMarkdown } from "@/components/assistant-markdown";
import { ChatActivity } from "@/components/chat-activity";
import type { ProgressStep } from "@/lib/chat-activity";
import { PageCreateProposal, PageEditProposal } from "@/components/page-edit-proposal";
import { isImageMimeType } from "@/lib/client-files";
import { useModels } from "@/components/models-provider";
import { AppIcon } from "@/components/app-icon";
import type { CharacterState } from "@/lib/characters";
import type { Message, StoredProposal } from "@/types/chat";
import { useT } from "@/components/i18n-provider";
import { localizeFailureText } from "@/lib/failure-text";

function GeneratingImagePreview() {
  const t = useT();
  // 生成中は Notion のブロックに近い控えめな状態表示を出し、完成画像より目立たせない。
  return (
    <div className="generated-image-grid" aria-label={t("Generating image")}>
      <div className="generated-image-placeholder">
        <div className="generated-image-placeholder-header">
          <span className="generated-image-placeholder-icon" aria-hidden="true">
            <ImagePlus size={18} strokeWidth={1.7} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-[var(--notion-text)]">{t("Generating image")}</span>
            <span className="mt-0.5 block text-xs text-[var(--notion-muted)]">{t("This may take a moment")}</span>
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
  // この回答がまだ生成中か（最後のメッセージで、会話が応答を待っている間）。生成中は回答の操作を出さない。
  isGenerating?: boolean;
  // 回答の操作（コピー・ノートに保存・Markdown）が元の会話を指すための情報。sessionId が無ければ操作は出さない。
  sessionId?: string | null;
  conversationTitle?: string;
  // 編集・再生成・版の切り替え・分岐。渡さなければ（ノートの AI アシスタントなど）その操作は出さない。
  actions?: TurnActions;
  // 自分の発言を書き直せるか（画像を作った発言は、作り直すと文章の回答になるので書き直させない）。
  canEdit?: boolean;
  // 送ったが断られた書き直し（上限・通信の失敗など）。この発言の編集欄を、その文のまま開き直す。
  editDraft?: string;
  // 最新のアシスタント回答にだけ渡す AI キャラクターのリアルタイム状態。
  characterState?: CharacterState;
};

export const ChatMessage = memo(function ChatMessage({
  message,
  isStreaming,
  thinkingSeconds,
  isGenerating = false,
  sessionId = null,
  conversationTitle = "",
  actions,
  canEdit = false,
  editDraft,
  characterState,
}: ChatMessageProps) {
  const t = useT();
  // 自分の発言をその場で書き直している間。断られた書き直しが戻ってきたときは、開いた状態から始める。
  const [editing, setEditing] = useState(editDraft !== undefined);
  const { options: modelOptions } = useModels();
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
  const activity = steps.filter((step): step is ProgressStep => step.kind !== "proposal" && step.kind !== "create_proposal" && step.kind !== "failure");
  const failure = steps.find((step) => step.kind === "failure");
  // 保存済みの提案を優先し、ストリーム中でまだ保存側に出ていないものだけを足す。
  const stored = message.proposals ?? [];
  const proposals: StoredProposal[] = [...stored, ...steps.filter((step): step is StoredProposal => (step.kind === "proposal" || step.kind === "create_proposal") && !stored.some((item) => item.id === step.id))];
  const shouldShowActivity = message.role === "ASSISTANT" && (shouldShowThinking || activity.length > 0);
  // 本文のある完了した回答にだけ操作の行を出す（生成中・画像だけ・送信の失敗表示には出さない）。
  const shouldShowAnswerActions =
    message.role === "ASSISTANT" &&
    !!sessionId &&
    !isGenerating &&
    !message.failed &&
    !message.isGeneratingImage &&
    message.content.trim().length > 0;
  // 操作行が出ない AI の出力（画像だけの回答、sessionId の無いノートの AI アシスタント）にも「報告」だけは出す（Google Play の AI 生成コンテンツのポリシー）。
  const shouldShowReportOnly =
    message.role === "ASSISTANT" &&
    !(shouldShowAnswerActions && sessionId) &&
    !isGenerating &&
    !message.failed &&
    !message.isGeneratingImage &&
    (message.content.trim().length > 0 || !!message.attachments?.length);
  // 待機中は経過秒数、完了後は本文が届くまでにかかった秒数を出す。
  const activitySeconds = shouldShowThinking
    ? thinkingSeconds
    : message.thinkingMs !== undefined
      ? Math.max(1, Math.round(message.thinkingMs / 1000))
      : null;

  // 回答したモデルの表示名。未知の ID（廃止したモデルなど）は誤った名前を出さないよう省く。
  // 画像は選んだチャットモデルに関係なく OpenAI の画像 API で作るので、画像の回答には出さない。
  const isImageAnswer = hasGeneratedImages || !!message.isGeneratingImage;
  const modelLabel = message.role === "ASSISTANT" && message.model && !isImageAnswer
    ? modelOptions.find((option) => option.id === message.model)?.label
    : undefined;

  return (
    <article className="notion-turn motion-page-enter" data-message-id={message.id}>
      <div className="w-full min-w-0">
        {/* 自分の発言にはラベルを付けない。回答の上は製品名を繰り返さず、選んだ AI キャラクターと必要なモデル名だけを出す。 */}
        {message.role === "ASSISTANT" && (
          <div className="notion-role-label is-assistant">
            <AppIcon
              size={16}
              state={characterState ?? "idle"}
              animated={characterState !== undefined && characterState !== "idle" && characterState !== "hidden"}
            />
            <span className="sr-only">{t("AI reply")}</span>
            {modelLabel && <span className="notion-role-model">· {modelLabel}</span>}
          </div>
        )}
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
                      alt={t("Generated image")}
                      width={1024}
                      height={1024}
                      unoptimized
                      className="generated-image"
                    />
                    <a
                      href={image.dataUrl}
                      download={`notefable-${image.id}.png`}
                      className="generated-image-download"
                      aria-label={t("Download image")}
                      title={t("Download")}
                    >
                      <Download size={20} />
                    </a>
                  </div>
                ))}
              </div>
            )}
            {shouldShowImagePreview && <GeneratingImagePreview />}
            {message.content && <AssistantMarkdown content={message.usageLimit ? t(message.content) : localizeFailureText(message.content, t, failure)} />}
            {proposals.map((proposal) => proposal.kind === "proposal"
              ? <PageEditProposal key={proposal.id} proposal={proposal} />
              : <PageCreateProposal key={proposal.id} proposal={proposal} />)}
          </div>
        ) : editing && actions ? (
          <div className="notion-user-block">
            <UserMessageEditor initial={editDraft ?? message.content}
              onCancel={() => { setEditing(false); if (editDraft !== undefined) actions.dismissEditDraft(); }}
              onSubmit={(text) => { setEditing(false); actions.edit(message.id, text); }} />
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
        {shouldShowAnswerActions && sessionId && (
          <AnswerActions messageId={message.id} content={message.content} sessionId={sessionId} conversationTitle={conversationTitle}
            versions={message.versions} actions={actions} />
        )}
        {/* 操作行の出ない回答（本文の無い回答）にも、別の版があれば切り替えだけは出す。 */}
        {message.role === "ASSISTANT" && !shouldShowAnswerActions && !isGenerating && message.versions && actions && (
          <div className="answer-actions"><VersionNav versions={message.versions} onShow={actions.showVersion} /></div>
        )}
        {shouldShowReportOnly && <ReportAnswerButton messageId={message.id} />}
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
        {message.role === "USER" && !!message.pages?.length && (
          // 発言に添付したノート。押すとそのノートを開く（ゴミ箱に入ったノートはサーバーが返さない）。
          // 文字の大きさは ul に付ける（globals.css の button { font: inherit } がレイヤー外で、button の text-xs より強いため）。
          <ul className="mt-2 flex flex-wrap gap-1.5 text-xs" aria-label={t("Attached pages")}>
            {message.pages.map((page) => (
              <li key={page.id} className="min-w-0 max-w-full">
                <button
                  type="button"
                  onClick={() => window.dispatchEvent(new CustomEvent("notefable:open-note", { detail: { id: page.id } }))}
                  className="inline-flex max-w-full items-center gap-1 rounded border border-[var(--notion-border)] bg-[var(--notion-sidebar)] px-2 py-1 text-[var(--notion-muted)] hover:bg-[var(--notion-hover)]"
                >
                  {page.icon ? <span aria-hidden="true">{page.icon}</span> : <FileText size={12} aria-hidden="true" />}
                  <span className="truncate">{page.title || t("Untitled")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {message.role === "USER" && actions && !editing && isSavedMessageId(message.id) && (
          <UserTurnActions content={message.content} versions={message.versions} canEdit={canEdit}
            onEdit={() => setEditing(true)} onShowVersion={actions.showVersion} />
        )}
      </div>
    </article>
  );
}, areChatMessagePropsEqual);

function areChatMessagePropsEqual(previous: ChatMessageProps, next: ChatMessageProps) {
  // 大きな Markdown や画像を含むメッセージは再描画コストが高い。
  // 通常は message オブジェクトが変わった時だけ描画し、待機中アシスタントだけ秒数更新で再描画する。
  if (
    previous.message !== next.message ||
    previous.isStreaming !== next.isStreaming ||
    previous.isGenerating !== next.isGenerating ||
    previous.sessionId !== next.sessionId ||
    previous.conversationTitle !== next.conversationTitle ||
    previous.actions !== next.actions ||
    previous.canEdit !== next.canEdit ||
    previous.editDraft !== next.editDraft ||
    previous.characterState !== next.characterState
  ) {
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
