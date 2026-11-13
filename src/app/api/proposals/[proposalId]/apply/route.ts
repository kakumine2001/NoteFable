import { NextResponse } from "next/server";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { applyProposal } from "@/lib/note-proposals";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

// AI の提案を適用する。ノートを書く唯一の経路は、手動の保存（/api/pages）とこの適用の 2 つで、
// どちらも保存と同じ検証と版の確認を通る。再送しても同じ結果が返り、二重には適用されない。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { proposalId } = await context.params;
    const result = await applyProposal(user.id, proposalId);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
    return NextResponse.json({ status: result.status, kind: result.kind, page: result.page });
  } catch (error) {
    console.error("Failed to apply a note proposal", error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}
