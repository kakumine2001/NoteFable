import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { scheduleNoteEmbeddingSync } from "@/lib/note-embeddings";
import { undoProposal } from "@/lib/page-ai/proposals";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ proposalId: string }> };

// 適用した AI の提案を元に戻す（カードの「元に戻す」）。編集は適用前の内容へ戻し（いまの内容は履歴に残る）、
// 新規は作ったページをゴミ箱へ移す。ページがその後に書き換えられていたら 409（ページの履歴から戻してもらう）。
// 何度送っても同じ結果になる。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { proposalId } = await context.params;
    const result = await undoProposal(user.id, proposalId);
    // 提案がもう待確認でなければ、その状態（status）と適用先（pageId）も返す（カードがその状態に合わせる）。
    if (!result.ok) return NextResponse.json({ error: result.error, ...(result.status ? { status: result.status } : {}), ...(result.pageId ? { pageId: result.pageId } : {}) }, { status: result.httpStatus });
    if (result.kind === "edit") {
      const pageId = (result.page as { id?: unknown } | null)?.id;
      if (typeof pageId === "string") scheduleNoteEmbeddingSync(user.id, [pageId]);
      return NextResponse.json({ status: result.status, kind: result.kind, page: result.page });
    }
    return NextResponse.json({ status: result.status, kind: result.kind, ids: result.trashedIds });
  } catch (error) {
    console.error("Failed to undo a page proposal", error);
    return NextResponse.json({ error: msg("Database is unavailable. Try again in a moment.") }, { status: 503 });
  }
}
