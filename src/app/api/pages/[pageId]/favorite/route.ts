import { NextResponse } from "next/server";
import { getOrCreateUser } from "@/lib/auth";
import { noteApiError } from "@/lib/note-api";
import { NoteValidationError } from "@/lib/note-document";
import { readSmallJson } from "@/lib/note-groups";
import { pageSummary, setPageMeta } from "@/lib/note-tree-server";
import { prisma } from "@/lib/prisma";
import { msg } from "@/lib/i18n/translate";

type Context = { params: Promise<{ pageId: string }> };

// お気に入りに入れる・外す（{ favorite: boolean }）。本文の版は変えない。応答は一覧の 1 件と同じ形。
export async function PUT(request: Request, context: Context) {
  try {
    const { favorite } = await readSmallJson(request);
    if (typeof favorite !== "boolean") throw new NoteValidationError("favorite must be a boolean.");
    const user = await getOrCreateUser();
    const { pageId } = await context.params;
    const changed = await prisma.$transaction((tx) => setPageMeta(tx, user.id, pageId, { favoritedAt: favorite ? new Date() : null }));
    const page = changed ? await pageSummary(user.id, pageId) : null;
    return page ? NextResponse.json({ page }) : NextResponse.json({ error: msg("Note not found.") }, { status: 404 });
  } catch (error) { return noteApiError(error); }
}
