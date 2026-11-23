import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { discardProposal } from "@/lib/page-ai/proposals";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

// 提案を破棄する。ノートには触らない。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { proposalId } = await context.params;
    const result = await discardProposal(user.id, proposalId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json({ status: result.status });
  } catch (error) {
    console.error("Failed to discard a note proposal", error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}
