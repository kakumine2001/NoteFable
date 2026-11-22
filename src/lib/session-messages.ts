import { parseStoredActivity } from "@/lib/chat-activity";
import { versionsOf } from "@/lib/chat-branches";
import { loadBranchTree } from "@/lib/chat-branch-store";
import { proposalsByMessage } from "@/lib/note-proposals";
import { prisma } from "@/lib/prisma";

function toPublicAttachment<T extends { imageStoragePath?: string | null; id: string }>(attachment: T) {
  // imageStoragePath はサーバー内の保存位置なので、クライアントへ直接渡さない。
  // 代わりに添付画像 API の URL を dataUrl として付け、権限確認を経由して読ませる。
  const { imageStoragePath: _imageStoragePath, ...rest } = attachment;
  return {
    ...rest,
    dataUrl: _imageStoragePath ? `/api/attachments/${attachment.id}/image` : undefined,
  };
}

// 表示中の枝（active: true）のメッセージ・添付・添付ノート・AI 提案をまとめて整形する。
// 通常チャット（/api/sessions/:id/messages）とノート内 AI 助手（/api/pages/:id/assistant）で共用する。
export async function loadPublicSessionMessages(
  userId: string,
  sessionId: string,
  { includeVersions = true }: { includeVersions?: boolean } = {},
) {
  const messages = await prisma.message.findMany({
    where: { sessionId, active: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      reasoningEffort: true,
      activity: true,
      thinkingMs: true,
      createdAt: true,
      attachments: {
        select: {
          id: true,
          filename: true,
          mimeType: true,
          size: true,
          imageStoragePath: true,
        },
      },
      // 発言に添付したノート。タイトルとアイコンはノートから取り直す。ゴミ箱のノートと他人のノートは出さない。
      notes: {
        where: { note: { userId, deletedAt: null } },
        orderBy: { position: "asc" },
        select: { note: { select: { id: true, title: true, icon: true } } },
      },
    },
  });

  const proposals = await proposalsByMessage(userId, sessionId);
  const versions = includeVersions ? versionsOf(await loadBranchTree(sessionId)) : new Map();

  return messages.map((message) => {
    const generatedImages =
      message.role === "ASSISTANT"
        ? message.attachments
            .filter((attachment) => attachment.imageStoragePath)
            .map((attachment) => ({
              id: attachment.id,
              dataUrl: `/api/attachments/${attachment.id}/image`,
              mimeType: attachment.mimeType,
            }))
        : [];

    const { notes, ...rest } = message;
    return {
      ...rest,
      pages: notes.map(({ note }) => note),
      activity: parseStoredActivity(message.activity),
      thinkingMs: message.thinkingMs ?? undefined,
      generatedImages,
      proposals: proposals.get(message.id) ?? [],
      ...(versions.has(message.id) ? { versions: versions.get(message.id) } : {}),
      attachments: message.attachments
        .filter((attachment) => message.role !== "ASSISTANT" || !attachment.imageStoragePath)
        .map(toPublicAttachment),
    };
  });
}
