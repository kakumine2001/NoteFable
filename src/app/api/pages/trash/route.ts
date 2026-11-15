import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { toTrashItem, trashCutoff, tryPurgeExpiredNotes } from "@/lib/note-trash";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

// ゴミ箱の一覧（捨てた新しい順）。期限切れは先に完全削除し、掃除に失敗しても一覧には出さない。
export async function GET() {
  try {
    const user = await getOrCreateUser();
    await tryPurgeExpiredNotes(user.id);
    const rows = await prisma.notePage.findMany({
      where: { userId: user.id, deletedAt: { gte: trashCutoff() } },
      orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
      select: { id: true, title: true, icon: true, deletedAt: true, parent: { select: { deletedAt: true } } },
    });
    // 親と一緒にゴミ箱へ入ったサブページは出さない（親を戻すと一緒に戻る）。
    const roots = rows.filter((row) => row.parent?.deletedAt?.getTime() !== row.deletedAt!.getTime());
    return NextResponse.json({ pages: roots.map((row) => toTrashItem({ id: row.id, title: row.title, icon: row.icon, deletedAt: row.deletedAt! })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return noteApiError(error); }
}

// ゴミ箱を空にする：ゴミ箱のノートを完全に削除する（元に戻せない）。
// before（ISO 時刻）を付けると、その時刻までに捨てたものだけを消す。画面に見せた一覧の後で別のタブが捨てたノートを、見せないまま消さないため。
export async function DELETE(request: Request) {
  try {
    const before = new URL(request.url).searchParams.get("before");
    const cutoff = before === null ? null : new Date(before);
    if (cutoff && Number.isNaN(cutoff.getTime())) return NextResponse.json({ error: msg("Invalid time.") }, { status: 400 });
    const user = await getOrCreateUser();
    const result = await prisma.notePage.deleteMany({ where: { userId: user.id, deletedAt: cutoff ? { lte: cutoff } : { not: null } } });
    return NextResponse.json({ ok: true, count: result.count });
  } catch (error) { return noteApiError(error); }
}
