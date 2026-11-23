import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { proposalImage } from "@/lib/page-ai/proposals";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

// 提案カードの縮小画像（ホワイトボード・スライドの改前・改後）。?change=<変更の位置>&side=before|after。
// 本人の提案の画像だけを返す（画像は提案の中に保存してあり、ほかの場所には置かない）。
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
    return new NextResponse(new Uint8Array(image.bytes), {
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
