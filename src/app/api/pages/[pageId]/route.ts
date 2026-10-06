import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { limitNoteWrite, noteApiError } from "@/lib/note-api";
import { readNoteRequest, validateNoteUpdate } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id } });
    return page ? NextResponse.json({ page }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Page not found." }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const limited = await limitNoteWrite(request);
    if (limited) return limited;
    const update = validateNoteUpdate(await readNoteRequest(request));
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    // 版番号を更新条件に含め、別タブの新しい内容を上書きしない。
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.notePage.updateMany({
        where: { id: pageId, userId: user.id, version: update.version },
        data: { title: update.title, icon: update.icon, cover: update.cover, blocks: update.blocks as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      const page = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id } });
      // 応答だけ失われた保存の再送は、本文が一致する時に限り成功扱いにする。
      const alreadySaved = page && page.title === update.title && page.icon === update.icon && page.cover === update.cover && isDeepStrictEqual(page.blocks, update.blocks);
      return { page, conflict: !changed.count && !alreadySaved };
    });
    if (!result.page) return NextResponse.json({ error: "Page not found." }, { status: 404 });
    if (result.conflict) return NextResponse.json({ error: "This page was changed in another tab.", page: result.page }, { status: 409 });
    return NextResponse.json({ page: result.page });
  } catch (error) { return noteApiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const limited = await limitNoteWrite(request);
    if (limited) return limited;
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    const result = await prisma.notePage.deleteMany({ where: { id: pageId, userId: user.id } });
    return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Page not found." }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
