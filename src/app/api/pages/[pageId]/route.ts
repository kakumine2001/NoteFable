import { NextResponse } from "next/server";
import { isDeepStrictEqual } from "node:util";
import type { Prisma } from "@/generated/prisma/client";
import { getOrCreateAnonymousUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { assertCoverOwner, claimCover } from "@/lib/note-covers";
import { assertNoteFilesOwner } from "@/lib/note-files";
import { readNoteRequest, validateNoteUpdate } from "@/lib/note-document";
import { prisma } from "@/lib/prisma";

type Context = { params: Promise<{ pageId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    const page = await prisma.notePage.findFirst({ where: { id: pageId, userId: user.id } });
    return page ? NextResponse.json({ page }, { headers: { "Cache-Control": "no-store" } }) : NextResponse.json({ error: "Note not found." }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const update = validateNoteUpdate(await readNoteRequest(request));
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    assertCoverOwner(update.cover, user.id);
    assertNoteFilesOwner(update.blocks, user.id);
    // 版番号を更新条件に含め、別タブの新しい内容を上書きしない。
    const result = await prisma.$transaction(async (tx) => {
      if (update.present.includes("cover")) await claimCover(tx, update.cover, user.id);
      const changed = await tx.notePage.updateMany({
        where: { id: pageId, userId: user.id, version: update.version },
        data: { title: update.title, ...Object.fromEntries(update.present.map((key) => [key, update[key]])), blocks: update.blocks as unknown as Prisma.InputJsonValue, version: { increment: 1 } },
      });
      const page = await tx.notePage.findFirst({ where: { id: pageId, userId: user.id } });
      // 応答だけ失われた保存の再送は、本文が一致する時に限り成功扱いにする。
      const alreadySaved = page && page.title === update.title && update.present.every((key) => page[key] === update[key]) && isDeepStrictEqual(page.blocks, update.blocks);
      return { page, conflict: !changed.count && !alreadySaved };
    });
    if (!result.page) return NextResponse.json({ error: "Note not found." }, { status: 404 });
    if (result.conflict) return NextResponse.json({ error: "This note was changed in another tab.", page: result.page }, { status: 409 });
    return NextResponse.json({ page: result.page });
  } catch (error) { return noteApiError(error); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const user = await getOrCreateAnonymousUser();
    const { pageId } = await context.params;
    const result = await prisma.notePage.deleteMany({ where: { id: pageId, userId: user.id } });
    return result.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Note not found." }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
