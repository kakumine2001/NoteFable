import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { readSmallJson, validGroupName } from "@/lib/note-groups";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ groupId: string }> };

const notFound = () => NextResponse.json({ error: msg("Group not found.") }, { status: 404 });

// グループ名を変える。
export async function PATCH(request: Request, context: Context) {
  try {
    const name = validGroupName((await readSmallJson(request)).name);
    const user = await getOrCreateUser();
    const { groupId } = await context.params;
    const result = await prisma.noteGroup.updateMany({ where: { id: groupId, userId: user.id }, data: { name } });
    return result.count ? NextResponse.json({ group: { id: groupId, name } }) : notFound();
  } catch (error) { return noteApiError(error); }
}

// グループを消す。中のノートは消えず「グループなし」に戻る（外部キーの SetNull）。
export async function DELETE(_request: Request, context: Context) {
  try {
    const user = await getOrCreateUser();
    const { groupId } = await context.params;
    const result = await prisma.noteGroup.deleteMany({ where: { id: groupId, userId: user.id } });
    return result.count ? NextResponse.json({ ok: true }) : notFound();
  } catch (error) { return noteApiError(error); }
}
