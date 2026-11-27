import { NextResponse } from "next/server";
import { COVER_CONTENT_TYPES } from "@/lib/note-covers";
import { uploadedCoverPath } from "@/lib/note-document";
import { resolvePublicShare } from "@/lib/note-share-server";
import { readStoredImage } from "@/lib/storage";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

// 公開ページ（またはその公開中のサブページ）に設定されているカバー画像・アイコン画像だけを返す。
export async function GET(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const pageId = new URL(request.url).searchParams.get("page");
    const resolved = await resolvePublicShare(token, pageId, undefined, { includeEmbeddedWhiteboards: false });
    if (!resolved) return new NextResponse(null, { status: 404 });

    // ?kind=icon はページのアイコン（アップロード画像のとき）。それ以外はカバー。
    const kind = new URL(request.url).searchParams.get("kind");
    const upload = uploadedCoverPath(kind === "icon" ? resolved.page.icon : resolved.page.cover);
    if (!upload || upload.ownerId !== resolved.page.userId) return new NextResponse(null, { status: 404 });

    let image: Buffer;
    try {
      image = await readStoredImage(upload.path);
    } catch {
      return new NextResponse(null, { status: 404 });
    }

    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": COVER_CONTENT_TYPES[upload.path.split(".").pop() ?? ""] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new NextResponse(null, { status: 500 });
  }
}
