import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { trashCutoff } from "@/lib/note-trash";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

const notFound = () => NextResponse.json({ error: msg("Note not found in the trash.") }, { status: 404 });

// ゴミ箱から戻す。保持期間内のものだけ。位置・グループ・本文は捨てる前のまま（グループが消えていれば「グループなし」）。
// 応答は GET /api/pages の 1 件と同じ形で、そのまま一覧へ加えられる。
export async function POST(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const restored = await prisma.notePage.updateMany({ where: { id: pageId, userId: user.id, deletedAt: { gte: trashCutoff() } }, data: { deletedAt: null } });
    if (!restored.count) return notFound();
    const page = await prisma.notePage.findFirst({
      where: { id: pageId, userId: user.id, deletedAt: null },
      select: { id: true, position: true, title: true, icon: true, version: true, groupId: true, createdAt: true, updatedAt: true },
    });
    return page ? NextResponse.json({ page }) : notFound();
  } catch (error) { return noteApiError(error); }
}

// ゴミ箱にある 1 件を完全に削除する（元に戻せない）。通常のノートはこの API では消せない。
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const result = await prisma.notePage.deleteMany({ where: { id: pageId, userId: user.id, deletedAt: { not: null } } });
    return result.count ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) { return noteApiError(error); }
}
