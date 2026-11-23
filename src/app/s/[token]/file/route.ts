import { NextResponse } from "next/server";
import { noteFileContentType, noteFileKeyParts, safeFileName } from "@/lib/note-file-keys";
import { extractBlockFileKeys } from "@/lib/note-share";
import { resolvePublicShare } from "@/lib/note-share-server";
import { readStoredImage } from "@/lib/storage";
import { prisma } from "@/lib/prisma";
import { whiteboardFileKeys } from "@/lib/whiteboard/public";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

// 公開ページ（または公開中のサブページ）の本文ブロック・ホワイトボードの本体が実際に参照している画像・ファイルだけを返す。
export async function GET(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const searchParams = new URL(request.url).searchParams;
    const pageId = searchParams.get("page");
    const key = noteFileKeyParts(searchParams.get("key"));
    if (!key) return new NextResponse(null, { status: 404 });

    const resolved = await resolvePublicShare(token, pageId);
    if (!resolved || key.ownerId !== resolved.page.userId) return new NextResponse(null, { status: 404 });

    // ノートは本文のブロック、ホワイトボードは本体（NoteCanvas）の files が参照しているものだけ。
    const referenced = resolved.page.kind === "whiteboard"
      ? whiteboardFileKeys((await prisma.noteCanvas.findUnique({ where: { noteId: resolved.page.id }, select: { data: true } }))?.data)
      : extractBlockFileKeys(resolved.page.blocks);
    if (!referenced.has(key.path)) return new NextResponse(null, { status: 404 });

    let data: Buffer;
    try {
      data = await readStoredImage(key.path);
    } catch {
      return new NextResponse(null, { status: 404 });
    }

    const contentType = noteFileContentType(key.extension);
    const image = contentType.startsWith("image/");
    const name = safeFileName(searchParams.get("name")) || `file.${key.extension}`;
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `${image ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(name)}`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
