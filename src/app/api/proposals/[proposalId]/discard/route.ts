import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { discardProposal } from "@/lib/note-proposals";

type Context = { params: Promise<{ proposalId: string }> };

// 提案を破棄する。ノートには触らない。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { proposalId } = await context.params;
    const result = await discardProposal(user.id, proposalId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json({ status: result.status });
  } catch (error) {
    console.error("Failed to discard a note proposal", error);
    return NextResponse.json({ error: "Database is unavailable. Try again in a moment." }, { status: 503 });
  }
}
