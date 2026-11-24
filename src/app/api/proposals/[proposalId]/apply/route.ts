import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { applyProposal } from "@/lib/page-ai/proposals";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

// AI の提案を適用する。ノートを書く唯一の経路は、手動の保存（/api/pages）とこの適用の 2 つで、
// どちらも保存と同じ検証と版の確認を通る。再送しても同じ結果が返り、二重には適用されない。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { proposalId } = await context.params;
    const result = await applyProposal(user.id, proposalId);
    // 提案がもう待確認でなければ、その状態（status）と適用先（pageId）も返す（カードがその状態に合わせる）。
    if (!result.ok) return NextResponse.json({ error: result.error, ...(result.status ? { status: result.status } : {}), ...(result.pageId ? { pageId: result.pageId } : {}), ...(result.undoable ? { undoable: true } : {}) }, { status: result.httpStatus });
    const appliedPageId = (result.page as { id?: unknown } | null)?.id;
    if (typeof appliedPageId === "string") scheduleNoteEmbeddingSync(user.id, [appliedPageId]);
    return NextResponse.json({ status: result.status, kind: result.kind, page: result.page });
  } catch (error) {
    console.error("Failed to apply a note proposal", error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}
