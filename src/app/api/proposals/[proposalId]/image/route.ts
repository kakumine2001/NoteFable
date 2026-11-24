import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { proposalImage } from "@/lib/page-ai/proposals";
import { getStoredImageReadUrl, readStoredImage } from "@/lib/storage";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

// 提案カードの縮小画像（ホワイトボード・スライドの改前・改後）。?change=<変更の位置>&side=before|after。
// 本人の提案の画像だけ。画像はファイル置き場（Private Blob）にあり、添付画像と同じく、その 1 枚だけを読める短い期限の URL へ転送する
// （ローカルの保存先では本体を返す）。
export async function GET(request: NextRequest, context: Context) {
  const raw = request.nextUrl.searchParams.get("change") ?? "";
  const change = /^\d{1,4}$/.test(raw) ? Number(raw) : NaN;
  const side = request.nextUrl.searchParams.get("side");
  if (!Number.isSafeInteger(change) || (side !== "before" && side !== "after")) {
    return NextResponse.json({ error: msg("Invalid request.") }, { status: 400 });
  }
  try {
    const user = await getOrCreateUser();
    const { proposalId } = await context.params;
    const image = await proposalImage(user.id, proposalId, change, side);
    if (!image) return NextResponse.json({ error: msg("Proposal not found.") }, { status: 404 });
    const readUrl = await getStoredImageReadUrl(image.path);
    if (readUrl) return new Response(null, { status: 302, headers: { Location: readUrl, "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
    const bytes = await readStoredImage(image.path).catch(() => null);
    if (!bytes) return NextResponse.json({ error: msg("Proposal not found.") }, { status: 404 });
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (error) {
    console.error("Failed to read a proposal image", error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}
