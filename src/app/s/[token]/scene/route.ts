import { NextResponse } from "next/server";
import { readCanvasDataForShare } from "@/lib/canvas-store";
import { resolvePublicShare } from "@/lib/note-share-server";
import { publicWhiteboardScene } from "@/lib/whiteboard/public";

export const runtime = "nodejs";

type Params = { params: Promise<{ token: string }> };

// 公開ページのホワイトボードの本体（読み取り専用のビューが読む）。公開されていない・ホワイトボードでないページは 404。
// 画像の URL は /s/:token/file に置き換える（そのホワイトボードが参照している画像だけが読める）。
export async function GET(request: Request, { params }: Params) {
  try {
    const { token } = await params;
    const pageId = new URL(request.url).searchParams.get("page");
    const resolved = await resolvePublicShare(token, pageId, undefined, { includeEmbeddedWhiteboards: false });
    if (!resolved || resolved.page.kind !== "whiteboard") return NextResponse.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
    // ゴミ箱に入ったページの本体は出さない（readCanvasDataForShare は deletedAt: null で読む。読めなければ空の白板）。
    const data = await readCanvasDataForShare(resolved.page.id);
    const scene = publicWhiteboardScene(data ?? { elements: [] }, token, resolved.page.id);
    return NextResponse.json({ scene }, { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  } catch {
    return NextResponse.json({ error: "Request failed." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
