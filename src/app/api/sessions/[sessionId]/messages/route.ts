import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { proposalsByMessage } from "@/lib/note-proposals";
import { prisma } from "@/lib/prisma";

type RouteContext = {
  params: Promise<{ sessionId: string }>;
};

function toPublicAttachment<T extends { imageStoragePath?: string | null; id: string }>(
  attachment: T,
) {
  // imageStoragePath はサーバー内の保存位置なので、クライアントへ直接渡さない。
  // 代わりに添付画像 API の URL を dataUrl として付け、権限確認を経由して読ませる。
  // rest には filename/mimeType/size など、クライアントへ返してよい情報だけが残る。
  const { imageStoragePath: _imageStoragePath, ...rest } = attachment;

  return {
    ...rest,
    dataUrl: _imageStoragePath ? `/api/attachments/${attachment.id}/image` : undefined,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  // メッセージ取得前に、指定セッションが現在の匿名ユーザーのものか確認する。
  // 存在確認と所有者確認を分けずに行うことで、他ユーザーのセッション内容を返さない。
  // Cookie から現在の匿名ユーザーを決める。
  const user = await getOrCreateAnonymousUser();
  // URL の [sessionId] パラメータ。
  const { sessionId } = await context.params;

  // 所有者確認用の軽いクエリ。本文取得前にここで弾く。
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      userId: user.id,
    },
    select: { id: true },
  });

  if (!session) {
    return NextResponse.json({ error: "Session not found." }, { status: 404 });
  }

  // 画面表示に必要なメッセージと添付メタ情報を時系列順で取得する。
  const messages = await prisma.message.findMany({
    where: { sessionId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      role: true,
      content: true,
      model: true,
      reasoningEffort: true,
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
    },
  });

  // 回答に紐付いた AI の提案（編集・新規ノート）。再読み込み後も適用・破棄できるよう、状態つきで返す。
  const proposals = await proposalsByMessage(user.id, sessionId);

  return NextResponse.json({
    messages: messages.map((message) => {
      // アシスタントに紐づく保存画像は、通常の添付チップではなく生成画像として大きく表示する。
      // ユーザー添付画像は通常添付として残し、会話履歴上の見え方を役割ごとに分ける。
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

      return {
        ...message,
        generatedImages,
        proposals: proposals.get(message.id) ?? [],
        attachments: message.attachments
          .filter(
            (attachment) =>
              // アシスタントの保存画像は generatedImages 側へ移したので、通常 attachments からは除外する。
              message.role !== "ASSISTANT" ||
              !attachment.imageStoragePath,
          )
          .map(toPublicAttachment),
      };
    }),
  });
}
