import { NextRequest, NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { proposalContent } from "@/lib/page-ai/proposals";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

// キャンバス提案（ホワイトボード・スライド）の改前 / 改後プレビュー用データ（読み取り専用・本人のみ）。
// チャット履歴や SSE には本体 JSON を流さず、プレビューを開く時だけこのエンドポイントから取得する。
export async function GET(request: NextRequest, context: Context) {
  const side = request.nextUrl.searchParams.get("side");
  if (side !== "before" && side !== "after") {
    return NextResponse.json({ error: msg("Invalid request.") }, { status: 400, headers: NO_STORE });
  }
  try {
    const user = await getOrCreateUser();
    const { proposalId } = await context.params;
    const result = await proposalContent(user.id, proposalId, side);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.httpStatus, headers: NO_STORE });
    }
    return NextResponse.json(result.content, { headers: NO_STORE });
  } catch (error) {
    console.error("Failed to read proposal content", error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503, headers: NO_STORE });
  }
}
