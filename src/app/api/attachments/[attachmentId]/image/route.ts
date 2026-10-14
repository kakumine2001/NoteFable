import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getStoredImageReadUrl, readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ attachmentId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  // 添付画像を返す前に、画像が現在の匿名ユーザーのセッションに紐づくか確認する。
  // ファイルパスを URL に直接出さず、この API を通すことでアクセス制御とキャッシュ設定をまとめる。
  // 現在アクセスしている匿名ユーザー。添付の所有者確認に使う。
  const user = await getOrCreateAnonymousUser();
  // URL の [attachmentId] パラメータ。
  const { attachmentId } = await context.params;

  // 添付 ID だけでなく、message -> session -> userId までたどって所有者を確認する。
  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      message: {
        session: {
          userId: user.id,
        },
      },
      imageStoragePath: { not: null },
    },
    select: {
      mimeType: true,
      imageStoragePath: true,
    },
  });

  if (!attachment?.imageStoragePath) {
    return NextResponse.json({ error: "Attachment not found." }, { status: 404 });
  }

  try {
    const readUrl = await getStoredImageReadUrl(attachment.imageStoragePath);
    if (readUrl) return new Response(null, { status: 302, headers: { Location: readUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    // DB に保存された相対パスを使って、実ファイルを保存領域から読む。
    const image = await readStoredImage(attachment.imageStoragePath);

    return new Response(image, {
      headers: {
        // 保存時の MIME type で返し、ブラウザが画像として扱えるようにする。
        "Content-Type": attachment.mimeType,
        // 匿名ユーザーごとの private な画像なので、共有キャッシュには載せない。
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch {
    return NextResponse.json({ error: "Attachment file not found." }, { status: 404 });
  }
}
